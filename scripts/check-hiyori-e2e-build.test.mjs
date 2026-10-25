import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkHiyoriE2eBuild } from './check-hiyori-e2e-build.mjs'

function valid() {
  return {
    name: 'hiyori-e2e',
    d1_databases: [{ binding: 'DB', database_id: '38c8635b-78ce-4330-9e2a-c5c44d3036ba' }],
    kv_namespaces: [{ binding: 'OAUTH_KV', id: '39d9cbf7472747d7aa3148e2fedd9993' }],
    durable_objects: { bindings: [{ name: 'MCP_OBJECT', class_name: 'HiyoriMcpAgent' }] },
    ai: { binding: 'HIYORI_AI' }, triggers: { crons: [] },
    vars: { ENVIRONMENT: 'production', HIYORI_AI_ENABLED: 'true', HIYORI_AI_TOOL_DATA_ENABLED: 'true', HIYORI_AI_DAILY_MICROS: '100000', HIYORI_AI_MONTHLY_MICROS: '1000000', HIYORI_AI_INPUT_MICROS_PER_MILLION: '51000', HIYORI_AI_OUTPUT_MICROS_PER_MILLION: '335000' },
  }
}

test('accepts only the approved isolated configuration without invoking a model', () => {
  assert.doesNotThrow(() => checkHiyoriE2eBuild(valid()))
})
for (const [name, change] of [
  ['production Worker', (c) => { c.name = 'hiyori' }],
  ['production DB', (c) => { c.d1_databases[0].database_id = '4fb101ec-5490-452f-b7fb-a0e8ded356d2' }],
  ['production KV', (c) => { c.kv_namespaces[0].id = '07eeb7f525df48efa451db8983f09926' }],
  ['cross-Worker DO', (c) => { c.durable_objects.bindings[0].script_name = 'hiyori' }],
  ['missing AI binding', (c) => { delete c.ai }],
  ['expanded budget', (c) => { c.vars.HIYORI_AI_DAILY_MICROS = '10000000' }],
  ['missing data consent flag', (c) => { delete c.vars.HIYORI_AI_TOOL_DATA_ENABLED }],
  ['wrong price', (c) => { c.vars.HIYORI_AI_INPUT_MICROS_PER_MILLION = '1' }],
  ['unapproved cron', (c) => { c.triggers.crons.push('* * * * *') }],
]) {
  test(`rejects ${name}`, () => {
    const config = valid(); change(config)
    assert.throws(() => checkHiyoriE2eBuild(config))
  })
}
