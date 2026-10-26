import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { unstable_readConfig } from 'wrangler'

test('Hiyorichan is enabled only in isolated e2e and adds no Durable Object', () => {
  const config = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
  const production = unstable_readConfig({ config })
  const e2e = unstable_readConfig({ config, env: 'e2e' })
  assert.equal(production.name, 'hiyori')
  assert.equal(production.vars.HIYORICHAN_ENABLED, 'false')
  assert.equal(production.ai, undefined)
  assert.equal(e2e.name, 'hiyori-e2e')
  assert.equal(e2e.vars.HIYORICHAN_ENABLED, 'true')
  assert.equal(e2e.ai.binding, 'AI')
  assert.equal(e2e.d1_databases[0].database_name, 'hiyori-e2e')
  assert.notEqual(e2e.d1_databases[0].database_id, production.d1_databases[0].database_id)
  assert.notEqual(e2e.kv_namespaces[0].id, production.kv_namespaces[0].id)
  assert.deepEqual(e2e.durable_objects.bindings.map(binding => binding.class_name), ['HiyoriMcpAgent'])
  assert.deepEqual(e2e.migrations, production.migrations)
  assert.deepEqual(e2e.triggers.crons, [])
})
