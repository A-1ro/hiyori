import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const approvedVars = {
  HIYORI_AI_ENABLED: 'true',
  HIYORI_AI_TOOL_DATA_ENABLED: 'true',
  HIYORI_AI_DAILY_MICROS: '100000',
  HIYORI_AI_MONTHLY_MICROS: '1000000',
  HIYORI_AI_INPUT_MICROS_PER_MILLION: '51000',
  HIYORI_AI_OUTPUT_MICROS_PER_MILLION: '335000',
}

export function checkHiyoriE2eBuild(config) {
  const db = config.d1_databases
  const kv = config.kv_namespaces
  const objects = config.durable_objects?.bindings
  const valid = config.name === 'hiyori-e2e'
    && db?.length === 1 && db[0].binding === 'DB' && db[0].database_id === '38c8635b-78ce-4330-9e2a-c5c44d3036ba'
    && kv?.length === 1 && kv[0].binding === 'OAUTH_KV' && kv[0].id === '39d9cbf7472747d7aa3148e2fedd9993'
    && objects?.length === 1 && objects[0].name === 'MCP_OBJECT' && objects[0].class_name === 'HiyoriMcpAgent'
    && (!objects[0].script_name || objects[0].script_name === config.name)
    && config.ai?.binding === 'HIYORI_AI' && Object.keys(config.ai).length === 1
    && config.vars?.ENVIRONMENT === 'production'
    && Object.entries(approvedVars).every(([key, value]) => config.vars?.[key] === value)
    && Object.keys(config.vars).filter((key) => key.startsWith('HIYORI_')).length === Object.keys(approvedVars).length
    && config.triggers?.crons?.length === 0
  if (!valid) throw new Error('Build does not match isolated e2e resources and approved AI settings')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkHiyoriE2eBuild(JSON.parse(readFileSync('dist/hiyori/wrangler.json', 'utf8')))
  console.log('Isolated e2e resources and approved AI settings verified')
}
