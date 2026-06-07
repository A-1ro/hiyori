import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs, loginAsBearer } from './test-helpers'
import { cleanupExpiredCliAuthRequests } from '../services/cli-cleanup'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'

beforeEach(async () => {
  await applyMigrations()
})

async function start(opts?: { clientName?: string; hostname?: string }) {
  const res = await SELF.fetch(`${BASE}/api/auth/cli/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  })
  expect(res.status).toBe(201)
  return res.json() as Promise<{
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    interval: number
    expiresIn: number
  }>
}

describe('C1: start → approve → poll => approved + token + ~90日 expiresAt', () => {
  it('C1', async () => {
    const cookie = await loginAs('111111111111111111')
    const { deviceCode, userCode } = await start({ clientName: 'test-cli', hostname: 'myhost' })

    const approveRes = await SELF.fetch(`${BASE}/api/auth/cli/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userCode }),
    })
    expect(approveRes.status).toBe(200)

    const pollRes = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(pollRes.status).toBe(200)
    const pollBody = await pollRes.json() as { status: string; token?: string; expiresAt?: string }
    expect(pollBody.status).toBe('approved')
    expect(pollBody.token).toBeTruthy()
    expect(typeof pollBody.token).toBe('string')
    const expiresAt = new Date(pollBody.expiresAt!)
    const nowPlus80Days = new Date(Date.now() + 80 * 24 * 60 * 60 * 1000)
    expect(expiresAt.getTime()).toBeGreaterThan(nowPlus80Days.getTime())
  })
})

describe('C2: start 直後 poll => pending', () => {
  it('C2', async () => {
    const { deviceCode } = await start()
    const pollRes = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(pollRes.status).toBe(200)
    const body = await pollRes.json() as { status: string }
    expect(body.status).toBe('pending')
  })
})

describe('C3: deny 後 poll => denied', () => {
  it('C3', async () => {
    const cookie = await loginAs('222222222222222222')
    const { deviceCode, userCode } = await start()

    const denyRes = await SELF.fetch(`${BASE}/api/auth/cli/deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userCode }),
    })
    expect(denyRes.status).toBe(200)

    const pollRes = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(pollRes.status).toBe(200)
    const body = await pollRes.json() as { status: string }
    expect(body.status).toBe('denied')
  })
})

describe('C4: TTL 超過後 poll => expired', () => {
  it('C4', async () => {
    const { deviceCode, userCode } = await start()
    const db = (env as { DB: D1Database }).DB

    const row = await db.prepare(
      'SELECT id FROM cli_auth_requests WHERE userCode = ?'
    ).bind(userCode).first<{ id: string }>()
    expect(row).not.toBeNull()

    const past = Date.now() - 1000
    await db.prepare(
      'UPDATE cli_auth_requests SET expiresAt = ? WHERE id = ?'
    ).bind(past, row!.id).run()

    const pollRes = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(pollRes.status).toBe(200)
    const body = await pollRes.json() as { status: string }
    expect(body.status).toBe('expired')
  })
})

describe('C5: approved 取得後に再 poll => expired_or_used / sessions に kind=cli が1件のみ増加', () => {
  it('C5', async () => {
    const cookie = await loginAs('333333333333333333')
    const { deviceCode, userCode } = await start()
    const db = (env as { DB: D1Database }).DB

    const sessionsBefore = await db.prepare(
      "SELECT COUNT(*) as cnt FROM sessions WHERE kind = 'cli'"
    ).first<{ cnt: number }>()
    const countBefore = sessionsBefore?.cnt ?? 0

    await SELF.fetch(`${BASE}/api/auth/cli/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userCode }),
    })

    const poll1 = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(poll1.status).toBe(200)
    const body1 = await poll1.json() as { status: string }
    expect(body1.status).toBe('approved')

    const sessionsAfter = await db.prepare(
      "SELECT COUNT(*) as cnt FROM sessions WHERE kind = 'cli'"
    ).first<{ cnt: number }>()
    const countAfter = sessionsAfter?.cnt ?? 0
    expect(countAfter).toBe(countBefore + 1)

    const poll2 = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(poll2.status).toBe(200)
    const body2 = await poll2.json() as { status: string }
    expect(body2.status).toBe('expired_or_used')
  })
})

describe('C6: 連続 poll => 2回目が 429 slow_down', () => {
  it('C6', async () => {
    const { deviceCode } = await start()

    const poll1 = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(poll1.status).toBe(200)

    const poll2 = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(poll2.status).toBe(429)
    const body = await poll2.json() as { status: string; interval: number }
    expect(body.status).toBe('slow_down')
    expect(typeof body.interval).toBe('number')
  })
})

describe('C7: cookie 無し approve => 401', () => {
  it('C7', async () => {
    const { userCode } = await start()
    const res = await SELF.fetch(`${BASE}/api/auth/cli/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userCode }),
    })
    expect(res.status).toBe(401)
  })
})

describe('C8: loginAs cookie + 存在しない userCode approve => 400/404', () => {
  it('C8', async () => {
    const cookie = await loginAs('444444444444444444')
    const res = await SELF.fetch(`${BASE}/api/auth/cli/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userCode: 'ZZZZ-9999' }),
    })
    expect([400, 404]).toContain(res.status)
  })
})

describe('C9: 未ログイン GET /cli => 302 with discord returnTo', () => {
  it('C9', async () => {
    const res = await SELF.fetch(`${BASE}/cli?code=ABCD-1234`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).not.toBeNull()
    expect(location).toContain('/api/auth/discord')
    const decoded = decodeURIComponent(location!)
    expect(decoded).toContain('/cli')
    expect(decoded).toContain('ABCD-1234')
  })
})

describe('C10: ログイン済み GET /cli?code => 200 + 承認 UI', () => {
  it('C10', async () => {
    const cookie = await loginAs('555555555555555555', 'testuser10')
    const { userCode } = await start({ clientName: 'MyCLI', hostname: 'myhost.local' })

    const res = await SELF.fetch(`${BASE}/cli?code=${encodeURIComponent(userCode)}`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('testuser10')
    expect(body).toContain('MyCLI')
    expect(body).toContain('myhost.local')
    expect(body).toMatch(/承認|approve/i)
    expect(body).toMatch(/拒否|deny/i)
  })
})

describe('C11: Bearer で /api/auth/me => 200 + user 非 null', () => {
  it('C11', async () => {
    const bearer = await loginAsBearer('666666666666666666', 'beareruser')
    const res = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: bearer },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { user: { username: string } | null }
    expect(body.user).not.toBeNull()
    expect(body.user?.username).toBe('beareruser')
  })
})

describe('C12: Bearer logout => 同 Bearer で me が null', () => {
  it('C12', async () => {
    const bearer = await loginAsBearer('777777777777777777', 'logoutuser')

    const logoutRes = await SELF.fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: bearer },
    })
    expect(logoutRes.status).toBe(200)

    const meRes = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: bearer },
    })
    expect(meRes.status).toBe(200)
    const body = await meRes.json() as { user: unknown }
    expect(body.user).toBeNull()
  })
})

describe('C13: userCode 正規化 => 小文字/欠ハイフンでも一致して approved', () => {
  it('C13', async () => {
    const cookie = await loginAs('888888888888888888')
    const { deviceCode, userCode } = await start()

    const lower = userCode.toLowerCase().replace('-', '')

    const approveRes = await SELF.fetch(`${BASE}/api/auth/cli/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userCode: lower }),
    })
    expect(approveRes.status).toBe(200)

    const pollRes = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(pollRes.status).toBe(200)
    const body = await pollRes.json() as { status: string }
    expect(body.status).toBe('approved')
  })
})

describe('C14: cookie 経路回帰', () => {
  it('C14', async () => {
    const cookie = await loginAs('999999999999999999', 'cookieuser')
    const res = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { user: { username: string } | null }
    expect(body.user).not.toBeNull()
    expect(body.user?.username).toBe('cookieuser')
  })
})

describe('C15: Origin 検証 — 外部 origin で approve => 403', () => {
  it('C15', async () => {
    const cookie = await loginAs('101010101010101010', 'originuser')
    const { userCode } = await start({ clientName: 'origin-test' })
    const res = await SELF.fetch(`${BASE}/api/auth/cli/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ userCode }),
    })
    expect(res.status).toBe(403)
  })
})

describe('C16: approve レート制限 — 11回目が 429', () => {
  it('C16', async () => {
    const ip = '9.9.9.9'
    let lastStatus = 0
    for (let i = 0; i < 11; i++) {
      const res = await SELF.fetch(`${BASE}/api/auth/cli/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': ip,
        },
        body: JSON.stringify({ userCode: 'ZZZZ-9999' }),
      })
      lastStatus = res.status
    }
    expect(lastStatus).toBe(429)
  })
})

describe('C17: approved+expired でも poll で token 発行（I-1 回帰）', () => {
  it('C17', async () => {
    const cookie = await loginAs('202020202020202020', 'expiredapproveuser')
    const { deviceCode, userCode } = await start()
    const db = (env as { DB: D1Database }).DB

    await SELF.fetch(`${BASE}/api/auth/cli/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userCode }),
    })

    const row = await db.prepare(
      'SELECT id FROM cli_auth_requests WHERE userCode = ?'
    ).bind(userCode).first<{ id: string }>()
    expect(row).not.toBeNull()

    const past = Date.now() - 1000
    await db.prepare(
      'UPDATE cli_auth_requests SET expiresAt = ? WHERE id = ?'
    ).bind(past, row!.id).run()

    const pollRes = await SELF.fetch(`${BASE}/api/auth/cli/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    })
    expect(pollRes.status).toBe(200)
    const body = await pollRes.json() as { status: string; token?: string }
    expect(body.status).toBe('approved')
    expect(body.token).toBeTruthy()
  })
})

describe('C18: cleanupExpiredCliAuthRequests — stale 行削除、新しい行は残る', () => {
  it('C18', async () => {
    const db = (env as { DB: D1Database }).DB
    const now = new Date()
    const staleId = crypto.randomUUID()
    const freshId = crypto.randomUUID()
    const staleExpiresAt = now.getTime() - 2 * 60 * 60 * 1000
    const freshExpiresAt = now.getTime() + 60 * 60 * 1000

    await db.prepare(
      'INSERT INTO cli_auth_requests (id, deviceCodeHash, userCode, status, pollIntervalSec, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(staleId, 'stalehash', 'STALE001', 'pending', 5, staleExpiresAt, now.getTime()).run()

    await db.prepare(
      'INSERT INTO cli_auth_requests (id, deviceCodeHash, userCode, status, pollIntervalSec, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(freshId, 'freshhash', 'FRSH001', 'pending', 5, freshExpiresAt, now.getTime()).run()

    const deleted = await cleanupExpiredCliAuthRequests(db, now)
    expect(deleted).toBeGreaterThanOrEqual(1)

    const staleRow = await db.prepare('SELECT id FROM cli_auth_requests WHERE id = ?').bind(staleId).first()
    expect(staleRow).toBeNull()

    const freshRow = await db.prepare('SELECT id FROM cli_auth_requests WHERE id = ?').bind(freshId).first()
    expect(freshRow).not.toBeNull()
  })
})
