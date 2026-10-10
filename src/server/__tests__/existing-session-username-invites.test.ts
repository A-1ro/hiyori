import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { loginAs, loginAsBearer, loginAsExpired } from './test-helpers'
import { claimPendingInvites, createInviteClaimer } from '../auth/claim-invites'

// Keep the actual middleware and claimer implementation; only reset transient
// isolate-level throttling state between independent integration fixtures.
vi.mock('../auth/claim-invites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/claim-invites')>()
  return { ...actual, claimPendingInvites: vi.fn(actual.claimPendingInvites) }
})

const BASE = 'https://example.com'
const BOT_TOKEN = 'existing-session-test-bot-token'
const db = (env as { DB: D1Database }).DB
const botEnv = env as { DISCORD_BOT_TOKEN?: string }
let originalBotToken: string | undefined
let nextDiscordId = 70000000000000000n

type CreatedEvent = { event: { id: string; title: string }; candidates: Array<{ id: string }> }
type Invite = { id: string; discordUserId: string | null; discordUsername: string | null; claimedAt: number | null }
type Profile = Record<string, unknown>
type AuthKind = 'cookie' | 'CLI Bearer'

function discordId() {
  return String(++nextDiscordId)
}

function request(path: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return SELF.fetch(`${BASE}${path}`, {
    ...init, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function post(path: string, body: unknown, headers: Record<string, string>) {
  return request(path, headers, { method: 'POST', body: JSON.stringify(body) })
}

async function createEvent(owner: Record<string, string>, overrides: Record<string, unknown> = {}) {
  const response = await post('/api/events', {
    title: `existing-session-${crypto.randomUUID()}`,
    visibility: 'invite_only',
    defaultDurationMinutes: 60,
    candidates: [{ startAt: '2026-11-01T10:00:00.000Z' }],
    ...overrides,
  }, owner)
  expect(response.status).toBe(201)
  return await response.json() as CreatedEvent
}

async function rows(eventId: string) {
  return (await db.prepare('SELECT id, discordUserId, discordUsername, claimedAt FROM event_invites WHERE eventId = ?')
    .bind(eventId).all<Invite>()).results
}

async function fixture(kind: AuthKind = 'cookie', username = 'invited_current') {
  const owner = { Cookie: await loginAs(discordId(), 'organizer') }
  const invitedId = discordId()
  // Both authentication sessions exist before the owner creates the invitation.
  const auth: Record<string, string> = kind === 'cookie'
    ? { Cookie: await loginAs(invitedId, username) }
    : { Authorization: await loginAsBearer(invitedId, username) }
  const created = await createEvent(owner, { invitedDiscordUsernames: [username] })
  return { owner, invitedId, auth, ...created }
}

function profile(id: string, username = 'invited_current'): Profile {
  return { id, username, discriminator: '0', global_name: null, avatar: null }
}

function mockBot(resolve: (id: string, signal?: AbortSignal | null) => Response | Promise<Response>) {
  botEnv.DISCORD_BOT_TOKEN = BOT_TOKEN
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const match = /^https:\/\/discord\.com\/api\/v10\/users\/(\d{17,20})$/.exec(url)
    expect(match, `Unexpected outbound request: ${url}`).not.toBeNull()
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bot ${BOT_TOKEN}`)
    expect(init?.method ?? 'GET').toBe('GET')
    return resolve(match![1]!, init?.signal)
  })
}

function mockIdentity(invitedId: string, identity: Profile = profile(invitedId)) {
  return mockBot((id) => Response.json(id === invitedId ? identity : profile(id, 'organizer')))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function advanceClock(milliseconds = 5_001) {
  const next = Date.now() + milliseconds
  vi.spyOn(Date, 'now').mockReturnValue(next)
}

beforeEach(async () => {
  vi.mocked(claimPendingInvites).mockImplementation(createInviteClaimer())
  await applyD1Migrations(db, inject('d1Migrations'))
  originalBotToken = botEnv.DISCORD_BOT_TOKEN
  delete botEnv.DISCORD_BOT_TOKEN
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalBotToken === undefined) delete botEnv.DISCORD_BOT_TOKEN
  else botEnv.DISCORD_BOT_TOKEN = originalBotToken
})

describe.each<AuthKind>(['cookie', 'CLI Bearer'])('automatic username claim with an existing %s session', (kind) => {
  it.each(['detail', 'my events', 'join', 'vote', 'my votes', 'tally', 'ICS'] as const)(
    'claims on the first %s request, without OAuth, session replacement, or a preparatory request', async (endpoint) => {
      const f = await fixture(kind)
      if (endpoint === 'ICS') {
        expect((await post(`/api/events/${f.event.id}/decision`, { candidateIds: [f.candidates[0]!.id] }, f.owner)).status).toBe(201)
      }
      if (endpoint === 'vote') {
        // Voting requires a participant. Seed it without making an authenticated
        // request that could claim the invitation before the route under test.
        await db.prepare('INSERT INTO participants (id, eventId, kind, discordUserId, displayName, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), f.event.id, 'discord', f.invitedId, 'Participant', Date.now()).run()
      }
      const sessionsBefore = (await db.prepare('SELECT id FROM sessions ORDER BY id').all()).results
      const before = (await rows(f.event.id))[0]!
      expect(before).toMatchObject({ discordUserId: null, claimedAt: null })
      const fetchSpy = mockIdentity(f.invitedId)
      const root = `/api/events/${f.event.id}`
      const response = endpoint === 'my events' ? await request('/api/me/events', f.auth)
        : endpoint === 'join' ? await post(`${root}/participants`, { kind: 'discord', displayName: 'Participant' }, f.auth)
          : endpoint === 'vote' ? await request(`${root}/votes`, f.auth, {
            method: 'PUT', body: JSON.stringify({ votes: [{ candidateId: f.candidates[0]!.id, choice: 'yes' }] }),
          })
            : await request(`${root}${endpoint === 'my votes' ? '/votes/me' : endpoint === 'tally' ? '/tally' : endpoint === 'ICS' ? '/decision.ics' : ''}`, f.auth)
      expect(response.status).toBe(endpoint === 'join' ? 201 : 200)
      expect(response.headers.get('location')).toBeNull()
      expect((response.headers.get('set-cookie') ?? '')).not.toContain('hiyori_session=')
      const text = await response.text()
      if (endpoint === 'my events' || endpoint === 'detail' || endpoint === 'ICS') expect(text).toContain(f.event.title)
      expect(await rows(f.event.id)).toEqual([expect.objectContaining({
        id: before.id, discordUserId: f.invitedId, discordUsername: 'invited_current', claimedAt: expect.any(Number),
      })])
      expect((await db.prepare('SELECT id FROM sessions ORDER BY id').all()).results).toEqual(sessionsBefore)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(`https://discord.com/api/v10/users/${f.invitedId}`)
    },
  )
})

describe('fresh Bot identity safety for existing sessions', () => {
  it('claims the current name across events, never the cached username or display name', async () => {
    const f = await fixture('cookie', 'cached_name')
    const first = await createEvent(f.owner, { invitedDiscordUsernames: ['renamed_current'] })
    const second = await createEvent(f.owner, { invitedDiscordUsernames: ['renamed_current'] })
    mockIdentity(f.invitedId, { ...profile(f.invitedId, 'renamed_current'), global_name: 'cached_name' })
    const response = await request('/api/me/events', f.auth)
    expect(response.status).toBe(200)
    const list = await response.json() as { participating: Array<{ id: string }> }
    expect(list.participating.map((event) => event.id).sort()).toEqual([first.event.id, second.event.id].sort())
    expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
    for (const event of [first.event, second.event]) expect((await rows(event.id))[0]).toMatchObject({ discordUserId: f.invitedId })
    expect((await request(`/api/events/${f.event.id}?discordUsername=cached_name`, f.auth)).status).toBe(404)
  })

  it.each([
    ['different ID', (id: string) => ({ ...profile(id), id: discordId() })],
    ['numeric ID value', (id: string) => ({ ...profile(id), id: Number(id) })],
    ['missing ID', () => ({ username: 'invited_current', discriminator: '0' })],
    ['nonnumeric ID', (id: string) => ({ ...profile(id), id: 'not-a-discord-id' })],
    ['legacy discriminator', (id: string) => ({ ...profile(id), discriminator: '1234' })],
    ['missing discriminator', (id: string) => ({ id, username: 'invited_current' })],
    ['numeric discriminator', (id: string) => ({ ...profile(id), discriminator: 0 })],
    ['null discriminator', (id: string) => ({ ...profile(id), discriminator: null })],
    ['invalid username', (id: string) => ({ ...profile(id), username: 'two..dots' })],
    ['decorated username', (id: string) => ({ ...profile(id), username: '@invited_current' })],
    ['uppercase username', (id: string) => ({ ...profile(id), username: 'INVITED_CURRENT' })],
    ['nonstrings username', (id: string) => ({ ...profile(id), username: 12345 })],
    ['display name match', (id: string) => ({ ...profile(id, 'another_name'), global_name: 'invited_current' })],
  ] as const)('fails closed on a %s response without leaking the private event', async (_name, identity) => {
    const f = await fixture()
    const fetchSpy = mockIdentity(f.invitedId, identity(f.invitedId))
    const existing = await request(`/api/events/${f.event.id}?discordUsername=invited_current`, f.auth)
    const absent = await request(`/api/events/${crypto.randomUUID()}`, f.auth)
    expect(existing.status).toBe(404)
    expect(existing.headers.get('location')).toBeNull()
    expect(await existing.text()).toBe(await absent.text())
    expect(fetchSpy).toHaveBeenCalled()
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`https://discord.com/api/v10/users/${f.invitedId}`)
    expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
  })

  it('uses the same fresh lookup path for missing and inaccessible events', async () => {
    const f = await fixture()
    const fetchSpy = mockIdentity(f.invitedId, profile(f.invitedId, 'uninvited_current'))
    const hidden = await request(`/api/events/${f.event.id}`, f.auth)
    const missing = await request(`/api/events/${crypto.randomUUID()}`, f.auth)
    expect(hidden.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await hidden.text()).toBe(await missing.text())
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
  })

  it('does not send a malformed stored Discord ID to the Bot API or grant from its cached name', async () => {
    const f = await fixture()
    const auth = { Cookie: await loginAs('not-a-discord-id', 'invited_current') }
    const fetchSpy = mockBot(() => { throw new Error('Malformed identity must not be looked up') })
    expect((await request(`/api/events/${f.event.id}`, auth)).status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
  })

  it('skips lookup without pending invitations and with absent, invalid, or expired authentication', async () => {
    // Other cases deliberately leave pending rows; this case needs the global
    // no-pending precondition, not just an event with no pending invite.
    await db.prepare('DELETE FROM event_invites WHERE discordUserId IS NULL').run()
    const owner = { Cookie: await loginAs(discordId()) }
    const invitedId = discordId()
    const auth = { Cookie: await loginAs(invitedId, 'invited_current') }
    const existing = await createEvent(owner, { invitedDiscordUserIds: [invitedId] })
    const fetchSpy = mockIdentity(invitedId)
    expect((await request(`/api/events/${existing.event.id}`, auth)).status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    const pending = await createEvent(owner, { invitedDiscordUsernames: ['invited_current'] })
    const expired = await loginAsExpired(discordId(), 'invited_current')
    for (const headers of [{}, { Cookie: 'hiyori_session=invalid' }, { Cookie: expired }] as Array<Record<string, string>>) {
      expect((await request(`/api/events/${pending.event.id}`, headers)).status).toBe(404)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await rows(pending.event.id))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
  })

  it('treats an all-numeric current username as a username, rather than an invitee ID', async () => {
    const name = '12345678901234567'
    const f = await fixture('cookie', name)
    mockIdentity(f.invitedId, profile(f.invitedId, name))
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(200)
    expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: f.invitedId, discordUsername: name })
  })
})

describe('Bot lookup failure, cooldown, and concurrency', () => {
  it.each(['missing secret', '429', '500', 'network failure', 'timeout', 'malformed JSON'] as const)(
    '%s denies only pending access while existing grants and the session remain usable', async (failure) => {
      const f = await fixture()
      const granted = await createEvent(f.owner, { invitedDiscordUserIds: [f.invitedId] })
      const publicEvent = await createEvent(f.owner, { visibility: 'public' })
      const fetchSpy = failure === 'missing secret'
        ? vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Missing Bot secret must not send a request') })
        : mockBot((id, signal) => {
          if (id !== f.invitedId) return Response.json(profile(id, 'organizer'))
          if (failure === '429' || failure === '500') return new Response('Unavailable', { status: Number(failure) })
          if (failure === 'network failure') throw new TypeError('Discord network unavailable')
          if (failure === 'malformed JSON') return new Response('{')
          expect(signal).toBeDefined()
          return new Promise<Response>((_resolve, reject) => {
            if (signal?.aborted) reject(signal.reason)
            else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        })
      const pending = await request(`/api/events/${f.event.id}`, f.auth)
      expect(pending.status).toBe(404)
      expect(pending.headers.get('location')).toBeNull()
      expect((await request(`/api/events/${granted.event.id}`, f.auth)).status).toBe(200)
      expect((await request(`/api/events/${f.event.id}`, f.owner)).status).toBe(200)
      expect((await request(`/api/events/${publicEvent.event.id}`, f.auth)).status).toBe(200)
      expect((await request('/api/auth/me', f.auth)).status).toBe(200)
      expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
      if (failure === 'missing secret') expect(fetchSpy).not.toHaveBeenCalled()
      else expect(fetchSpy.mock.calls.filter(([input]) => String(input).endsWith(`/${f.invitedId}`))).toHaveLength(1)
    }, 10_000,
  )

  it('bounds failed lookups with cooldown and retries a fresh request after it elapses', async () => {
    const f = await fixture()
    let unavailable = true
    const fetchSpy = mockBot((id) => unavailable ? new Response('Unavailable', { status: 429 }) : Response.json(profile(id)))
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(404)
    unavailable = false
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(404)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    advanceClock()
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('can claim a new invitation immediately after a successful lookup found no matching invitation', async () => {
    const f = await fixture('cookie', 'unrelated_pending')
    const fetchSpy = mockIdentity(f.invitedId)
    expect((await request('/api/me/events', f.auth)).status).toBe(200)
    expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: null })
    const added = await post(`/api/events/${f.event.id}/invites`, { discordUsername: 'invited_current' }, f.owner)
    expect(added.status).toBe(201)
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(200)
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).endsWith(`/${f.invitedId}`))).toHaveLength(2)
    expect((await rows(f.event.id)).find((row) => row.discordUsername === 'invited_current')).toMatchObject({ discordUserId: f.invitedId })
  })

  it('never reuses a successful identity lookup to grant a later invitation after a rename', async () => {
    const f = await fixture()
    let username = 'invited_current'
    const fetchSpy = mockBot((id) => Response.json(profile(id, id === f.invitedId ? username : 'organizer')))
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(200)
    const later = await createEvent(f.owner, { invitedDiscordUsernames: ['invited_current'] })
    username = 'renamed_now'
    expect((await request(`/api/events/${later.event.id}`, f.auth)).status).toBe(404)
    expect((await rows(later.event.id))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
    advanceClock()
    expect((await request(`/api/events/${later.event.id}`, f.auth)).status).toBe(404)
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).endsWith(`/${f.invitedId}`))).toHaveLength(3)
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(200)
    expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: f.invitedId, discordUsername: 'invited_current' })
  })

  it('waits for one shared lookup and claim across concurrent cookie and Bearer requests', async () => {
    const f = await fixture()
    const bearer = { Authorization: await loginAsBearer(f.invitedId, 'invited_current') }
    const fetchSpy = mockBot(async (id) => {
      // Keep the mock network response in the originating request's context.
      await new Promise((resolve) => setTimeout(resolve, 100))
      return Response.json(profile(id))
    })
    // Consume each request-owned stream in its own continuation before joining
    // the results; only plain values cross the concurrent request boundary.
    const read = async (path: string, auth: Record<string, string>) => {
      const response = await request(path, auth)
      return { status: response.status, text: await response.text() }
    }
    const requests = [
      read(`/api/events/${f.event.id}`, f.auth),
      read(`/api/events/${f.event.id}/tally`, bearer),
      read('/api/me/events', f.auth),
    ]
    const responses = await Promise.all(requests)
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    expect(responses[2]!.text).toContain(f.event.id)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(await rows(f.event.id)).toEqual([expect.objectContaining({ discordUserId: f.invitedId, claimedAt: expect.any(Number) })])
  })

  it('rolls back a failed claim without blocking previously granted access', async () => {
    const f = await fixture()
    const granted = await createEvent(f.owner, { invitedDiscordUserIds: [f.invitedId] })
    await db.exec("CREATE TRIGGER reject_session_claim BEFORE UPDATE ON event_invites WHEN NEW.discordUsername = 'invited_current' BEGIN SELECT RAISE(ABORT, 'test session claim failure'); END;")
    try {
      const fetchSpy = mockIdentity(f.invitedId)
      expect((await request(`/api/events/${granted.event.id}`, f.auth)).status).toBe(200)
      expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(404)
      expect((await rows(f.event.id))[0]).toMatchObject({ discordUserId: null, claimedAt: null })
      expect((await request('/api/auth/me', f.auth)).status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      await db.exec('DROP TRIGGER reject_session_claim;')
    }
  })
})

describe('one-time binding and revocation with already signed-in users', () => {
  it('allows only one competing account to claim and never transfers a bound invitation on name reuse', async () => {
    const f = await fixture()
    const otherId = discordId()
    const other = { Cookie: await loginAs(otherId, 'invited_current') }
    mockBot((id) => Response.json(profile(id)))
    const responses = await Promise.all([
      request(`/api/events/${f.event.id}`, f.auth),
      request(`/api/events/${f.event.id}`, other),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 404])
    const [bound] = await rows(f.event.id)
    expect([f.invitedId, otherId]).toContain(bound!.discordUserId)
    const unrelated = await createEvent(f.owner, { invitedDiscordUsernames: ['unrelated_pending'] })
    advanceClock()
    const winner = bound!.discordUserId === f.invitedId ? f.auth : other
    const loser = bound!.discordUserId === f.invitedId ? other : f.auth
    expect((await request(`/api/events/${f.event.id}`, loser)).status).toBe(404)
    expect((await request(`/api/events/${f.event.id}`, winner)).status).toBe(200)
    expect(await rows(f.event.id)).toEqual([bound])
    expect((await rows(unrelated.event.id))[0]).toMatchObject({ discordUserId: null })
  })

  it('does not resurrect a pending invitation revoked while identity lookup is in flight', async () => {
    const f = await fixture()
    const row = (await rows(f.event.id))[0]!
    const started = deferred<void>()
    const release = deferred<void>()
    mockBot(async (id) => {
      if (id === f.invitedId) {
        started.resolve()
        await release.promise
      }
      return Response.json(profile(id, id === f.invitedId ? 'invited_current' : 'organizer'))
    })
    const access = request(`/api/events/${f.event.id}`, f.auth)
    await started.promise
    expect((await request(`/api/events/${f.event.id}/invites/${row.id}`, f.owner, { method: 'DELETE' })).status).toBe(204)
    release.resolve()
    expect((await access).status).toBe(404)
    expect(await rows(f.event.id)).toEqual([])
  })

  it('keeps revoked bound access removed on subsequent fresh Bot lookups', async () => {
    const f = await fixture()
    mockIdentity(f.invitedId)
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(200)
    const row = (await rows(f.event.id))[0]!
    expect((await request(`/api/events/${f.event.id}/invites/${row.id}`, f.owner, { method: 'DELETE' })).status).toBe(204)
    await createEvent(f.owner, { invitedDiscordUsernames: ['unrelated_pending'] })
    advanceClock()
    expect((await request(`/api/events/${f.event.id}`, f.auth)).status).toBe(404)
    expect(await rows(f.event.id)).toEqual([])
    const listed = await request('/api/me/events', f.auth)
    expect(await listed.text()).not.toContain(f.event.id)
  })
})
