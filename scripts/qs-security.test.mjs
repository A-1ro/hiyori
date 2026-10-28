import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

// Exercise the audited MCP SDK -> Express -> qs copy (GHSA-6pq8-jhm2-2vcw).
const require = createRequire(import.meta.url)
const sdkRequire = createRequire(require.resolve('@modelcontextprotocol/sdk/server/index.js'))
const expressRequire = createRequire(sdkRequire.resolve('express'))
const qs = expressRequire('qs')

test('comma serialization handles JSON array entries with a non-callable toString', () => {
  const input = JSON.parse('{"a":["left",{"toString":"invalid"},"right"]}')
  assert.equal(qs.stringify(input, { arrayFormat: 'comma' }), 'a=left%2C%5Bobject%20Object%5D%2Cright')
})

test('comma serialization handles non-callable toString with encodeValuesOnly', () => {
  const input = JSON.parse('{"a":["left",{"toString":"invalid"},"right"]}')
  assert.equal(qs.stringify(input, { arrayFormat: 'comma', encodeValuesOnly: true }), 'a=left,%5Bobject%20Object%5D,right')
})

test('comma serialization handles null-prototype entries from query parsing', () => {
  const input = qs.parse('a[][b]=c', { plainObjects: true })
  assert.equal(qs.stringify(input, { arrayFormat: 'comma' }), 'a=%5Bobject%20Object%5D')
})

test('comma serialization handles a shadowed toString retained by query parsing', () => {
  const input = qs.parse('a[0][toString]=invalid', { allowPrototypes: true })
  assert.equal(qs.stringify(input, { arrayFormat: 'comma' }), 'a=%5Bobject%20Object%5D')
})

test('comma serialization preserves ordinary string arrays', () => {
  assert.equal(qs.stringify({ a: ['left', 'right'] }, { arrayFormat: 'comma' }), 'a=left%2Cright')
})
