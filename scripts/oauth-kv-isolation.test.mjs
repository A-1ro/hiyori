import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { unstable_readConfig } from 'wrangler'

test('production and e2e OAuth stores use distinct explicit KV namespaces', () => {
  const config = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
  const production = unstable_readConfig({ config }).kv_namespaces.filter((binding) => binding.binding === 'OAUTH_KV')
  const e2e = unstable_readConfig({ config, env: 'e2e' }).kv_namespaces.filter((binding) => binding.binding === 'OAUTH_KV')
  assert.equal(production.length, 1)
  assert.equal(e2e.length, 1)
  assert.match(production[0].id, /^[a-f0-9]{32}$/)
  assert.match(e2e[0].id, /^[a-f0-9]{32}$/)
  assert.notEqual(e2e[0].id, production[0].id, 'e2e must not reuse the production OAuth grant/token store')
})
