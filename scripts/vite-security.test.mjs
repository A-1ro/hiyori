import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { createServer } from 'vite'

// GHSA-p4f5-76q4-ffq7: URL-derived virtual module IDs must remain string data.
// Exercise the installed native resolver without listening on the network or
// executing generated JavaScript (node --check only parses it).
for (const prefix of ['__vite-browser-external:', '__vite-optional-peer-dep:']) {
  test(`${prefix} escapes punctuation in virtual module IDs`, async (t) => {
    const server = await createServer({
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    t.after(() => server.close())

    for (const suffix of ['ordinary', 'double"quote', 'back`tick', 'line\nbreak']) {
      const id = `${prefix}${suffix}:parent`
      const result = await server.environments.client.pluginContainer.load(id)
      const code = typeof result === 'string' ? result : result?.code
      assert.equal(typeof code, 'string', `resolver did not load ${JSON.stringify(id)}`)
      const parsed = spawnSync(process.execPath, ['--check', '--input-type=module'], {
        input: code,
        encoding: 'utf8',
        timeout: 10000,
      })
      assert.ifError(parsed.error)
      assert.equal(parsed.status, 0, `${JSON.stringify(id)} generated invalid JavaScript: ${parsed.stderr}`)
    }
  })
}
