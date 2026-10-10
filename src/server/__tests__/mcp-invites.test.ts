import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { loginAsBearer } from './test-helpers'
import { claimPendingInvites, createInviteClaimer } from '../auth/claim-invites'

vi.mock('../auth/claim-invites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/claim-invites')>()
  return { ...actual, claimPendingInvites: vi.fn(actual.claimPendingInvites) }
})

const BASE = 'https://example.com'
const db = (env as { DB: D1Database }).DB
const mcpEnv = env as { MCP_ENABLED?: string; DISCORD_BOT_TOKEN?: string }
let originalMcpEnabled: string | undefined
let originalBotToken: string | undefined
let nextFreshIdentity = 80000000000000000n

type JsonRpc = { result?: unknown; error?: unknown }
type ToolResult = { isError: boolean; data: unknown; text: string }
type ToolSchema = {
  name: string
  inputSchema: { properties: Record<string, Record<string, unknown>>; required?: string[] }
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}
type Invite = {
  id: string
  eventId: string
  discordUserId: string | null
  discordUsername: string | null
  claimedAt: string | null
  createdAt: string
}
type CreatedEvent = { event: { id: string; visibility: string }; candidates: { id: string }[] }

// Exercise the public MCP transport and its authenticated internal REST calls,
// rather than invoking tool callbacks with a mocked authorization context.
class McpInviteClient {
  private sessionId: string | null = null
  private nextId = 1
  constructor(readonly authorization: string) {}

  private async post(body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: this.authorization,
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId
    const response = await SELF.fetch(`${BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
    this.sessionId = response.headers.get('mcp-session-id') ?? this.sessionId
    return response
  }

  private async request(method: string, params: unknown): Promise<JsonRpc> {
    const id = this.nextId++
    const response = await this.post({ jsonrpc: '2.0', id, method, params })
    expect(response.status).toBe(200)
    const text = await response.text()
    const messages = response.headers.get('content-type')?.includes('text/event-stream')
      ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)))
      : [JSON.parse(text)]
    const message = messages.find((item: { id?: number }) => item.id === id) as JsonRpc | undefined
    if (!message) throw new Error(`Missing MCP response for ${method}: ${text}`)
    return message
  }

  async initialize() {
    const response = await this.request('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'invite-tests', version: '1.0.0' },
    })
    expect(response.error).toBeUndefined()
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  async listTools(): Promise<ToolSchema[]> {
    const response = await this.request('tools/list', {})
    expect(response.error).toBeUndefined()
    return (response.result as { tools: ToolSchema[] }).tools
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const response = await this.request('tools/call', { name, arguments: args })
    // SDK schema validation may use a JSON-RPC error instead of a tool result.
    if (response.error) return { isError: true, data: response.error, text: JSON.stringify(response.error) }
    const result = response.result as { isError?: boolean; content?: { text?: string }[] }
    const text = result.content?.map((item) => item.text ?? '').join('') ?? ''
    let data: unknown = null
    try { data = JSON.parse(text) } catch { /* Validation errors are plain text. */ }
    return { isError: result.isError === true, data, text }
  }
}

// Rate-limit bindings are shared across cases; use a separate owner per fixture
// without disabling the real MCP middleware under test.
async function clientFor(discordUserId = `mcp-invite-owner-${crypto.randomUUID()}`, username?: string) {
  const client = new McpInviteClient(await loginAsBearer(discordUserId, username))
  await client.initialize()
  return client
}

function eventInput(overrides: Record<string, unknown> = {}) {
  return {
    title: `mcp-invites-${crypto.randomUUID()}`,
    visibility: 'invite_only',
    defaultDurationMinutes: 60,
    candidates: [{ startAt: '2026-11-01T10:00:00.000Z' }],
    ...overrides,
  }
}

async function createEvent(client: McpInviteClient, overrides: Record<string, unknown> = {}) {
  const result = await client.callTool('hiyori_create_event', eventInput(overrides))
  expect(result.isError, result.text).toBe(false)
  return result.data as CreatedEvent
}

async function listInvites(client: McpInviteClient, eventId: string): Promise<Invite[]> {
  const result = await client.callTool('hiyori_list_invites', { eventId })
  expect(result.isError, result.text).toBe(false)
  return (result.data as { invites: Invite[] }).invites
}

function counts() {
  return db.prepare('SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM candidates) AS candidates, (SELECT COUNT(*) FROM event_invites) AS invites').first()
}

beforeEach(async () => {
  vi.mocked(claimPendingInvites).mockImplementation(createInviteClaimer())
  await applyD1Migrations(db, inject('d1Migrations'))
  originalMcpEnabled = mcpEnv.MCP_ENABLED
  mcpEnv.MCP_ENABLED = 'true'
  originalBotToken = mcpEnv.DISCORD_BOT_TOKEN
  delete mcpEnv.DISCORD_BOT_TOKEN
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalBotToken === undefined) delete mcpEnv.DISCORD_BOT_TOKEN
  else mcpEnv.DISCORD_BOT_TOKEN = originalBotToken
  if (originalMcpEnabled === undefined) delete mcpEnv.MCP_ENABLED
  else mcpEnv.MCP_ENABLED = originalMcpEnabled
})

describe('MCP invitation schemas', () => {
  it('advertises username-only creation/addition, visibility edits, and record-UUID revocation', async () => {
    const client = await clientFor()
    const tools = await client.listTools()
    expect(tools).toHaveLength(22)
    const schema = (name: string) => {
      const tool = tools.find((item) => item.name === name)
      expect(tool, name).toBeDefined()
      return tool!
    }
    const create = schema('hiyori_create_event').inputSchema
    expect(create.properties.visibility).toMatchObject({ enum: ['public', 'invite_only'] })
    expect(create.properties.invitedDiscordUsernames).toMatchObject({ type: 'array', maxItems: 500, items: { type: 'string' } })
    expect(create.required).not.toContain('visibility')
    expect(create.required).not.toContain('invitedDiscordUsernames')
    expect(create.properties).not.toHaveProperty('invitedDiscordUserIds')
    const edit = schema('hiyori_edit_event').inputSchema
    expect(edit.properties.visibility).toMatchObject({ enum: ['public', 'invite_only'] })
    expect(edit.required).not.toContain('visibility')
    const list = schema('hiyori_list_invites')
    expect(list.inputSchema.required).toEqual(['eventId'])
    expect(list.annotations).toMatchObject({ readOnlyHint: true })
    const add = schema('hiyori_add_invite')
    expect(add.inputSchema.required).toEqual(expect.arrayContaining(['eventId', 'discordUsername']))
    expect(add.inputSchema.properties.discordUsername).toMatchObject({ type: 'string' })
    expect(add.inputSchema.properties).not.toHaveProperty('discordUserId')
    expect(add.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    const revoke = schema('hiyori_revoke_invite')
    expect(revoke.inputSchema.required).toEqual(expect.arrayContaining(['eventId', 'inviteId']))
    expect(revoke.inputSchema.properties.inviteId).toMatchObject({ type: 'string', format: 'uuid' })
    expect(revoke.inputSchema.properties).not.toHaveProperty('discordUserId')
    expect(revoke.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })
})

describe('MCP initial username invitations', () => {
  it('normalizes and deduplicates pending invitations without resolving cached users or numeric usernames', async () => {
    const client = await clientFor()
    await loginAsBearer('23456789012345678', 'known_name')
    const created = await createEvent(client, {
      invitedDiscordUsernames: [' @Known_Name ', 'known_name', 'new.person', '12345678901234567', '12', 'a'.repeat(32)],
    })
    expect(created.event.visibility).toBe('invite_only')
    expect(created.candidates).toHaveLength(1)
    const invites = await listInvites(client, created.event.id)
    expect(invites.map((row) => row.discordUsername).sort()).toEqual(['known_name', 'new.person', '12345678901234567', '12', 'a'.repeat(32)].sort())
    for (const row of invites) {
      expect(row).toEqual({
        id: expect.any(String), eventId: created.event.id, discordUsername: expect.any(String),
        discordUserId: null, claimedAt: null, createdAt: expect.any(String),
      })
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false)
    }
  })

  it.each([undefined, 'public'])('preserves public creation when visibility is %j and invitations are empty', async (visibility) => {
    const client = await clientFor()
    const created = await createEvent(client, { visibility, invitedDiscordUsernames: [] })
    expect(created.event.visibility).toBe('public')
    expect(await listInvites(client, created.event.id)).toEqual([])
    expect((await SELF.fetch(`${BASE}/api/events/${created.event.id}`)).status).toBe(200)
  })

  it.each(['', 'a', '@', '@@name', 'two words', 'two..dots', 'name#1234', 'name-dash', 'ひより', 'a'.repeat(33)])(
    'rejects invalid initial username %j without a partial event', async (discordUsername) => {
      const client = await clientFor()
      const before = await counts()
      const result = await client.callTool('hiyori_create_event', eventInput({ invitedDiscordUsernames: ['valid_name', discordUsername] }))
      expect(result.isError).toBe(true)
      expect(await counts()).toEqual(before)
    },
  )

  it.each([undefined, 'public'])('rejects nonempty invitations with visibility %j through REST validation', async (visibility) => {
    const client = await clientFor()
    const before = await counts()
    const result = await client.callTool('hiyori_create_event', eventInput({ visibility, invitedDiscordUsernames: ['pending_name'] }))
    expect(result.isError).toBe(true)
    expect(result.text).toContain('400')
    expect(await counts()).toEqual(before)
  })

  it('creates 365 candidates and 500 invitations, keeps duplicate adds idempotent, and rejects overflow', async () => {
    const client = await clientFor()
    const invitedDiscordUsernames = Array.from({ length: 500 }, (_, index) => `pending_${index}`)
    const candidates = Array.from({ length: 365 }, (_, index) => ({
      startAt: new Date(Date.parse('2026-11-01T10:00:00.000Z') + index * 2 * 60 * 60 * 1000).toISOString(),
    }))
    const created = await createEvent(client, { candidates, invitedDiscordUsernames })
    expect(created.candidates).toHaveLength(365)
    expect(await listInvites(client, created.event.id)).toHaveLength(500)
    const duplicate = await client.callTool('hiyori_add_invite', { eventId: created.event.id, discordUsername: ' @PENDING_0 ' })
    expect(duplicate.isError, duplicate.text).toBe(false)
    const extra = await client.callTool('hiyori_add_invite', { eventId: created.event.id, discordUsername: 'one_too_many' })
    expect(extra.isError).toBe(true)
    expect(extra.text).toContain('409')
    expect(await listInvites(client, created.event.id)).toHaveLength(500)
    const before = await counts()
    const overflow = await client.callTool('hiyori_create_event', eventInput({ invitedDiscordUsernames: [...invitedDiscordUsernames, 'overflow'] }))
    expect(overflow.isError).toBe(true)
    expect(await counts()).toEqual(before)
  })

  it('rolls back the event, candidates, and earlier invite chunks when a later invite insert fails', async () => {
    const client = await clientFor()
    const before = await counts()
    await db.exec("CREATE TRIGGER reject_mcp_invite BEFORE INSERT ON event_invites WHEN NEW.discordUsername = 'reject_me' BEGIN SELECT RAISE(ABORT, 'test MCP invitation failure'); END;")
    try {
      const result = await client.callTool('hiyori_create_event', eventInput({
        invitedDiscordUsernames: [...Array.from({ length: 40 }, (_, index) => `pending_${index}`), 'reject_me'],
      }))
      expect(result.isError).toBe(true)
      expect(result.text).toContain('500')
      expect(await counts()).toEqual(before)
    } finally {
      await db.exec('DROP TRIGGER reject_mcp_invite;')
    }
  })
})

describe('MCP invitation management and isolation', () => {
  it('lists, normalizes, adds idempotently, and revokes pending invitations by record UUID', async () => {
    const client = await clientFor()
    const { event } = await createEvent(client)
    expect(await listInvites(client, event.id)).toEqual([])
    const added = await client.callTool('hiyori_add_invite', { eventId: event.id, discordUsername: ' @Pending_Name ' })
    expect(added.isError, added.text).toBe(false)
    const first = (added.data as { invite: Invite }).invite
    expect(first).toMatchObject({ eventId: event.id, discordUsername: 'pending_name', discordUserId: null, claimedAt: null })
    const duplicate = await client.callTool('hiyori_add_invite', { eventId: event.id, discordUsername: 'pending_name' })
    expect(duplicate.isError, duplicate.text).toBe(false)
    expect(duplicate.data).toEqual(added.data)
    const numeric = await client.callTool('hiyori_add_invite', { eventId: event.id, discordUsername: '12345678901234567' })
    expect(numeric.isError, numeric.text).toBe(false)
    expect((numeric.data as { invite: Invite }).invite).toMatchObject({ discordUsername: '12345678901234567', discordUserId: null })
    expect(await listInvites(client, event.id)).toHaveLength(2)
    const revoked = await client.callTool('hiyori_revoke_invite', { eventId: event.id, inviteId: first.id })
    expect(revoked.isError, revoked.text).toBe(false)
    expect((await listInvites(client, event.id)).map((row) => row.discordUsername)).toEqual(['12345678901234567'])
    const repeated = await client.callTool('hiyori_revoke_invite', { eventId: event.id, inviteId: first.id })
    expect(repeated.isError).toBe(true)
    expect(repeated.text).toContain('404')
  })

  it('rejects invalid additions and numeric-ID-only input without adding a record', async () => {
    const client = await clientFor()
    const { event } = await createEvent(client)
    for (const input of [
      { discordUsername: 'bad..name' }, { discordUsername: 'name#1234' },
      { discordUsername: '' }, { discordUsername: 123456789 },
      { discordUserId: '23456789012345678' },
    ]) {
      const result = await client.callTool('hiyori_add_invite', { eventId: event.id, ...input })
      expect(result.isError, JSON.stringify(input)).toBe(true)
    }
    expect(await listInvites(client, event.id)).toEqual([])
  })

  it('cannot revoke a different event’s row or use a Discord numeric ID in place of an invite UUID', async () => {
    const client = await clientFor()
    const first = await createEvent(client, { invitedDiscordUsernames: ['same_name'] })
    const second = await createEvent(client, { invitedDiscordUsernames: ['same_name'] })
    const [firstRow] = await listInvites(client, first.event.id)
    const wrongEvent = await client.callTool('hiyori_revoke_invite', { eventId: second.event.id, inviteId: firstRow!.id })
    expect(wrongEvent.isError).toBe(true)
    expect(wrongEvent.text).toContain('404')
    // Legacy numeric invitations remain readable/revocable by their row UUID.
    const legacy = await SELF.fetch(`${BASE}/api/events/${first.event.id}/invites`, {
      method: 'POST', headers: { authorization: client.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ discordUserId: '23456789012345678' }),
    })
    expect(legacy.status).toBe(201)
    const legacyRow = (await legacy.json() as { invite: Invite }).invite
    const numeric = await client.callTool('hiyori_revoke_invite', { eventId: first.event.id, inviteId: '23456789012345678' })
    expect(numeric.isError).toBe(true)
    expect(await listInvites(client, first.event.id)).toHaveLength(2)
    const revoked = await client.callTool('hiyori_revoke_invite', { eventId: first.event.id, inviteId: legacyRow.id })
    expect(revoked.isError, revoked.text).toBe(false)
    expect(await listInvites(client, first.event.id)).toEqual([firstRow])
    expect(await listInvites(client, second.event.id)).toHaveLength(1)
  })

  it('returns identical not-found errors for absent events and nonowners, including invited participants', async () => {
    const owner = await clientFor()
    const invited = await clientFor('23456789012345678')
    const unrelated = await clientFor('34567890123456789')
    const { event } = await createEvent(owner, { invitedDiscordUsernames: ['private_invitee_name'] })
    const legacy = await SELF.fetch(`${BASE}/api/events/${event.id}/invites`, {
      method: 'POST', headers: { authorization: owner.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ discordUserId: '23456789012345678' }),
    })
    expect(legacy.status).toBe(201)
    expect((await invited.callTool('hiyori_get_event', { eventId: event.id })).isError).toBe(false)
    const before = await listInvites(owner, event.id)
    const inviteId = before.find((row) => row.discordUsername !== null)!.id
    const missingId = crypto.randomUUID()
    for (const client of [invited, unrelated]) {
      for (const [name, input] of [
        ['hiyori_list_invites', {}],
        ['hiyori_add_invite', { discordUsername: 'unauthorized_name' }],
        ['hiyori_revoke_invite', { inviteId }],
      ] as const) {
        const existing = await client.callTool(name, { eventId: event.id, ...input })
        const missing = await client.callTool(name, { eventId: missingId, ...input })
        expect(existing.isError).toBe(true)
        expect(existing.text).toContain('404')
        expect(existing).toEqual(missing)
        expect(existing.text).not.toContain('private_invitee_name')
      }
    }
    expect(await listInvites(owner, event.id)).toEqual(before)
  })

  it('does not grant from the cached MCP profile when a fresh Discord lookup is unavailable', async () => {
    const owner = await clientFor()
    const stale = await clientFor('23456789012345678', 'pending_name')
    const { event, candidates } = await createEvent(owner, { invitedDiscordUsernames: ['pending_name'] })
    const me = await stale.callTool('hiyori_whoami')
    expect(me.isError).toBe(false)
    expect(me.data).toMatchObject({ username: 'pending_name' })
    for (const name of ['hiyori_get_event', 'hiyori_tally', 'hiyori_get_my_votes']) {
      const result = await stale.callTool(name, { eventId: event.id })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('404')
    }
    const vote = await stale.callTool('hiyori_vote', {
      eventId: event.id, votes: [{ candidateId: candidates[0]!.id, choice: 'yes' }],
    })
    expect(vote.isError).toBe(true)
    expect(vote.text).toContain('404')
    expect(await db.prepare('SELECT COUNT(*) AS count FROM participants WHERE eventId = ?').bind(event.id).first()).toEqual({ count: 0 })
    expect(await listInvites(owner, event.id)).toEqual([expect.objectContaining({ discordUsername: 'pending_name', discordUserId: null, claimedAt: null })])
    const listed = await stale.callTool('hiyori_list_events')
    expect(listed.isError).toBe(false)
    expect(listed.text).not.toContain(event.id)
  })

  it.each(['hiyori_get_event', 'hiyori_list_events', 'hiyori_tally', 'hiyori_get_my_votes', 'hiyori_vote'])(
    'automatically claims a new invitation through %s using an already initialized MCP Bearer session', async (tool) => {
      const owner = await clientFor()
      const invitedId = String(++nextFreshIdentity)
      // Initialize the real MCP transport before the invitation exists. Neither
      // a fresh OAuth login nor reinitializing this transport is necessary.
      const invited = await clientFor(invitedId, 'cached_previous_name')
      // A different pending name keeps the global lookup precondition true even
      // after this user's invitation is claimed by a tool's first API request.
      await createEvent(owner, { invitedDiscordUsernames: ['not_this_invitee'] })
      const { event, candidates } = await createEvent(owner, { invitedDiscordUsernames: ['current_invitee'] })
      const before = await listInvites(owner, event.id)
      expect(before[0]).toMatchObject({ discordUserId: null, claimedAt: null })
      const sessionsBefore = (await db.prepare('SELECT id FROM sessions ORDER BY id').all()).results
      mcpEnv.DISCORD_BOT_TOKEN = 'mcp-existing-session-test-bot'
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        expect(url).toBe(`https://discord.com/api/v10/users/${invitedId}`)
        expect(init?.method ?? 'GET').toBe('GET')
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bot mcp-existing-session-test-bot')
        return Response.json({ id: invitedId, username: 'current_invitee', discriminator: '0', global_name: null, avatar: null })
      })
      const result = await invited.callTool(tool, tool === 'hiyori_list_events' ? {} : {
        eventId: event.id,
        ...(tool === 'hiyori_vote' ? { votes: [{ candidateId: candidates[0]!.id, choice: 'yes' }] } : {}),
      })
      expect(result.isError, result.text).toBe(false)
      if (tool === 'hiyori_list_events' || tool === 'hiyori_get_event') expect(result.text).toContain(event.id)
      const apiRequests = tool === 'hiyori_get_event' || tool === 'hiyori_vote' ? 2 : 1
      expect(fetchSpy).toHaveBeenCalledTimes(apiRequests)
      expect((await db.prepare('SELECT id FROM sessions ORDER BY id').all()).results).toEqual(sessionsBefore)
      const bound = await listInvites(owner, event.id)
      expect(bound).toEqual([expect.objectContaining({
        id: before[0]!.id, discordUserId: invitedId, discordUsername: 'current_invitee', claimedAt: expect.any(String),
      })])
      if (tool === 'hiyori_vote') {
        expect(await db.prepare('SELECT COUNT(*) AS count FROM participants WHERE eventId = ? AND discordUserId = ?')
          .bind(event.id, invitedId).first()).toEqual({ count: 1 })
        const votes = await invited.callTool('hiyori_get_my_votes', { eventId: event.id })
        expect(votes.isError, votes.text).toBe(false)
        expect(votes.data).toMatchObject({ votes: [expect.objectContaining({ choice: 'yes' })] })
      }
    },
  )

  it('edits visibility through organizer authorization and preserves existing invitations', async () => {
    const owner = await clientFor()
    const other = await clientFor('mcp-invite-other')
    const { event } = await createEvent(owner, { visibility: 'public' })
    const forbidden = await other.callTool('hiyori_edit_event', { eventId: event.id, visibility: 'invite_only' })
    expect(forbidden.isError).toBe(true)
    expect(forbidden.text).toContain('403')
    const restricted = await owner.callTool('hiyori_edit_event', { eventId: event.id, visibility: 'invite_only' })
    expect(restricted.isError, restricted.text).toBe(false)
    expect((await SELF.fetch(`${BASE}/api/events/${event.id}`)).status).toBe(404)
    const added = await owner.callTool('hiyori_add_invite', { eventId: event.id, discordUsername: 'pending_name' })
    expect(added.isError, added.text).toBe(false)
    const before = await listInvites(owner, event.id)
    const published = await owner.callTool('hiyori_edit_event', { eventId: event.id, visibility: 'public' })
    expect(published.isError, published.text).toBe(false)
    expect((await SELF.fetch(`${BASE}/api/events/${event.id}`)).status).toBe(200)
    expect(await listInvites(owner, event.id)).toEqual(before)
  })
})
