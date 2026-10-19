import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs, loginAsBearer } from './test-helpers'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'
const ORGANIZER_ID = '12345678901234567'
const INVITED_ID = '23456789012345678'
const OTHER_ID = '98765432109876543'

async function jsonFetch(path: string, init?: RequestInit) {
  const { headers: extraHeaders, ...rest } = init ?? {}
  return SELF.fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders as Record<string, string> ?? {}) },
  })
}

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) })
}

async function del(path: string, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'DELETE', ...(headers ? { headers } : {}) })
}

async function createEvent(cookie: string, visibility?: 'public' | 'invite_only') {
  const res = await post('/api/events', {
    title: `visibility-${crypto.randomUUID()}`,
    description: 'private detail',
    visibility,
    defaultDurationMinutes: 60,
    candidates: [{ startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' }],
  }, { Cookie: cookie })
  expect(res.status).toBe(201)
  return (await res.json()) as { event: { id: string; title: string; visibility?: string }; candidates: Array<{ id: string }> }
}

function parseSse(text: string): unknown[] {
  return text.split('\n').flatMap((line) => {
    const trimmed = line.trimEnd()
    if (!trimmed.startsWith('data:')) return []
    try { return [JSON.parse(trimmed.slice('data:'.length).trim())] } catch { return [] }
  })
}

async function callMcp(token: string, name: string, args: Record<string, unknown>) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: token,
  }
  const init = await SELF.fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'visibility-test', version: '1' } },
    }),
  })
  expect(init.status).toBe(200)
  const sessionId = init.headers.get('mcp-session-id')
  if (sessionId) headers['mcp-session-id'] = sessionId
  await SELF.fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
  const res = await SELF.fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
  })
  const messages = parseSse(await res.text()) as Array<{ result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: unknown }>
  const message = messages.find((m) => m.result || m.error)
  if (!message?.result) return { isError: true, text: JSON.stringify(message?.error ?? null) }
  return {
    isError: message.result.isError === true,
    text: message.result.content?.map((c) => c.text ?? '').join('') ?? '',
  }
}

beforeEach(async () => {
  await applyMigrations()
  ;(env as { MCP_ENABLED?: string }).MCP_ENABLED = 'true'
})

describe('公開／招待限定イベントの認可', () => {
  const newEventBody = (invitedDiscordUserIds: string[]) => ({
    title: `initial-invites-${crypto.randomUUID()}`,
    visibility: 'invite_only',
    invitedDiscordUserIds,
    defaultDurationMinutes: 60,
    candidates: [{ startAt: '2026-11-01T10:00:00.000Z', endAt: '2026-11-01T11:00:00.000Z' }],
  })

  it('作成時に招待を保存し、重複をまとめて招待済み本人だけに即時アクセスを許可する', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const invited = await loginAs(INVITED_ID)
    const other = await loginAs(OTHER_ID)
    const response = await post('/api/events', newEventBody([INVITED_ID, ` ${INVITED_ID} `]), { Cookie: organizer })
    expect(response.status).toBe(201)
    const { event } = await response.json() as { event: { id: string } }
    const list = await jsonFetch(`/api/events/${event.id}/invites`, { headers: { Cookie: organizer } })
    const { invites } = await list.json() as { invites: Array<{ discordUserId: string }> }
    expect(invites.map((invite) => invite.discordUserId)).toEqual([INVITED_ID])
    expect((await jsonFetch(`/api/events/${event.id}`, { headers: { Cookie: invited } })).status).toBe(200)
    expect((await jsonFetch(`/api/events/${event.id}`, { headers: { Cookie: other } })).status).toBe(404)
    expect((await jsonFetch(`/api/events/${event.id}`)).status).toBe(404)
    expect((await post(`/api/events/${event.id}/participants`, { kind: 'discord', displayName: 'invited' }, { Cookie: invited })).status).toBe(201)
  })

  it('作成時の招待はログインを必要とする', async () => {
    expect((await post('/api/events', newEventBody([INVITED_ID]))).status).toBe(401)
  })

  it('不正なID・上限超過・公開イベントへの招待は作成前に拒否する', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const db = (env as { DB: D1Database }).DB
    for (const body of [
      newEventBody([INVITED_ID, 'username']),
      newEventBody(['1234567890123456']),
      newEventBody(['123456789012345678901']),
      newEventBody(Array.from({ length: 501 }, (_, i) => `${10000000000000000n + BigInt(i)}`)),
      { ...newEventBody([INVITED_ID]), visibility: 'public' },
    ]) {
      expect((await post('/api/events', body, { Cookie: organizer })).status).toBe(400)
      const row = await db.prepare('SELECT COUNT(*) AS count FROM events WHERE title = ?').bind(body.title).first<{ count: number }>()
      expect(row?.count).toBe(0)
    }
  })

  it('500人の初期招待もD1の変数上限を超えずに保存する', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const ids = Array.from({ length: 500 }, (_, i) => `${20000000000000000n + BigInt(i)}`)
    const response = await post('/api/events', newEventBody(ids), { Cookie: organizer })
    expect(response.status).toBe(201)
    const { event } = await response.json() as { event: { id: string } }
    const db = (env as { DB: D1Database }).DB
    const row = await db.prepare('SELECT COUNT(*) AS count FROM event_invites WHERE eventId = ?').bind(event.id).first<{ count: number }>()
    expect(row?.count).toBe(500)
  })

  it('招待挿入に失敗したらイベント・候補・一部の招待をすべてロールバックする', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const db = (env as { DB: D1Database }).DB
    const counts = () => db.prepare('SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM candidates) AS candidates, (SELECT COUNT(*) FROM event_invites) AS invites').first()
    const before = await counts()
    await db.exec(`CREATE TRIGGER reject_initial_invite BEFORE INSERT ON event_invites WHEN NEW.discordUserId = '${OTHER_ID}' BEGIN SELECT RAISE(ABORT, 'test invitation failure'); END;`)
    try {
      const ids = [...Array.from({ length: 21 }, (_, i) => `${30000000000000000n + BigInt(i)}`), OTHER_ID]
      expect((await post('/api/events', newEventBody(ids), { Cookie: organizer })).status).toBe(500)
      expect(await counts()).toEqual(before)
    } finally {
      await db.exec('DROP TRIGGER reject_initial_invite;')
    }
  })

  it('既存互換: visibility 省略のイベントは公開で、ゲスト参加できる', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const created = await createEvent(organizer)
    expect(created.event.visibility).toBe('public')

    const detail = await jsonFetch(`/api/events/${created.event.id}`)
    expect(detail.status).toBe(200)
    const guest = await post(`/api/events/${created.event.id}/participants`, {
      kind: 'guest', displayName: 'public guest',
    })
    expect(guest.status).toBe(201)
  })

  it('招待限定は未認証・別ユーザーを拒否し、招待済み本人と主催者だけを許可する', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const other = await loginAs(OTHER_ID)
    const invited = await loginAs(INVITED_ID)
    const created = await createEvent(organizer, 'invite_only')
    const eventId = created.event.id

    expect((await jsonFetch(`/api/events/${eventId}`)).status).toBe(404)
    expect((await jsonFetch(`/api/events/${eventId}`, { headers: { Cookie: other } })).status).toBe(404)
    expect((await jsonFetch(`/api/events/${eventId}`, { headers: { Cookie: organizer } })).status).toBe(200)

    const add = await post(`/api/events/${eventId}/invites`, { discordUserId: INVITED_ID }, { Cookie: organizer })
    expect(add.status).toBe(201)
    expect((await jsonFetch(`/api/events/${eventId}`, { headers: { Cookie: invited } })).status).toBe(200)

    const guest = await post(`/api/events/${eventId}/participants`, {
      kind: 'guest', displayName: 'must be blocked',
    }, { Cookie: invited })
    expect(guest.status).toBe(403)

    const participant = await post(`/api/events/${eventId}/participants`, {
      kind: 'discord', displayName: 'invited user',
    }, { Cookie: invited })
    expect(participant.status).toBe(201)

    const tallyOther = await jsonFetch(`/api/events/${eventId}/tally`, { headers: { Cookie: other } })
    expect(tallyOther.status).toBe(404)
    expect((await jsonFetch(`/api/events/${eventId}/tally`, { headers: { Cookie: invited } })).status).toBe(200)

    const revoke = await del(`/api/events/${eventId}/invites/${INVITED_ID}`, { Cookie: organizer })
    expect(revoke.status).toBe(204)
    expect((await jsonFetch(`/api/events/${eventId}`, { headers: { Cookie: invited } })).status).toBe(404)
  })

  it('ICS・購読 feed・MCP も招待状態を再評価し、取消後に失効する', async () => {
    const organizer = await loginAs(`${ORGANIZER_ID}1`)
    const invited = await loginAs(`${INVITED_ID}1`)
    const other = await loginAs(`${OTHER_ID}1`)
    const created = await createEvent(organizer, 'invite_only')
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id
    const title = created.event.title

    await post(`/api/events/${eventId}/invites`, { discordUserId: `${INVITED_ID}1` }, { Cookie: organizer })
    await post(`/api/events/${eventId}/participants`, { kind: 'discord', displayName: 'invited user' }, { Cookie: invited })
    const decision = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizer })
    expect(decision.status).toBe(201)

    expect((await jsonFetch(`/api/events/${eventId}/decision.ics`)).status).toBe(404)
    const ics = await jsonFetch(`/api/events/${eventId}/decision.ics`, { headers: { Cookie: invited } })
    expect(ics.status).toBe(200)
    expect(await ics.text()).toContain(title)

    const subscription = await post('/api/subscriptions', {}, { Cookie: invited })
    expect(subscription.status).toBe(201)
    const feedUrl = ((await subscription.json()) as { webcalUrl: string }).webcalUrl
    const feedPath = new URL(feedUrl.replace(/^webcal:/, 'https:')).pathname
    const feedBefore = await jsonFetch(feedPath)
    expect(feedBefore.status).toBe(200)
    expect(await feedBefore.text()).not.toContain(title)

    const invitedMcp = await callMcp(await loginAsBearer(`${INVITED_ID}1`), 'hiyori_get_event', { eventId })
    expect(invitedMcp.isError).toBe(false)
    const otherMcp = await callMcp(await loginAsBearer(`${OTHER_ID}1`), 'hiyori_get_event', { eventId })
    expect(otherMcp.isError).toBe(true)

    await del(`/api/events/${eventId}/invites/${INVITED_ID}1`, { Cookie: organizer })
    const feedAfter = await jsonFetch(feedPath)
    expect(feedAfter.status).toBe(200)
    expect(await feedAfter.text()).not.toContain(title)
    expect((await jsonFetch(`/api/events/${eventId}/decision.ics`, { headers: { Cookie: invited } })).status).toBe(404)
  })
})
