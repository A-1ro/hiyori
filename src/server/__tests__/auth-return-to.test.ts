import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { buildApp, type Env } from '../index'

const BASE = 'https://e2e.example.test'
const settings: Env = { ...(env as Env), DISCORD_CLIENT_ID: 'local-test-client', DISCORD_CLIENT_SECRET: 'local-test-only', DISCORD_OAUTH_REDIRECT_URI: `${BASE}/api/auth/discord/callback` }
const unsafe: unknown[] = [
  '/\\other.invalid', '//other.invalid', '/%5cother.invalid', '/%255cother.invalid',
  '/%2fother.invalid', '/%252fother.invalid', '/%252f%255cother.invalid',
  '/a/..//other.invalid', '/a/%2e%2e//other.invalid', '/a/%252e%252e/%252fother.invalid',
  '/\t/other.invalid', '/%09/other.invalid', '/me?x=%250a', '/me#%7f',
  'https://other.invalid/', '/%25252525252525252fother.invalid', null, [], {}, 42,
]
const accepted = [
  '/', '/me', '/events/new?channelToken=local.fixture', '/cli?code=ABCD-EFGH',
  '/help?q=%E6%97%A5%E7%A8%8B&percent=100%25',
  '/oauth/authorize?client_id=fixture&scope=hiyori%3Aread+hiyori%3Awrite',
]
async function request(path: string, cookie?: string) {
  const ctx = createExecutionContext()
  const response = await buildApp(settings).fetch(new Request(BASE + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' }), settings, ctx)
  await waitOnExecutionContext(ctx)
  return response
}
function stateFor(value: unknown) {
  return btoa(JSON.stringify({ s: 'local-csrf-state', r: value })).replace(/=+$/, '')
}
beforeEach(async () => {
  await applyD1Migrations(settings.DB, inject('d1Migrations'))
  // No actual Discord request, login or external navigation. Every unexpected
  // outbound request fails the test, including any attacker-controlled target.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === 'https://discord.com/api/oauth2/token') return Response.json({ access_token: 'synthetic-test-token' })
    if (url === 'https://discord.com/api/v10/users/@me') return Response.json({ id: '12345678901234567', username: 'return_path_fixture', global_name: null, avatar: null })
    throw new Error('Unexpected outbound request in local OAuth fixture')
  })
})
afterEach(() => vi.restoreAllMocks())

describe('Discord return destination guards in both route boundaries', () => {
  it('normalizes/rejects returnTo before issuing OAuth state without contacting Discord', async () => {
    for (const value of [...unsafe.filter((v): v is string => typeof v === 'string'), ...accepted]) {
      const response = await request(`/api/auth/discord?returnTo=${encodeURIComponent(value)}`)
      expect(response.status).toBe(302)
      const authorize = new URL(response.headers.get('Location')!)
      expect(authorize.origin).toBe('https://discord.com')
      expect(authorize.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/discord/callback`)
      const state = authorize.searchParams.get('state')!
      const parsed = JSON.parse(atob(state + '='.repeat((4 - state.length % 4) % 4))) as { r: string }
      expect(parsed.r).toBe(accepted.includes(value) ? value : '/')
      expect(new URL(parsed.r, BASE).origin).toBe(BASE)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('revalidates state.r even with matching CSRF and successful mocked Discord responses', async () => {
    for (const value of [...unsafe, ...accepted]) {
      const response = await request(`/api/auth/discord/callback?code=local-fixture&state=${encodeURIComponent(stateFor(value))}`, 'hiyori_oauth_state=local-csrf-state')
      expect(response.status).toBe(302)
      const location = response.headers.get('Location')!
      expect(location).toBe(typeof value === 'string' && accepted.includes(value) ? value : '/')
      expect(new URL(location, BASE).origin).toBe(BASE)
      expect(response.headers.get('Set-Cookie')).toMatch(/hiyori_session=.*HttpOnly/)
    }
    expect(fetch).toHaveBeenCalledTimes((unsafe.length + accepted.length) * 2)
  })
  it('checks CSRF before any token exchange even when a return path looks valid', async () => {
    const response = await request(`/api/auth/discord/callback?code=local-fixture&state=${encodeURIComponent(stateFor('/me'))}`, 'hiyori_oauth_state=wrong-state')
    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    expect(response.headers.get('Location')).toBeNull()
  })
})
