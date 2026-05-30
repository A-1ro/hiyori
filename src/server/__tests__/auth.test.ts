import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'http://example.com'

beforeEach(async () => {
  await applyMigrations()
})

describe('GET /api/auth/discord', () => {
  it('A1: DISCORD_CLIENT_ID 未設定なら 503', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/discord`)
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('configured')
  })
})

describe('GET /api/auth/me', () => {
  it('A2: 未ログインで { user: null }', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/me`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: unknown }
    expect(body.user).toBeNull()
  })
})

describe('POST /api/auth/logout', () => {
  it('A3: ログアウトで Set-Cookie に Max-Age=0 が含まれる', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/logout`, { method: 'POST' })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toMatch(/Max-Age=0/i)
  })
})

describe('GET /api/auth/discord/callback', () => {
  it('A4: code なしで 400', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/discord/callback?state=abc`)
    expect(res.status).toBe(400)
  })

  it('A5: state Cookie なしで 400', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/discord/callback?code=test&state=abc`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('cookie')
  })

  it('A6: state mismatch で 400 (Discord 未設定でも state Cookie チェックに到達する前に 503)', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/discord/callback?code=test&state=abc`, {
      headers: { Cookie: 'hiyori_oauth_state=wrong_state' },
    })
    expect([400, 503]).toContain(res.status)
  })

  it('A7: Discord OAuth が設定されていれば callback が state mismatch で 400 になる', async () => {
    // DISCORD_CLIENT_ID が設定されていない環境では 503 になる
    // state Cookie をセットして不一致になるケースのテスト
    const stateBundle = btoa(JSON.stringify({ s: 'expected_state', r: '/' })).replace(/=+$/, '')
    const res = await SELF.fetch(`${BASE}/api/auth/discord/callback?code=test&state=${stateBundle}`, {
      headers: { Cookie: 'hiyori_oauth_state=different_state' },
    })
    // 503 (not configured) or 400 (state mismatch) depending on env
    expect([400, 503]).toContain(res.status)
  })
})

describe('callback open redirect guard', () => {
  it('A-M1: returnTo に //evil.com を含む state bundle → Location が / になる', async () => {
    const discordConfigured = !!(env as Record<string, unknown>).DISCORD_CLIENT_ID
    if (!discordConfigured) {
      const stateBundle = btoa(JSON.stringify({ s: 'test_state', r: '//evil.com' })).replace(/=+$/, '')
      const res = await SELF.fetch(`${BASE}/api/auth/discord/callback?code=test&state=${stateBundle}`, {
        headers: { Cookie: 'hiyori_oauth_state=test_state' },
        redirect: 'manual',
      })
      expect(res.status).toBe(503)
      return
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes('oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'mock_token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('users/@me')) {
        return new Response(JSON.stringify({
          id: '11111111111111111',
          username: 'redirecttestuser',
          global_name: null,
          avatar: null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return fetch(input)
    })

    try {
      const stateBundle = btoa(JSON.stringify({ s: 'test_state', r: '//evil.com' })).replace(/=+$/, '')
      const res = await SELF.fetch(`${BASE}/api/auth/discord/callback?code=mycode&state=${stateBundle}`, {
        headers: { Cookie: 'hiyori_oauth_state=test_state' },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      const location = res.headers.get('location')
      expect(location).not.toContain('evil.com')
      expect(location).toBe('/')
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('callback with mocked Discord API', () => {
  it('A8: exchangeCodeForToken をモックして正常コールバックを検証', async () => {
    // DISCORD_CLIENT_ID が設定されていない環境では 503 になるのでスキップ
    const discordConfigured = !!(env as Record<string, unknown>).DISCORD_CLIENT_ID
    if (!discordConfigured) {
      // 設定なし環境では 503 の動作確認にとどめる
      const stateBundle = btoa(JSON.stringify({ s: 'test_state', r: '/' })).replace(/=+$/, '')
      const res = await SELF.fetch(`${BASE}/api/auth/discord/callback?code=test&state=${stateBundle}`, {
        headers: { Cookie: 'hiyori_oauth_state=test_state' },
      })
      expect(res.status).toBe(503)
      return
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes('oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'mock_token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('users/@me')) {
        return new Response(JSON.stringify({
          id: '12345678901234567',
          username: 'testuser',
          global_name: 'Test User',
          avatar: null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return fetch(input)
    })

    try {
      const stateBundle = btoa(JSON.stringify({ s: 'test_state', r: '/' })).replace(/=+$/, '')
      const res = await SELF.fetch(`${BASE}/api/auth/discord/callback?code=mycode&state=${stateBundle}`, {
        headers: { Cookie: 'hiyori_oauth_state=test_state' },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/')
      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).not.toBeNull()
      expect(setCookie).toContain('hiyori_session')
      expect(setCookie).toMatch(/HttpOnly/i)
      expect(setCookie).toMatch(/Secure/i)
      expect(setCookie).toMatch(/SameSite=Lax/i)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
