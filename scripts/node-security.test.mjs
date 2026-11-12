import assert from 'node:assert/strict'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { test } from 'node:test'

// CVE-2026-123871: use dummy credentials and parse an invalid URL locally.
// No environment credentials are read and no network request is made.
for (const [Agent, proxyKey] of [[HttpAgent, 'http_proxy'], [HttpsAgent, 'https_proxy']]) {
  test(`${proxyKey} errors redact proxy credentials`, () => {
    assert.throws(() => new Agent({
      proxyEnv: { [proxyKey]: 'http://hiyori-regression-user:not-a-secret@[invalid]' },
    }), (error) => {
      assert.equal(error.code, 'ERR_PROXY_INVALID_CONFIG')
      assert.doesNotMatch(error.message, /hiyori-regression-user|not-a-secret/)
      return true
    })
  })
}

test('HTTPS Agent separates default and explicitly empty CA policies (CVE-2026-123877)', (t) => {
  const agent = new HttpsAgent({ proxyEnv: {} })
  t.after(() => agent.destroy())
  const options = { host: 'localhost', port: 443 }
  assert.notEqual(agent.getName(options), agent.getName({ ...options, ca: [] }))
})
