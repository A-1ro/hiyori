import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const script = fileURLToPath(new URL('./announce.mjs', import.meta.url))
const execFileAsync = promisify(execFile)
const token = 'fixture-admin-token'
// Every subprocess gets only synthetic credentials. Mocked cases cannot use the network.
const environment = { PATH: process.env.PATH, ANNOUNCEMENTS_ADMIN_TOKEN: token }
const fetchStub = `
globalThis.fetch = async (url, init) => {
  process.stderr.write('mock-fetch-called\\n')
  if (init.headers.Authorization !== 'Bearer fixture-admin-token') throw new Error('missing fixture authorization')
  if (init.redirect !== 'error') throw new Error('redirects must be rejected')
  return new Response(JSON.stringify({ url, method: init.method, body: JSON.parse(init.body) }))
}
`
const preload = `data:text/javascript,${encodeURIComponent(fetchStub)}`
const modes = [
  { method: 'POST', args: ['--title', 'Fixture title', '--category', 'notice'], suffix: '' },
  { method: 'PATCH', args: ['--archive', 'fixture-id'], suffix: '/fixture-id' },
]

function run(args, { apiUrl, input = '' } = {}) {
  return spawnSync(process.execPath, ['--import', preload, script, ...args], {
    env: { ...environment, ...(apiUrl === undefined ? {} : { HIYORI_API_URL: apiUrl }) },
    input,
    encoding: 'utf8',
    timeout: 10_000,
  })
}

for (const { method, args, suffix } of modes) {
  for (const source of ['flag', 'env']) {
    for (const apiUrl of [
      'https://trusted.example',
      'http://localhost:8787',
      'http://127.0.0.1:8787',
      'http://127.2.3.4:8787',
      'http://[::1]:8787',
    ]) {
      test(`${method}: accepts ${source} URL ${apiUrl} with redirect rejection`, () => {
        const urlArgs = source === 'flag' ? ['--api-url', apiUrl] : []
        const result = run([...urlArgs, ...args, '--yes'], { apiUrl, input: 'Fixture stdin body\n' })
        assert.equal(result.error, undefined)
        assert.equal(result.status, 0, result.stderr)
        assert.match(result.stderr, /mock-fetch-called/)
        const request = JSON.parse(result.stdout)
        assert.equal(request.url, `${apiUrl}/api/announcements${suffix}`)
        assert.equal(request.method, method)
        assert.deepEqual(request.body, method === 'POST'
          ? { title: 'Fixture title', category: 'notice', body: 'Fixture stdin body' }
          : { status: 'archived' })
        assert.ok(!result.stdout.includes(token))
      })
    }

    for (const apiUrl of [
      'not-a-url',
      'file:///tmp/fixture',
      'ftp://localhost',
      'http://remote.example',
      'http://printer.local',
      'http://192.168.1.1',
      'http://0.0.0.0',
      'http://[::]',
      'http://localhost.remote.example',
      'http://127.0.0.1.remote.example',
      'http://localhost@remote.example',
      'https://fixture-user:fixture-password@remote.example',
    ]) {
      test(`${method}: rejects unsafe ${source} URL before accessing fetch`, () => {
        const urlArgs = source === 'flag' ? ['--api-url', apiUrl] : []
        const result = run([...urlArgs, ...args, '--yes'], { apiUrl, input: 'Fixture body' })
        assert.equal(result.error, undefined)
        assert.equal(result.status, 1)
        assert.match(result.stderr, /URL/)
        assert.doesNotMatch(result.stderr, /mock-fetch-called|fixture-user|fixture-password|fixture-admin-token/)
        assert.equal(result.stdout, '')
      })
    }
  }

  test(`${method}: dry-run validates URLs and does not fetch or expose authorization`, () => {
    const argsWithBody = [...args, '--body', 'Fixture body', '--dry-run']
    const valid = run(['--api-url', 'https://trusted.example', ...argsWithBody])
    assert.equal(valid.status, 0, valid.stderr)
    assert.doesNotMatch(valid.stderr, /mock-fetch-called/)
    assert.ok(!valid.stdout.includes(token))
    assert.equal(JSON.parse(valid.stdout).method, method)
    const invalid = run(['--api-url', 'http://remote.example', ...argsWithBody])
    assert.equal(invalid.status, 1)
    assert.equal(invalid.stdout, '')
    assert.doesNotMatch(invalid.stderr, /mock-fetch-called/)
  })

  test(`${method}: native fetch never follows a 307 with the token or body`, async (t) => {
    const requests = []
    const server = createServer((req, res) => {
      requests.push({ path: req.url, authorization: req.headers.authorization, method: req.method })
      req.resume()
      res.writeHead(307, { Location: '/unexpected-redirect-target' })
      res.end()
    })
    // Isolated mock endpoint on loopback; no Hiyori service or real credentials are used.
    server.listen(0, '127.0.0.1')
    t.after(() => {
      server.closeAllConnections()
      server.close()
    })
    await once(server, 'listening')
    const apiUrl = `http://127.0.0.1:${server.address().port}`
    await assert.rejects(execFileAsync(process.execPath, [
      script, '--api-url', apiUrl, ...args, '--body', 'Fixture body', '--yes',
    ], { env: environment, timeout: 10_000 }), (error) => {
      assert.equal(error.code, 1)
      assert.doesNotMatch(error.stderr, /fixture-admin-token|Fixture body/)
      return true
    })
    assert.deepEqual(requests, [{
      path: `/api/announcements${suffix}`, authorization: `Bearer ${token}`, method,
    }])
  })
}

test('explicit API URL takes precedence over the environment', () => {
  const result = run([
    '--api-url', 'http://remote.example', '--title', 'Fixture title',
    '--category', 'notice', '--body', 'Fixture body', '--yes',
  ], { apiUrl: 'https://trusted.example' })
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stderr, /mock-fetch-called/)
})
