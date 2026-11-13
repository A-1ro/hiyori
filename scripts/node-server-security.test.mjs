import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { IncomingMessage, request } from 'node:http'
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

// Exercise the MCP SDK's actual transitive adapter, without adding a direct copy.
const sdkRequire = createRequire(import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'))
const { createAdaptorServer } = sdkRequire('@hono/node-server')

// GHSA-jpvv-r467-5p4w: only raw backslashes in the path must be rejected.
for (const [path, expected] of [
  ['/alpha\\beta', 400],
  ['http://adapter.test/alpha\\beta', 400],
  ['/alpha/beta', 200],
  ['/alpha%5Cbeta', 200],
  ['/alpha?value=left\\right', 200],
]) {
  test(`Node adapter handles request-target ${JSON.stringify(path)}`, { timeout: 10000 }, async (t) => {
    const server = createAdaptorServer({
      fetch: () => new Response('adapter test'),
      overrideGlobalObjects: false,
    })
    t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const status = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: server.address().port, path, agent: false }, (response) => {
        response.resume()
        response.once('end', () => resolve(response.statusCode))
        response.once('error', reject)
      })
      req.once('error', reject)
      req.end()
    })
    assert.equal(status, expected)
  })
}

// Invoke the registered upgrade handler with local streams. No WebSocket peer,
// external service, or process-crashing TCP-reset payload is needed.
function upgradeHarness(fetch) {
  const server = new EventEmitter()
  const wss = new EventEmitter()
  wss.options = { noServer: true }
  wss.close = () => {}
  wss.handleUpgrade = () => assert.fail('a rejected or closed request must not reach the handshake')
  createAdaptorServer({
    fetch,
    createServer: () => server,
    websocket: { server: wss },
    overrideGlobalObjects: false,
  })
  const socket = new PassThrough()
  const incoming = new IncomingMessage(socket)
  incoming.url = '/socket'
  incoming.headers = { host: 'adapter.test', upgrade: 'websocket' }
  return { socket, incoming, upgrade: server.listeners('upgrade')[0] }
}

test('WebSocket request-target cannot replace the Host authority (GHSA-7v5p-43qr-wch5)', async (t) => {
  let observedUrl
  const { socket, incoming, upgrade } = upgradeHarness((req) => {
    observedUrl = req.url
    return new Response(null, { status: 403 })
  })
  t.after(() => socket.destroy())
  incoming.url = '//untrusted.invalid/socket'
  await upgrade(incoming, socket, Buffer.alloc(0))
  assert.equal(new URL(observedUrl).origin, 'http://adapter.test')
})

test('socket errors are handled while an asynchronous upgrade is pending (GHSA-qv5m-9pm6-hqp3)', async (t) => {
  let finish
  const gate = new Promise((resolve) => { finish = resolve })
  const { socket, incoming, upgrade } = upgradeHarness(async () => {
    await gate
    return new Response(null, { status: 403 })
  })
  t.after(() => socket.destroy())
  const pending = upgrade(incoming, socket, Buffer.alloc(0))
  try {
    const error = Object.assign(new Error('synthetic local reset'), { code: 'ECONNRESET' })
    assert.doesNotThrow(() => socket.emit('error', error))
    // A real TCP reset closes the underlying socket; finish that lifecycle here
    // before allowing the asynchronous application handler to return.
    socket.destroy()
  } finally {
    finish()
    await pending
  }
})
