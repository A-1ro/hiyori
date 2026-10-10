import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInviteClaimer } from '../auth/claim-invites'

const BOT_TOKEN = 'claimer-unit-test-token'
const FIRST_ID = 90000000000000000n
let now: number

function identity(id: string, username = 'current_username') {
  return Response.json({ id, username, discriminator: '0' })
}

function fixture() {
  const pending = vi.fn(async (): Promise<{ pending: number } | null> => ({ pending: 1 }))
  const update = vi.fn(async () => ({ success: true }))
  const bind = vi.fn()
  const prepare = vi.fn((query: string) => {
    if (query.startsWith('SELECT')) return { first: pending }
    expect(query).toMatch(/UPDATE event_invites SET discordUserId = \?, claimedAt = \?/)
    expect(query).toMatch(/WHERE discordUserId IS NULL AND discordUsername = \?/)
    return { bind: (...args: unknown[]) => { bind(...args); return { run: update } } }
  })
  const env = { DB: { prepare } as unknown as D1Database, DISCORD_BOT_TOKEN: BOT_TOKEN }
  const claim = createInviteClaimer()
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bot ${BOT_TOKEN}`)
    expect(init?.redirect).toBe('error')
    return identity(String(input).split('/').at(-1)!)
  })
  return { env, claim, pending, update, bind, prepare, fetchSpy }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})

afterEach(() => vi.restoreAllMocks())

describe('invite claimer transient state', () => {
  it('retains no positive identity or no-match cache and binds only the fresh exact username', async () => {
    const f = fixture()
    const id = String(FIRST_ID)
    await f.claim(f.env, id)
    f.fetchSpy.mockResolvedValueOnce(identity(id, 'renamed_username'))
    await f.claim(f.env, id)
    expect(f.fetchSpy).toHaveBeenCalledTimes(2)
    expect(f.bind.mock.calls).toEqual([[id, now, 'current_username'], [id, now, 'renamed_username']])
    expect(f.update).toHaveBeenCalledTimes(2)
  })

  it('does not consume lookup capacity when there are no pending invitations', async () => {
    const f = fixture()
    f.pending.mockResolvedValue(null)
    for (let i = 0; i < 20; i++) await f.claim(f.env, String(FIRST_ID + BigInt(i)))
    expect(f.fetchSpy).not.toHaveBeenCalled()
    f.pending.mockResolvedValue({ pending: 1 })
    await f.claim(f.env, String(FIRST_ID))
    expect(f.fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('single-flights the whole lookup and database claim, so followers wait for authorization to be persisted', async () => {
    const f = fixture()
    const updateStarted = deferred<void>()
    const releaseUpdate = deferred<void>()
    f.update.mockImplementation(async () => {
      updateStarted.resolve()
      await releaseUpdate.promise
      return { success: true }
    })
    const first = f.claim(f.env, String(FIRST_ID))
    await updateStarted.promise
    let followerFinished = false
    const second = f.claim(f.env, String(FIRST_ID)).then(() => { followerFinished = true })
    await Promise.resolve()
    expect(followerFinished).toBe(false)
    expect(f.fetchSpy).toHaveBeenCalledTimes(1)
    expect(f.update).toHaveBeenCalledTimes(1)
    releaseUpdate.resolve()
    await Promise.all([first, second])
    expect(followerFinished).toBe(true)
  })

  it('backs off failed identities for five seconds without blocking an unrelated user', async () => {
    const f = fixture()
    const id = String(FIRST_ID)
    f.fetchSpy.mockResolvedValueOnce(new Response('Unavailable', { status: 500 }))
    await f.claim(f.env, id)
    now += 4_999
    await f.claim(f.env, id)
    expect(f.fetchSpy).toHaveBeenCalledTimes(1)
    await f.claim(f.env, String(FIRST_ID + 1n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(2)
    now += 1
    await f.claim(f.env, id)
    expect(f.fetchSpy).toHaveBeenCalledTimes(3)
    expect(f.update).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['header', '7', { retry_after: 1 }, 7_000],
    ['body', undefined, { retry_after: 8 }, 8_000],
    ['minimum', '0.1', {}, 5_000],
    ['beyond fifteen minutes', '999999', {}, 999_999_000],
    ['longer body', '7', { retry_after: 9 }, 9_000],
    ['invalid', '-1', { retry_after: 'invalid' }, 5_000],
  ] as const)('honors the full shared Discord 429 backoff from %s', async (_source, retryAfter, body, delay) => {
    const f = fixture()
    f.fetchSpy.mockResolvedValueOnce(Response.json(body, {
      status: 429, headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
    }))
    await f.claim(f.env, String(FIRST_ID))
    const startedAt = now
    if (delay > 900_000) {
      now += 900_001
      await f.claim(f.env, String(FIRST_ID + 1n))
      expect(f.fetchSpy).toHaveBeenCalledTimes(1)
    }
    now = startedAt + delay - 1
    await f.claim(f.env, String(FIRST_ID + 1n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(1)
    now += 1
    await f.claim(f.env, String(FIRST_ID + 1n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(2)
    expect(f.update).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('backs off all users for a rejected Bot credential (%s)', async (status) => {
    const f = fixture()
    f.fetchSpy.mockResolvedValueOnce(new Response('Forbidden', { status }))
    await f.claim(f.env, String(FIRST_ID))
    now += 59_999
    await f.claim(f.env, String(FIRST_ID + 1n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(1)
    now += 1
    await f.claim(f.env, String(FIRST_ID + 1n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('respects Discord rate-limit reset after a successful final permitted response', async () => {
    const f = fixture()
    f.fetchSpy.mockResolvedValueOnce(Response.json({ id: String(FIRST_ID), username: 'current_username', discriminator: '0' }, {
      headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '6' },
    }))
    await f.claim(f.env, String(FIRST_ID))
    expect(f.update).toHaveBeenCalledTimes(1)
    now += 5_999
    await f.claim(f.env, String(FIRST_ID + 1n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(1)
    now += 1
    await f.claim(f.env, String(FIRST_ID + 1n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('caps concurrent identities at four while allowing a skipped user to retry after they finish', async () => {
    const f = fixture()
    const allStarted = deferred<void>()
    const release = deferred<void>()
    let started = 0
    f.fetchSpy.mockImplementation(async (input) => {
      if (++started === 4) allStarted.resolve()
      await release.promise
      return identity(String(input).split('/').at(-1)!)
    })
    const running = Array.from({ length: 4 }, (_, index) => f.claim(f.env, String(FIRST_ID + BigInt(index))))
    await allStarted.promise
    await f.claim(f.env, String(FIRST_ID + 4n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(4)
    release.resolve()
    await Promise.all(running)
    await f.claim(f.env, String(FIRST_ID + 4n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(5)
    expect(f.update).toHaveBeenCalledTimes(5)
  })

  it('caps a burst at ten and refills five lookup tokens per second', async () => {
    const f = fixture()
    for (let i = 0; i < 11; i++) await f.claim(f.env, String(FIRST_ID + BigInt(i)))
    expect(f.fetchSpy).toHaveBeenCalledTimes(10)
    now += 199
    await f.claim(f.env, String(FIRST_ID + 10n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(10)
    now += 1
    await f.claim(f.env, String(FIRST_ID + 10n))
    expect(f.fetchSpy).toHaveBeenCalledTimes(11)
  })

  it('keeps independent database bindings isolated from a different database’s rate backoff', async () => {
    const first = fixture()
    const second = fixture()
    const sharedClaim = createInviteClaimer()
    second.fetchSpy.mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
    await sharedClaim(first.env, String(FIRST_ID))
    await sharedClaim(second.env, String(FIRST_ID))
    expect(first.update).not.toHaveBeenCalled()
    expect(second.update).toHaveBeenCalledTimes(1)
  })
})
