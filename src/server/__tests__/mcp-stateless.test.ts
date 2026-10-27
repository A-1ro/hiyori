import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, inject, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import worker, { type Env } from '../index'
import { loginAsBearer } from './test-helpers'

const BASE = 'https://example.com'
const bindings: Env = {
  ...(env as Env), MCP_ENABLED: 'true', MCP_STATELESS_ENABLED: 'true',
  MCP_OBJECT: new Proxy((env as Env).MCP_OBJECT, { get() { throw new Error('Stateless MCP must never access a Durable Object') } }),
}
let authorization: string

async function fetchWorker(request: Request) {
  const ctx = createExecutionContext()
  const result = await worker.fetch(request, bindings, ctx)
  await waitOnExecutionContext(ctx)
  return result
}

async function rpc(method: string, params: unknown = {}, auth = authorization, headers: Record<string, string> = {}) {
  return fetchWorker(new Request(`${BASE}/mcp`, {
    method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }))
}

async function call(name: string, args: Record<string, unknown> = {}, auth = authorization, headers: Record<string, string> = {}) {
  const response = await rpc('tools/call', { name, arguments: args }, auth, headers)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(response.headers.has('mcp-session-id')).toBe(false)
  const body = await response.json() as { result: { isError?: boolean; content: Array<{ text: string }> } }
  return body.result
}

beforeEach(async () => {
  await applyD1Migrations(bindings.DB, inject('d1Migrations'))
  authorization = await loginAsBearer('stateless-owner')
})

describe('stateless Streamable HTTP without a DO', () => {
  it('connects an unmodified SDK client, lists tools, calls tools, and closes without a protocol session', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
      requestInit: { headers: { authorization } },
      fetch: (input, init) => fetchWorker(new Request(input, init)),
    })
    const client = new Client({ name: 'stateless-regression', version: '1' })
    try {
      await client.connect(transport)
      expect(transport.sessionId).toBeUndefined()
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('hiyori_create_event')
      const result = await client.callTool({ name: 'hiyori_whoami', arguments: {} })
      expect(JSON.stringify(result)).toContain('stateless-owner')
    } finally {
      await client.close()
    }
  })

  it('saves all mixed-duration candidates, preserves response values, and enforces private ACLs', async () => {
    const candidates = Array.from({ length: 7 }, (_, day) => [
      { startAt: new Date(Date.UTC(2030, 9, 28 + day, 3)).toISOString(), endAt: new Date(Date.UTC(2030, 9, 28 + day, 6)).toISOString() },
      { startAt: new Date(Date.UTC(2030, 9, 28 + day, 10)).toISOString(), endAt: new Date(Date.UTC(2030, 9, 28 + day, 14)).toISOString() },
    ]).flat()
    const result = await call('hiyori_create_event', { title: '軽量MCP', defaultDurationMinutes: 180, visibility: 'invite_only', timezone: 'Asia/Tokyo', candidates })
    expect(result.isError).not.toBe(true)
    const created = JSON.parse(result.content[0]!.text) as { event: { id: string; createdAt: string }; candidates: Array<{ id: string; startAt: string; endAt: string }> }
    const detail = await call('hiyori_get_event', { eventId: created.event.id })
    const saved = JSON.parse(detail.content[0]!.text)
    expect(saved.event).toEqual(created.event)
    expect(saved.candidates).toHaveLength(14)
    expect(saved.candidates).toEqual(expect.arrayContaining(created.candidates))
    expect(created.candidates.map(({ startAt, endAt }) => ({ startAt, endAt }))).toEqual(candidates)
    expect(JSON.stringify(created)).not.toContain('organizerDiscordId')
    const other = await loginAsBearer('stateless-other')
    expect((await call('hiyori_get_event', { eventId: created.event.id }, other)).isError).toBe(true)
    expect((await call('hiyori_delete_event', { eventId: created.event.id }, other)).isError).toBe(true)
  })

  it('keeps concurrent identities request-local and ignores forged internal auth', async () => {
    const other = await loginAsBearer('stateless-parallel-other')
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call('hiyori_whoami', {}, i % 2 ? other : authorization, {
      'x-hiyori-internal-mcp-auth': btoa(JSON.stringify({ scopes: ['admin'], discordUserId: 'forged' })),
    })))
    expect(results.map(result => JSON.parse(result.content[0]!.text).discordUserId)).toEqual(Array.from({ length: 8 }, (_, i) => i % 2 ? 'stateless-parallel-other' : 'stateless-owner'))
    await bindings.DB.prepare('DELETE FROM sessions WHERE userId = (SELECT id FROM users WHERE discordUserId = ?)').bind('stateless-owner').run()
    expect((await rpc('tools/list')).status).toBe(401)
  })

  it('rejects untrusted Origins, unavailable streams and malformed requests without writing', async () => {
    expect((await rpc('tools/list', {}, authorization, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await rpc('tools/list', {}, authorization, { origin: 'null' })).status).toBe(403)
    for (const method of ['GET', 'DELETE']) {
      const response = await fetchWorker(new Request(`${BASE}/mcp`, { method, headers: { authorization } }))
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
    }
    expect((await rpc('tools/list', {}, authorization, { 'mcp-protocol-version': 'unsupported' })).status).toBe(400)
    const invalid = await call('hiyori_create_event', { title: 'invalid', defaultDurationMinutes: 60, candidates: [] })
    expect(invalid.isError).toBe(true)
    expect((await rpc('tools/list', {}, 'Bearer invalid')).status).toBe(401)
  })
})
