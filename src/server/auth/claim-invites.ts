import { isDiscordUsername } from '../../shared/discord-invites'

type ClaimEnv = { DB: D1Database; DISCORD_BOT_TOKEN?: string }
type ClaimState = {
  inFlight: Map<string, Promise<void>>
  failures: Map<string, number>
  blockedUntil: number
  tokens: number
  refilledAt: number
}

const FAILURE_BACKOFF_MS = 5_000
const TIMEOUT_MS = 3_000
const MAX_FAILURES = 256
const MAX_CONCURRENT = 4
const BURST = 10
const REFILL_PER_SECOND = 5

function retryDelay(value: unknown): number | null {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(seconds) && seconds > 0
    // Do not shorten Discord's cooldown, even when it exceeds the usual window.
    // Saturate only at the largest safely representable timestamp (effectively
    // indefinitely blocked for an implausibly large provider value).
    ? Math.min(Math.max(seconds * 1_000, FAILURE_BACKOFF_MS), Number.MAX_SAFE_INTEGER)
    : null
}

function retryUntil(delay: number): number {
  return Math.min(Date.now() + delay, Number.MAX_SAFE_INTEGER)
}

// Only transient throttling state is retained. No username, positive verification,
// or authorization result may be reused to claim an invitation created later.
// The factory also lets isolated tests exercise rate/concurrency behavior without
// weakening the production gates or introducing a remotely configurable bypass.
export function createInviteClaimer() {
  const states = new WeakMap<D1Database, ClaimState>()

  return async function claimPendingInvites(env: ClaimEnv, discordUserId: string): Promise<void> {
    if (!env.DISCORD_BOT_TOKEN || !/^\d{17,20}$/.test(discordUserId)) return
    let state = states.get(env.DB)
    if (!state) {
      state = { inFlight: new Map(), failures: new Map(), blockedUntil: 0, tokens: BURST, refilledAt: Date.now() }
      states.set(env.DB, state)
    }
    const running = state.inFlight.get(discordUserId)
    if (running) return running
    const now = Date.now()
    for (const [id, until] of state.failures) {
      if (until <= now) state.failures.delete(id)
    }
    if (state.blockedUntil > now || (state.failures.get(discordUserId) ?? 0) > now) return
    if (state.inFlight.size >= MAX_CONCURRENT) return

    const currentState = state
    const run = async () => {
      const fail = (delay = FAILURE_BACKOFF_MS) => {
        if (currentState.failures.size >= MAX_FAILURES) {
          const oldest = currentState.failures.keys().next().value
          if (oldest !== undefined) currentState.failures.delete(oldest)
        }
        currentState.failures.set(discordUserId, retryUntil(delay))
      }
      try {
        // This is deliberately independent of the requested event and of the cached
        // username. Missing/private event requests take the same verification path,
        // and users who renamed on Discord can receive their new-name invitations.
        const pending = await env.DB.prepare('SELECT 1 AS pending FROM event_invites WHERE discordUserId IS NULL LIMIT 1').first()
        if (!pending) return

        const startedAt = Date.now()
        currentState.tokens = Math.min(BURST, currentState.tokens + Math.max(0, startedAt - currentState.refilledAt) * REFILL_PER_SECOND / 1_000)
        currentState.refilledAt = startedAt
        if (currentState.blockedUntil > startedAt || currentState.tokens < 1) return
        currentState.tokens -= 1

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        try {
          const response = await fetch(`https://discord.com/api/v10/users/${discordUserId}`, {
            headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
            signal: controller.signal,
            redirect: 'error',
          })
          if (response.status === 429) {
            const body = await response.json().catch(() => null) as { retry_after?: unknown } | null
            const delay = Math.max(retryDelay(response.headers.get('Retry-After')) ?? 0, retryDelay(body?.retry_after) ?? 0, FAILURE_BACKOFF_MS)
            currentState.blockedUntil = Math.max(currentState.blockedUntil, retryUntil(delay))
            fail(delay)
            return
          }
          if (!response.ok) {
            // A missing/invalid bot must not be hammered once per signed-in user.
            if (response.status === 401 || response.status === 403) {
              currentState.blockedUntil = Math.max(currentState.blockedUntil, Date.now() + 60_000)
            }
            fail()
            return
          }
          if (response.headers.get('X-RateLimit-Remaining') === '0') {
            const delay = retryDelay(response.headers.get('X-RateLimit-Reset-After'))
            if (delay) currentState.blockedUntil = Math.max(currentState.blockedUntil, retryUntil(delay))
          }
          const user: unknown = await response.json()
          if (!user || typeof user !== 'object' || !('id' in user) || user.id !== discordUserId ||
            !('discriminator' in user) || user.discriminator !== '0' ||
            !('username' in user) || typeof user.username !== 'string' || !isDiscordUsername(user.username)) {
            fail()
            return
          }
          // Fresh exact-ID Discord data is the sole authority for this claim. UPDATE
          // never inserts/recreates a revoked row or rewrites an already bound ID.
          // All matching events are claimed together, not just the requested event.
          await env.DB.prepare(`
            UPDATE event_invites SET discordUserId = ?, claimedAt = ?
            WHERE discordUserId IS NULL AND discordUsername = ?
          `).bind(discordUserId, Date.now(), user.username).run()
        } finally {
          clearTimeout(timer)
        }
      } catch {
        // Discord/network/DB failures never invalidate the authenticated session or
        // take away owner, public, or already-bound access. A later read can retry.
        fail()
      }
    }
    const promise = run().finally(() => currentState.inFlight.delete(discordUserId))
    currentState.inFlight.set(discordUserId, promise)
    return promise
  }
}

export const claimPendingInvites = createInviteClaimer()
