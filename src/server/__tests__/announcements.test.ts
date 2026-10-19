import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'
const ADMIN_TOKEN = 'test-admin-token-abc123'

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  })
}

async function patch(path: string, body: unknown, headers?: Record<string, string>) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  })
}

async function get(path: string, headers?: Record<string, string>) {
  return SELF.fetch(`${BASE}${path}`, { headers: { ...(headers ?? {}) } })
}

// miniflare の RateLimit binding は同一 key で連続呼び出しがテストを跨いで残る。
// 通常 CRUD テストでは POST/PATCH を複数回叩くケースが多いので、テスト冒頭で
// binding を退避しておき、通常テスト時は「binding 無し」= rate limit スキップにする。
// Rate limit の発動確認は専用テストで binding を復元してから検証する。
const originalTokenRatelimit = (env as Record<string, unknown>).ANNOUNCE_POST_TOKEN_RATELIMIT
const originalGetRatelimit = (env as Record<string, unknown>).ANNOUNCE_GET_RATELIMIT
const originalIpRatelimit = (env as Record<string, unknown>).CLI_AUTH_RATELIMIT

beforeEach(async () => {
  await applyMigrations()
  // ストレージはテスト間で共有されるため、絶対件数を検証できるよう毎回クリアする。
  await (env as { DB: D1Database }).DB.prepare('DELETE FROM announcement').run()
  // 通常テストでは rate limit を bypass（複数回連続 POST を許容する）
  ;(env as Record<string, unknown>).ANNOUNCE_POST_TOKEN_RATELIMIT = undefined
  ;(env as Record<string, unknown>).ANNOUNCE_GET_RATELIMIT = undefined
  ;(env as Record<string, unknown>).CLI_AUTH_RATELIMIT = undefined
})

afterEach(() => {
  delete (env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN
  ;(env as Record<string, unknown>).ANNOUNCE_POST_TOKEN_RATELIMIT = originalTokenRatelimit
  ;(env as Record<string, unknown>).ANNOUNCE_GET_RATELIMIT = originalGetRatelimit
  ;(env as Record<string, unknown>).CLI_AUTH_RATELIMIT = originalIpRatelimit
})

const VALID = {
  title: 'テスト投稿',
  body: 'これはテスト用のお知らせ本文です。',
  category: 'notice' as const,
}

describe('POST /api/announcements', () => {
  it('admin トークンなしは 403（安全側）', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await post('/api/announcements', VALID)
    expect(res.status).toBe(403)
  })

  it('トークン未設定なら 403（未設定は常に 403 で全公開しない）', async () => {
    // ANNOUNCEMENTS_ADMIN_TOKEN 未設定
    const res = await post('/api/announcements', VALID, authHeader(ADMIN_TOKEN))
    expect(res.status).toBe(403)
  })

  it('誤ったトークンは 403', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await post('/api/announcements', VALID, authHeader('wrong-token'))
    expect(res.status).toBe(403)
  })

  it('正しいトークンで 201・id が返る', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await post('/api/announcements', VALID, authHeader(ADMIN_TOKEN))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
  })

  it('Bearer 認証時は Origin ヘッダなしでも通る（CLI 経路の想定）', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    // Origin を送らずに Bearer だけで叩く
    const res = await post('/api/announcements', VALID, authHeader(ADMIN_TOKEN))
    expect(res.status).toBe(201)
  })

  it('無効なカテゴリで 400', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await post(
      '/api/announcements',
      { ...VALID, category: 'spam' },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(400)
  })

  it('タイトル空で 400', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await post('/api/announcements', { ...VALID, title: '' }, authHeader(ADMIN_TOKEN))
    expect(res.status).toBe(400)
  })

  it('タイトル空白のみで 400', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await post(
      '/api/announcements',
      { ...VALID, title: '   ' },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(400)
  })

  it('本文 4001 字で 400', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await post(
      '/api/announcements',
      { ...VALID, body: 'あ'.repeat(4001) },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(400)
  })

  it('publishedAt が未来（now + 1 分）で 400', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const future = new Date(Date.now() + 60 * 1000).toISOString()
    const res = await post(
      '/api/announcements',
      { ...VALID, publishedAt: future },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(400)
  })

  it('publishedAt が過去31日で 400', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const past = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    const res = await post(
      '/api/announcements',
      { ...VALID, publishedAt: past },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(400)
  })

  it('publishedAt が過去29日で 201', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const past = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString()
    const res = await post(
      '/api/announcements',
      { ...VALID, publishedAt: past },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(201)
  })

  it('publishedAt が過去30日境界の内側（30日-1秒）は 201（境界包含・Codex 指摘 #4 対応）', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    // 30日ちょうどは、テストクライアント側の now とサーバー側の now の間の実行遅延（数〜数百ms）で
    // 境界を跨いで 400 に落ちる。fake timer を導入せずに t >= now - 30days の閾値挙動を確認する
    // ため、境界内側の 30日-1秒 で 201 を確認する。
    const insideBoundary = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 1000).toISOString()
    const res = await post(
      '/api/announcements',
      { ...VALID, publishedAt: insideBoundary },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(201)
  })

  it('publishedAt が現在時刻ちょうど（境界）は 201', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    // now を丸めて 5 秒過去に（送信中に future と判定される可能性を避ける）
    const nowIso = new Date(Date.now() - 5000).toISOString()
    const res = await post(
      '/api/announcements',
      { ...VALID, publishedAt: nowIso },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(201)
  })
})

describe('GET /api/announcements', () => {
  it('認証不要で 200 が返り Cache-Control: no-store が付く', async () => {
    const res = await get('/api/announcements')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('0 件時は空配列', async () => {
    const res = await get('/api/announcements')
    const body = (await res.json()) as { announcements: unknown[] }
    expect(body.announcements).toEqual([])
  })

  it('published のみ返る（archived は含まない）', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    // 2 件投稿
    const a = await post(
      '/api/announcements',
      { ...VALID, title: '公開中' },
      authHeader(ADMIN_TOKEN),
    )
    const aId = ((await a.json()) as { id: string }).id
    const b = await post(
      '/api/announcements',
      { ...VALID, title: 'アーカイブ予定' },
      authHeader(ADMIN_TOKEN),
    )
    const bId = ((await b.json()) as { id: string }).id
    // b を archive
    await patch(`/api/announcements/${bId}`, { status: 'archived' }, authHeader(ADMIN_TOKEN))

    const res = await get('/api/announcements')
    const body = (await res.json()) as { announcements: Array<{ id: string; title: string }> }
    expect(body.announcements).toHaveLength(1)
    expect(body.announcements[0]!.id).toBe(aId)
  })

  it('limit=3 で最大 3 件・publishedAt DESC で並ぶ', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    // publishedAt を指定して 5 件投稿（過去 5〜1 分前）
    for (let i = 0; i < 5; i += 1) {
      const at = new Date(Date.now() - (5 - i) * 60 * 1000).toISOString()
      const r = await post(
        '/api/announcements',
        { ...VALID, title: `#${i}`, publishedAt: at },
        authHeader(ADMIN_TOKEN),
      )
      expect(r.status).toBe(201)
    }
    const res = await get('/api/announcements?limit=3')
    const body = (await res.json()) as { announcements: Array<{ title: string; publishedAt: string }> }
    expect(body.announcements).toHaveLength(3)
    // publishedAt DESC で並ぶ（#4 が一番新しい）
    expect(body.announcements[0]!.title).toBe('#4')
    expect(body.announcements[1]!.title).toBe('#3')
    expect(body.announcements[2]!.title).toBe('#2')
    for (let i = 0; i < body.announcements.length - 1; i += 1) {
      expect(
        new Date(body.announcements[i]!.publishedAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(body.announcements[i + 1]!.publishedAt).getTime())
    }
  })

  it('デフォルト limit は 5', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    for (let i = 0; i < 7; i += 1) {
      await post(
        '/api/announcements',
        { ...VALID, title: `#${i}` },
        authHeader(ADMIN_TOKEN),
      )
    }
    const res = await get('/api/announcements')
    const body = (await res.json()) as { announcements: unknown[] }
    expect(body.announcements).toHaveLength(5)
  })

  it('limit=100 は 51 件投稿しても上限 50 で切り詰められる', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    // 51 件を過去 30 日以内の別々の publishedAt で投稿
    for (let i = 0; i < 51; i += 1) {
      const at = new Date(Date.now() - (51 - i) * 60 * 1000).toISOString()
      const r = await post(
        '/api/announcements',
        { ...VALID, title: `bulk-#${i}`, publishedAt: at },
        authHeader(ADMIN_TOKEN),
      )
      expect(r.status).toBe(201)
    }
    const res = await get('/api/announcements?limit=100')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { announcements: unknown[] }
    // Math.min(100, 50) で 50 件に切り詰められる
    expect(body.announcements).toHaveLength(50)
  })

  it('limit=0 / 負数 / NaN は default 5 に fallback（拒否せず返す）', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    // 7 件投稿
    for (let i = 0; i < 7; i += 1) {
      await post(
        '/api/announcements',
        { ...VALID, title: `#${i}` },
        authHeader(ADMIN_TOKEN),
      )
    }
    const zero = await get('/api/announcements?limit=0')
    const neg = await get('/api/announcements?limit=-1')
    const nan = await get('/api/announcements?limit=foo')
    for (const res of [zero, neg, nan]) {
      expect(res.status).toBe(200)
      const body = (await res.json()) as { announcements: unknown[] }
      expect(body.announcements).toHaveLength(5)
    }
  })
})

// Miniflare uses wall-clock minute buckets. A burst straddling a boundary
// belongs to two windows, so retry only that case with a fresh key/token.
// Return unchanged results within one minute; assertions must never be retried.
async function withinRateLimitMinute<T>(run: () => Promise<T>, now = Date.now): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const startedMinute = Math.floor(now() / 60_000)
    const result = await run()
    if (Math.floor(now() / 60_000) === startedMinute) return result
  }
  throw new Error('Could not complete the rate-limit burst within one minute')
}

describe('Rate limit window guard', () => {
  it('retries a burst crossing 59,999ms → 60,000ms, then uses the stable window', async () => {
    const times = [59_999, 60_000, 60_001, 60_002]
    let attempts = 0
    const result = await withinRateLimitMinute(async () => ++attempts, () => times.shift()!)
    expect(result).toBe(2)
    expect(attempts).toBe(2)
  })

  it('returns unexpected same-window statuses unchanged without retrying', async () => {
    let attempts = 0
    const statuses = await withinRateLimitMinute(async () => {
      attempts++
      return [200, 200]
    }, () => 60_001)
    expect(statuses).toEqual([200, 200])
    expect(attempts).toBe(1)
  })

  it('fails after three boundary crossings instead of silently passing', async () => {
    let time = 0
    let attempts = 0
    await expect(withinRateLimitMinute(async () => ++attempts, () => time += 60_000))
      .rejects.toThrow('Could not complete the rate-limit burst within one minute')
    expect(attempts).toBe(3)
  })
})

describe('Rate limit', () => {
  it('GET エンドポイントの IP 単位 rate limit にヒットで 429', async () => {
    // Keep the real binding and verify its exact configured threshold (60/min).
    ;(env as Record<string, unknown>).ANNOUNCE_GET_RATELIMIT = originalGetRatelimit
    const statuses = await withinRateLimitMinute(async () => {
      const suffix = Array.from(crypto.getRandomValues(new Uint16Array(6)), (value) => value.toString(16)).join(':')
      const ip = `2001:db8:${suffix}`
      const results: number[] = []
      for (let i = 0; i < 61; i++) {
        const res = await get('/api/announcements', { 'CF-Connecting-IP': ip })
        await res.text()
        results.push(res.status)
      }
      return results
    })
    expect(statuses).toEqual([...Array<number>(60).fill(200), 429])
  })

  it('POST の token 単位 rate limit にヒットで 429（別 IP から連発した想定）', async () => {
    ;(env as Record<string, unknown>).ANNOUNCE_POST_TOKEN_RATELIMIT = originalTokenRatelimit
    const statuses = await withinRateLimitMinute(async () => {
      // A fresh admin token also creates a fresh rate-limit key after a rollover.
      const token = `test-admin-${crypto.randomUUID()}`
      ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = token
      const results: number[] = []
      for (const ip of ['203.0.113.11', '203.0.113.12', '203.0.113.13']) {
        const res = await post('/api/announcements', VALID, {
          ...authHeader(token),
          'CF-Connecting-IP': ip,
        })
        await res.text()
        results.push(res.status)
      }
      return results
    })
    expect(statuses).toEqual([201, 201, 429])
  })
})

describe('PATCH /api/announcements/:id', () => {
  it('admin トークンなしで 403', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await patch('/api/announcements/nonexistent', { status: 'archived' })
    expect(res.status).toBe(403)
  })

  it('status=archived で 200・後続の GET から消える', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const createRes = await post('/api/announcements', VALID, authHeader(ADMIN_TOKEN))
    const id = ((await createRes.json()) as { id: string }).id

    const patchRes = await patch(
      `/api/announcements/${id}`,
      { status: 'archived' },
      authHeader(ADMIN_TOKEN),
    )
    expect(patchRes.status).toBe(200)

    const listRes = await get('/api/announcements')
    const body = (await listRes.json()) as { announcements: unknown[] }
    expect(body.announcements).toHaveLength(0)
  })

  it('status=draft は zod enum で弾かれて 400', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const createRes = await post('/api/announcements', VALID, authHeader(ADMIN_TOKEN))
    const id = ((await createRes.json()) as { id: string }).id

    const res = await patch(
      `/api/announcements/${id}`,
      { status: 'draft' },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(400)
  })

  it('存在しない id で 404', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await patch(
      '/api/announcements/nonexistent-id',
      { status: 'archived' },
      authHeader(ADMIN_TOKEN),
    )
    expect(res.status).toBe(404)
  })

  it('archived → published に戻せる', async () => {
    ;(env as Record<string, unknown>).ANNOUNCEMENTS_ADMIN_TOKEN = ADMIN_TOKEN
    const createRes = await post('/api/announcements', VALID, authHeader(ADMIN_TOKEN))
    const id = ((await createRes.json()) as { id: string }).id

    // archive
    await patch(`/api/announcements/${id}`, { status: 'archived' }, authHeader(ADMIN_TOKEN))
    // unarchive
    const back = await patch(
      `/api/announcements/${id}`,
      { status: 'published' },
      authHeader(ADMIN_TOKEN),
    )
    expect(back.status).toBe(200)

    const listRes = await get('/api/announcements')
    const body = (await listRes.json()) as { announcements: Array<{ id: string }> }
    expect(body.announcements).toHaveLength(1)
    expect(body.announcements[0]!.id).toBe(id)
  })
})
