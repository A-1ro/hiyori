import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { loginAs, loginAsBearer } from './test-helpers'

const BASE = 'https://example.com'
const ORGANIZER_ID = '12345678901234567'
const INVITED_ID = '23456789012345678'
const OTHER_ID = '34567890123456789'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'
const ME_URL = 'https://discord.com/api/v10/users/@me'
const db = (env as { DB: D1Database }).DB
const oauthEnv = env as { DISCORD_CLIENT_ID?: string; DISCORD_CLIENT_SECRET?: string; DISCORD_BOT_TOKEN?: string }
let originalClientId: string | undefined
let originalClientSecret: string | undefined
let originalBotToken: string | undefined

type Invite = {
  id: string
  eventId: string
  discordUserId: string | null
  discordUsername: string | null
  claimedAt: string | null
  createdAt: string
}

type DiscordProfile = {
  id: string
  username: string
  global_name?: string | null
  discriminator?: string | null
}

async function request(path: string, init: RequestInit = {}) {
  return SELF.fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers as Record<string, string> },
  })
}

function post(path: string, body: unknown, cookie?: string) {
  return request(path, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: JSON.stringify(body),
  })
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    title: `username-invites-${crypto.randomUUID()}`,
    visibility: 'invite_only',
    defaultDurationMinutes: 60,
    candidates: [{ startAt: '2026-11-01T10:00:00.000Z', endAt: '2026-11-01T11:00:00.000Z' }],
    ...overrides,
  }
}

async function createEvent(cookie: string, overrides: Record<string, unknown> = {}) {
  const response = await post('/api/events', eventBody(overrides), cookie)
  expect(response.status).toBe(201)
  const result = await response.json() as { event: { id: string }; candidates: Array<{ id: string }> }
  return result.event.id
}

async function invites(eventId: string, cookie: string): Promise<Invite[]> {
  const response = await request(`/api/events/${eventId}/invites`, { headers: { Cookie: cookie } })
  expect(response.status).toBe(200)
  return (await response.json() as { invites: Invite[] }).invites
}

async function revoke(eventId: string, inviteId: string, cookie: string) {
  return request(`/api/events/${eventId}/invites/${inviteId}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  })
}

async function access(eventId: string, cookie: string) {
  return request(`/api/events/${eventId}`, { headers: { Cookie: cookie } })
}

// Only a successful, fresh identify response may bind a username invite. Every
// unexpected outbound request fails: these tests cannot silently search Discord.
function mockDiscord() {
  const profiles = new Map<string, DiscordProfile>()
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === TOKEN_URL) {
      expect(init?.method).toBe('POST')
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      const code = body.get('code')!
      expect(profiles.has(code)).toBe(true)
      return Response.json({ access_token: code })
    }
    if (url === ME_URL) {
      const authorization = new Headers(init?.headers).get('Authorization')
      const profile = profiles.get(authorization?.replace(/^Bearer /, '') ?? '')
      expect(profile).toBeDefined()
      return Response.json({ discriminator: '0', ...profile, global_name: profile!.global_name ?? null, avatar: null })
    }
    throw new Error(`Unexpected outbound request: ${url}`)
  })

  async function prepare(profile: DiscordProfile, returnTo = '/') {
    const code = crypto.randomUUID()
    profiles.set(code, profile)
    const authorize = await request(`/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`, { redirect: 'manual' })
    expect(authorize.status).toBe(302)
    const location = new URL(authorize.headers.get('location')!)
    expect(`${location.origin}${location.pathname}`).toBe('https://discord.com/api/oauth2/authorize')
    expect(location.searchParams.get('scope')).toBe('identify')
    const stateCookie = authorize.headers.get('set-cookie')!.match(/hiyori_oauth_state=[^;]+/)![0]
    const path = `/api/auth/discord/callback?${new URLSearchParams({ code, state: location.searchParams.get('state')! })}`
    return () => request(path, { headers: { Cookie: stateCookie }, redirect: 'manual' })
  }

  async function login(profile: DiscordProfile, returnTo = '/') {
    const callback = await prepare(profile, returnTo)
    const response = await callback()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(returnTo)
    const cookie = response.headers.get('set-cookie')?.match(/hiyori_session=[^;]+/)?.[0]
    expect(cookie).toBeDefined()
    return cookie!
  }

  return { fetchSpy, prepare, login }
}

beforeEach(async () => {
  await applyD1Migrations(db, inject('d1Migrations'))
  originalClientId = oauthEnv.DISCORD_CLIENT_ID
  originalClientSecret = oauthEnv.DISCORD_CLIENT_SECRET
  originalBotToken = oauthEnv.DISCORD_BOT_TOKEN
  delete oauthEnv.DISCORD_BOT_TOKEN
  oauthEnv.DISCORD_CLIENT_ID = 'username-invite-test-client'
  oauthEnv.DISCORD_CLIENT_SECRET = 'username-invite-test-secret'
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalBotToken === undefined) delete oauthEnv.DISCORD_BOT_TOKEN
  else oauthEnv.DISCORD_BOT_TOKEN = originalBotToken
  if (originalClientId === undefined) delete oauthEnv.DISCORD_CLIENT_ID
  else oauthEnv.DISCORD_CLIENT_ID = originalClientId
  if (originalClientSecret === undefined) delete oauthEnv.DISCORD_CLIENT_SECRET
  else oauthEnv.DISCORD_CLIENT_SECRET = originalClientSecret
})

describe('pending Discord username invitation creation', () => {
  it('normalizes and deduplicates mixed initial invites without resolving cached users or calling Discord', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    await loginAs(INVITED_ID, 'known_name')
    const { fetchSpy } = mockDiscord()
    const eventId = await createEvent(organizer, {
      invitedDiscordUserIds: [OTHER_ID, ` ${OTHER_ID} `],
      invitedDiscordUsernames: [' @Known_Name ', 'known_name', 'new.person', '12345678901234567'],
    })
    const rows = await invites(eventId, organizer)
    expect(rows).toHaveLength(4)
    const pending = rows.filter((row) => row.discordUsername !== null)
    expect(pending.map((row) => row.discordUsername).sort()).toEqual(['12345678901234567', 'known_name', 'new.person'])
    for (const row of pending) {
      expect(row).toEqual({
        id: expect.any(String), eventId, discordUserId: null, discordUsername: expect.any(String),
        claimedAt: null, createdAt: expect.any(String),
      })
      expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false)
    }
    expect(rows.find((row) => row.discordUserId === OTHER_ID)).toMatchObject({ discordUsername: null, claimedAt: null })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each(['', 'a', '@', '@@name', 'two words', 'two..dots', 'name#1234', 'name-dash', 'ひより', 'a'.repeat(33)])(
    'rejects invalid username %j before persisting an event', async (username) => {
      const organizer = await loginAs(ORGANIZER_ID)
      const body = eventBody({ invitedDiscordUsernames: [username] })
      expect((await post('/api/events', body, organizer)).status).toBe(400)
      expect(await db.prepare('SELECT id FROM events WHERE title = ?').bind(body.title).first()).toBeNull()
    },
  )

  it('accepts two- and 32-character usernames, including numeric usernames', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['12', 'a'.repeat(32), 'a_b.c'] })
    expect((await invites(eventId, organizer)).map((row) => row.discordUsername).sort()).toEqual(['12', 'a'.repeat(32), 'a_b.c'].sort())
  })

  it('requires login and rejects username invitations on public events', async () => {
    expect((await post('/api/events', eventBody({ invitedDiscordUsernames: ['private_name'] }))).status).toBe(401)
    const organizer = await loginAs(ORGANIZER_ID)
    const body = eventBody({ visibility: 'public', invitedDiscordUsernames: ['private_name'] })
    expect((await post('/api/events', body, organizer)).status).toBe(400)
    expect(await db.prepare('SELECT id FROM events WHERE title = ?').bind(body.title).first()).toBeNull()
  })

  it('persists 365 candidates plus 500 mixed invitations within D1 limits and rejects a combined 501', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const ids = Array.from({ length: 250 }, (_, i) => String(40000000000000000n + BigInt(i)))
    const usernames = Array.from({ length: 250 }, (_, i) => `pending_${i}`)
    const candidates = Array.from({ length: 365 }, (_, i) => ({
      startAt: new Date(Date.parse('2026-11-01T10:00:00.000Z') + i * 2 * 60 * 60 * 1000).toISOString(),
    }))
    const eventId = await createEvent(organizer, {
      invitedDiscordUserIds: [...ids, ...ids], invitedDiscordUsernames: [...usernames, ...usernames], candidates,
    })
    expect(await db.prepare('SELECT COUNT(*) AS count FROM candidates WHERE eventId = ?').bind(eventId).first()).toEqual({ count: 365 })
    const rows = await invites(eventId, organizer)
    expect(rows).toHaveLength(500)
    expect(rows.filter((row) => row.discordUserId !== null)).toHaveLength(250)
    expect(rows.filter((row) => row.discordUsername !== null)).toHaveLength(250)
    const body = eventBody({ invitedDiscordUserIds: ids, invitedDiscordUsernames: [...usernames, 'too_many'] })
    expect((await post('/api/events', body, organizer)).status).toBe(400)
    expect(await db.prepare('SELECT id FROM events WHERE title = ?').bind(body.title).first()).toBeNull()
  })

  it('enforces the combined cap on later additions while allowing an existing normalized invitation', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, {
      invitedDiscordUserIds: [INVITED_ID],
      invitedDiscordUsernames: Array.from({ length: 499 }, (_, i) => `at_capacity_${i}`),
    })
    expect((await post(`/api/events/${eventId}/invites`, { discordUsername: '@AT_CAPACITY_0' }, organizer)).status).toBe(200)
    expect((await post(`/api/events/${eventId}/invites`, { discordUserId: INVITED_ID }, organizer)).status).toBe(200)
    expect((await post(`/api/events/${eventId}/invites`, { discordUsername: 'one_too_many' }, organizer)).status).toBe(409)
    expect((await post(`/api/events/${eventId}/invites`, { discordUserId: OTHER_ID }, organizer)).status).toBe(409)
    expect(await invites(eventId, organizer)).toHaveLength(500)
  })

  it('rolls back event, candidates, numeric invites and prior username chunks if a username insert fails', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const counts = () => db.prepare('SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM candidates) AS candidates, (SELECT COUNT(*) FROM event_invites) AS invites').first()
    const before = await counts()
    await db.exec("CREATE TRIGGER reject_username_invite BEFORE INSERT ON event_invites WHEN NEW.discordUsername = 'reject_me' BEGIN SELECT RAISE(ABORT, 'test username insertion failure'); END;")
    try {
      const body = eventBody({
        invitedDiscordUserIds: [INVITED_ID],
        invitedDiscordUsernames: [...Array.from({ length: 40 }, (_, i) => `pending_${i}`), 'reject_me'],
      })
      expect((await post('/api/events', body, organizer)).status).toBe(500)
      expect(await counts()).toEqual(before)
    } finally {
      await db.exec('DROP TRIGGER reject_username_invite;')
    }
  })

  it('adds a normalized pending username idempotently, without trusting client claimedAt or cached names', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    await loginAs(INVITED_ID, 'pending_name')
    const { fetchSpy } = mockDiscord()
    const eventId = await createEvent(organizer)
    const forged = await post(`/api/events/${eventId}/invites`, { discordUsername: ' @PENDING_Name ', claimedAt: '2020-01-01T00:00:00.000Z' }, organizer)
    expect(forged.status).toBe(400)
    const first = await post(`/api/events/${eventId}/invites`, { discordUsername: ' @PENDING_Name ' }, organizer)
    expect(first.status).toBe(201)
    const second = await post(`/api/events/${eventId}/invites`, { discordUsername: 'pending_name' }, organizer)
    expect(second.status).toBe(200)
    const rows = await invites(eventId, organizer)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ discordUsername: 'pending_name', discordUserId: null, claimedAt: null })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('requires exactly one identifier when adding an invite', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer)
    for (const body of [
      {}, { discordUserId: INVITED_ID, discordUsername: 'ambiguous' },
      { discordUserId: '', discordUsername: 'ambiguous' },
      { discordUsername: null }, { discordUsername: 'bad..name' },
      { discordUsername: ['array_name'] }, { discordUserId: 'short' },
    ]) {
      expect((await post(`/api/events/${eventId}/invites`, body, organizer)).status).toBe(400)
    }
    expect(await invites(eventId, organizer)).toEqual([])
  })
})

describe('fresh OAuth username binding and authorization', () => {
  it('claims only after identify /users/@me, exposes a one-time claimedAt and grants immediate event access', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: [' @TARGET_Name '] })
    const before = (await invites(eventId, organizer))[0]!
    const { login, fetchSpy } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'target_name' }, `/events/${eventId}`)
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([TOKEN_URL, ME_URL])
    const after = (await invites(eventId, organizer))[0]!
    expect(after).toMatchObject({ id: before.id, eventId, discordUsername: 'target_name', discordUserId: INVITED_ID, createdAt: before.createdAt })
    expect(after.claimedAt).toEqual(expect.any(String))
    expect(Number.isNaN(Date.parse(after.claimedAt!))).toBe(false)
    expect((await access(eventId, cookie)).status).toBe(200)
    expect((await post(`/api/events/${eventId}/participants`, { kind: 'discord', displayName: 'Participant' }, cookie)).status).toBe(201)
    await login({ id: INVITED_ID, username: 'target_name' })
    expect((await invites(eventId, organizer))[0]).toEqual(after)
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('does not claim from stale cookie or Bearer profiles without a fresh lookup, or from display names and query params', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const staleCookie = await loginAs(INVITED_ID, 'stale_name')
    const staleBearer = await loginAsBearer(OTHER_ID, 'stale_name')
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['stale_name'] })
    const { fetchSpy } = mockDiscord()
    for (const headers of [{ Cookie: staleCookie }, { Authorization: staleBearer }] as Array<Record<string, string>>) {
      const me = await request('/api/auth/me', { headers })
      expect(me.status).toBe(200)
      expect((await me.json() as { user: { username: string } }).user.username).toBe('stale_name')
      for (const suffix of ['', '/tally']) {
        const response = await request(`/api/events/${eventId}${suffix}?discordUsername=stale_name`, { headers })
        expect(response.status).toBe(404)
      }
      const join = await request(`/api/events/${eventId}/participants`, {
        method: 'POST', headers, body: JSON.stringify({ kind: 'discord', displayName: 'stale_name', discordUsername: 'stale_name' }),
      })
      expect(join.status).toBe(404)
    }
    expect((await invites(eventId, organizer))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('matches the fresh username rather than a cached username or Discord display name', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    await loginAs(INVITED_ID, 'old_name')
    const oldEvent = await createEvent(organizer, { invitedDiscordUsernames: ['old_name'] })
    const newEvent = await createEvent(organizer, { invitedDiscordUsernames: ['current_name'] })
    const { login } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'current_name', global_name: 'old_name' })
    expect((await invites(oldEvent, organizer))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
    expect((await access(oldEvent, cookie)).status).toBe(404)
    expect((await invites(newEvent, organizer))[0]).toMatchObject({ discordUserId: INVITED_ID, discordUsername: 'current_name' })
    expect((await access(newEvent, cookie)).status).toBe(200)
  })

  it('keeps the first ID and original invited username across rename, name reuse, and duplicate re-add', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['original_name'] })
    const { login } = mockDiscord()
    await login({ id: INVITED_ID, username: 'original_name' })
    const first = (await invites(eventId, organizer))[0]!
    const renamedCookie = await login({ id: INVITED_ID, username: 'new_name' })
    const reuseCookie = await login({ id: OTHER_ID, username: 'original_name' })
    expect((await invites(eventId, organizer))[0]).toEqual(first)
    expect((await access(eventId, renamedCookie)).status).toBe(200)
    expect((await access(eventId, reuseCookie)).status).toBe(404)
    expect((await post(`/api/events/${eventId}/invites`, { discordUsername: '@ORIGINAL_Name' }, organizer)).status).toBe(200)
    expect(await invites(eventId, organizer)).toEqual([first])
  })

  it('claims matching pending invitations across events without expiry', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const firstEvent = await createEvent(organizer, { invitedDiscordUsernames: ['long_wait'] })
    const secondEvent = await createEvent(organizer, { invitedDiscordUsernames: ['long_wait'] })
    await db.prepare('UPDATE event_invites SET createdAt = ? WHERE discordUsername = ?').bind(Date.parse('2000-01-01T00:00:00Z'), 'long_wait').run()
    const { login } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'long_wait' })
    for (const eventId of [firstEvent, secondEvent]) {
      const rows = await invites(eventId, organizer)
      expect(rows[0]).toMatchObject({ discordUserId: INVITED_ID, discordUsername: 'long_wait', createdAt: '2000-01-01T00:00:00.000Z' })
      expect(rows[0]!.claimedAt).not.toBeNull()
      expect((await access(eventId, cookie)).status).toBe(200)
    }
  })

  it('does not bind a pending invitation when Discord identity lookup fails', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['unverified_name'] })
    const { prepare, fetchSpy } = mockDiscord()
    const callback = await prepare({ id: INVITED_ID, username: 'unverified_name' })
    fetchSpy.mockImplementation(async (input) => {
      if (String(input) === TOKEN_URL) return Response.json({ access_token: 'unverified' })
      if (String(input) === ME_URL) return new Response('Unauthorized', { status: 401 })
      throw new Error(`Unexpected outbound request: ${String(input)}`)
    })
    const response = await callback()
    expect(response.status).toBe(500)
    expect(response.headers.get('set-cookie')).not.toContain('hiyori_session=')
    expect((await invites(eventId, organizer))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
  })

  it('rolls back the profile and new session when claiming a username fails', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    await loginAs(INVITED_ID, 'cached_old_name')
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['claim_failure'] })
    const sessionsBefore = await db.prepare('SELECT COUNT(*) AS count FROM sessions').first()
    await db.exec("CREATE TRIGGER reject_username_claim BEFORE UPDATE ON event_invites WHEN NEW.discordUsername = 'claim_failure' BEGIN SELECT RAISE(ABORT, 'test username claim failure'); END;")
    try {
      const { prepare } = mockDiscord()
      const callback = await prepare({ id: INVITED_ID, username: 'claim_failure' })
      const response = await callback()
      expect(response.status).toBe(500)
      expect(response.headers.get('set-cookie')).not.toContain('hiyori_session=')
      expect(await db.prepare('SELECT username FROM users WHERE discordUserId = ?').bind(INVITED_ID).first()).toEqual({ username: 'cached_old_name' })
      expect(await db.prepare('SELECT COUNT(*) AS count FROM sessions').first()).toEqual(sessionsBefore)
      expect((await invites(eventId, organizer))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
    } finally {
      await db.exec('DROP TRIGGER reject_username_claim;')
    }
  })

  it('handles concurrent first logins for the same account without duplicating its user or invite', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const firstLoginId = '45678901234567890'
    expect(await db.prepare('SELECT id FROM users WHERE discordUserId = ?').bind(firstLoginId).first()).toBeNull()
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['same_account'] })
    const { login } = mockDiscord()
    const cookies = await Promise.all([
      login({ id: firstLoginId, username: 'same_account' }),
      login({ id: firstLoginId, username: 'same_account' }),
    ])
    expect(await db.prepare('SELECT COUNT(*) AS count FROM users WHERE discordUserId = ?').bind(firstLoginId).first()).toEqual({ count: 1 })
    expect(await db.prepare('SELECT COUNT(*) AS count FROM sessions s JOIN users u ON u.id = s.userId WHERE u.discordUserId = ?').bind(firstLoginId).first()).toEqual({ count: 2 })
    expect(await invites(eventId, organizer)).toHaveLength(1)
    for (const cookie of cookies) expect((await access(eventId, cookie)).status).toBe(200)
  })

  it.each([undefined, null, '1234'])('never claims a legacy or unverified username with discriminator %j', async (discriminator) => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['nonunique_name'] })
    const { login } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'nonunique_name', discriminator })
    expect((await invites(eventId, organizer))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
    expect((await access(eventId, cookie)).status).toBe(404)
  })

  it('allows at most one competing fresh identity to bind a pending row', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['racing_name'] })
    const { login } = mockDiscord()
    const cookies = await Promise.all([
      login({ id: INVITED_ID, username: 'racing_name' }),
      login({ id: OTHER_ID, username: 'racing_name' }),
    ])
    const rows = await invites(eventId, organizer)
    expect(rows).toHaveLength(1)
    expect([INVITED_ID, OTHER_ID]).toContain(rows[0]!.discordUserId)
    const statuses = await Promise.all(cookies.map(async (cookie) => (await access(eventId, cookie)).status))
    expect(statuses.sort()).toEqual([200, 404])
    const winner = rows[0]!
    await login({ id: winner.discordUserId === INVITED_ID ? OTHER_ID : INVITED_ID, username: 'racing_name' })
    expect(await invites(eventId, organizer)).toEqual([winner])
  })
})

describe('username invitation revocation and privacy', () => {
  it('revokes a pending row by its ID and a later matching login cannot recreate it', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['revoked_name'] })
    const row = (await invites(eventId, organizer))[0]!
    expect((await revoke(eventId, row.id, organizer)).status).toBe(204)
    const { login } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'revoked_name' })
    expect(await invites(eventId, organizer)).toEqual([])
    expect((await access(eventId, cookie)).status).toBe(404)
  })

  it.each(['row ID', 'numeric ID'] as const)('revokes a bound username by %s and never restores access on login', async (identifier) => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['bound_name'] })
    const { login } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'bound_name' })
    const row = (await invites(eventId, organizer))[0]!
    expect((await revoke(eventId, identifier === 'row ID' ? row.id : INVITED_ID, organizer)).status).toBe(204)
    expect((await access(eventId, cookie)).status).toBe(404)
    const relogin = await login({ id: INVITED_ID, username: 'bound_name' })
    expect((await access(eventId, relogin)).status).toBe(404)
    expect(await invites(eventId, organizer)).toEqual([])
  })

  it.each(['original numeric row', 'original username row'] as const)('retains both row IDs on an ID collision and revocation by the %s removes all grants', async (identifier) => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUserIds: [INVITED_ID], invitedDiscordUsernames: ['same_person'] })
    const unrelatedEvent = await createEvent(organizer, { invitedDiscordUserIds: [INVITED_ID], invitedDiscordUsernames: ['same_person'] })
    const before = await invites(eventId, organizer)
    const numericRow = before.find((row) => row.discordUsername === null)!
    const usernameRow = before.find((row) => row.discordUsername === 'same_person')!
    const { login } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'same_person' })
    const after = await invites(eventId, organizer)
    const unrelatedBefore = await invites(unrelatedEvent, organizer)
    expect(after).toHaveLength(2)
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort())
    expect(after.every((row) => row.discordUserId === INVITED_ID)).toBe(true)
    expect(after.find((row) => row.id === usernameRow.id)!.claimedAt).not.toBeNull()
    const rowId = identifier === 'original numeric row' ? numericRow.id : usernameRow.id
    expect((await revoke(eventId, rowId, organizer)).status).toBe(204)
    expect(await invites(eventId, organizer)).toEqual([])
    expect((await access(eventId, cookie)).status).toBe(404)
    expect(await invites(unrelatedEvent, organizer)).toEqual(unrelatedBefore)
    expect((await access(unrelatedEvent, cookie)).status).toBe(200)
    await login({ id: INVITED_ID, username: 'same_person' })
    expect(await invites(eventId, organizer)).toEqual([])
    expect(await invites(unrelatedEvent, organizer)).toEqual(unrelatedBefore)
  })

  it('revoking a still-pending username leaves an independent numeric invitation intact', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUserIds: [INVITED_ID], invitedDiscordUsernames: ['not_verified_yet'] })
    const before = await invites(eventId, organizer)
    const pending = before.find((row) => row.discordUsername !== null)!
    expect((await revoke(eventId, pending.id, organizer)).status).toBe(204)
    const { login } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'not_verified_yet' })
    expect(await invites(eventId, organizer)).toEqual([before.find((row) => row.discordUsername === null)!])
    expect((await access(eventId, cookie)).status).toBe(200)
  })

  it('a claim racing a row-ID revoke cannot resurrect the invitation', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['race_revoke'] })
    const row = (await invites(eventId, organizer))[0]!
    const { prepare } = mockDiscord()
    const callback = await prepare({ id: INVITED_ID, username: 'race_revoke' })
    const [claimed, revoked] = await Promise.all([callback(), revoke(eventId, row.id, organizer)])
    expect(claimed.status).toBe(302)
    expect(revoked.status).toBe(204)
    expect(await invites(eventId, organizer)).toEqual([])
    const cookie = claimed.headers.get('set-cookie')!.match(/hiyori_session=[^;]+/)![0]
    expect((await access(eventId, cookie)).status).toBe(404)
  })

  it('only organizers can list or mutate invitations and other responses never reveal invited usernames', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const invited = await loginAs(INVITED_ID)
    const other = await loginAs(OTHER_ID)
    const hiddenName = 'private_invitee_name'
    const eventId = await createEvent(organizer, { invitedDiscordUserIds: [INVITED_ID], invitedDiscordUsernames: [hiddenName] })
    const pending = (await invites(eventId, organizer)).find((row) => row.discordUsername !== null)!
    for (const cookie of [invited, other]) {
      const missingId = crypto.randomUUID()
      const responses = [
        [
          await request(`/api/events/${eventId}/invites`, { headers: { Cookie: cookie } }),
          await request(`/api/events/${missingId}/invites`, { headers: { Cookie: cookie } }),
        ],
        [
          await post(`/api/events/${eventId}/invites`, { discordUsername: 'unauthorized_name' }, cookie),
          await post(`/api/events/${missingId}/invites`, { discordUsername: 'unauthorized_name' }, cookie),
        ],
        [await revoke(eventId, pending.id, cookie), await revoke(missingId, pending.id, cookie)],
      ]
      for (const [existing, missing] of responses) {
        expect(existing!.status).toBe(404)
        expect(missing!.status).toBe(404)
        const text = await existing!.text()
        expect(text).toBe(await missing!.text())
        expect(text).not.toContain(hiddenName)
      }
    }
    const anonymousList = await request(`/api/events/${eventId}/invites`)
    expect(anonymousList.status).toBe(401)
    expect(await anonymousList.text()).not.toContain(hiddenName)
    for (const suffix of ['', '/tally']) {
      for (const cookie of [organizer, invited, other, undefined]) {
        const response = await request(`/api/events/${eventId}${suffix}`, { headers: cookie ? { Cookie: cookie } : {} })
        expect(response.status).toBe(cookie === organizer || cookie === invited ? 200 : 404)
        const text = await response.text()
        expect(text).not.toContain(hiddenName)
        expect(text).not.toContain('discordUsername')
        expect(text).not.toContain('claimedAt')
      }
    }
    expect(await invites(eventId, organizer)).toHaveLength(2)
  })

  it('removes a revoked participant from my events and never reveals later private title changes', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const eventId = await createEvent(organizer, { invitedDiscordUsernames: ['former_participant'] })
    const { login } = mockDiscord()
    const cookie = await login({ id: INVITED_ID, username: 'former_participant' })
    expect((await post(`/api/events/${eventId}/participants`, { kind: 'discord', displayName: 'Former participant' }, cookie)).status).toBe(201)
    const before = await request('/api/me/events', { headers: { Cookie: cookie } })
    expect(before.status).toBe(200)
    expect((await before.json() as { participating: Array<{ id: string }> }).participating.map((event) => event.id)).toContain(eventId)
    const row = (await invites(eventId, organizer))[0]!
    expect((await revoke(eventId, row.id, organizer)).status).toBe(204)
    const secretTitle = `after-revocation-secret-${crypto.randomUUID()}`
    const patch = await request(`/api/events/${eventId}`, {
      method: 'PATCH', headers: { Cookie: organizer }, body: JSON.stringify({ title: secretTitle }),
    })
    expect(patch.status).toBe(200)
    expect(await db.prepare('SELECT COUNT(*) AS count FROM participants WHERE eventId = ? AND discordUserId = ?').bind(eventId, INVITED_ID).first()).toEqual({ count: 1 })
    const bearer = await loginAsBearer(INVITED_ID, 'former_participant')
    for (const headers of [{ Cookie: cookie }, { Authorization: bearer }] as Array<Record<string, string>>) {
      const response = await request('/api/me/events', { headers })
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).not.toContain(eventId)
      expect(text).not.toContain(secretTitle)
    }
  })

  it('an invitation racing event deletion never leaves an orphan or reports a false capacity conflict', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    for (let attempt = 0; attempt < 4; attempt++) {
      const eventId = await createEvent(organizer)
      const add = async () => ({
        action: 'add',
        response: await post(`/api/events/${eventId}/invites`, { discordUsername: `delete_race_${attempt}` }, organizer),
      })
      const remove = async () => ({
        action: 'delete',
        response: await request(`/api/events/${eventId}`, { method: 'DELETE', headers: { Cookie: organizer } }),
      })
      const operations = attempt % 2 === 0 ? [add, remove] : [remove, add]
      const results = await Promise.all(operations.map((operation) => operation()))
      expect(results.find((result) => result.action === 'delete')!.response.status).toBe(204)
      expect([201, 404]).toContain(results.find((result) => result.action === 'add')!.response.status)
      expect(await db.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first()).toBeNull()
      expect(await db.prepare('SELECT COUNT(*) AS count FROM event_invites WHERE eventId = ?').bind(eventId).first()).toEqual({ count: 0 })
      expect(await db.prepare('SELECT COUNT(*) AS count FROM candidates WHERE eventId = ?').bind(eventId).first()).toEqual({ count: 0 })
    }
  })

  it('a row ID from another event cannot revoke invitations in this event', async () => {
    const organizer = await loginAs(ORGANIZER_ID)
    const firstEvent = await createEvent(organizer, { invitedDiscordUsernames: ['same_name'] })
    const secondEvent = await createEvent(organizer, { invitedDiscordUsernames: ['same_name'] })
    const firstRow = (await invites(firstEvent, organizer))[0]!
    expect((await revoke(secondEvent, firstRow.id, organizer)).status).toBe(404)
    expect(await invites(firstEvent, organizer)).toHaveLength(1)
    expect(await invites(secondEvent, organizer)).toHaveLength(1)
  })
})
