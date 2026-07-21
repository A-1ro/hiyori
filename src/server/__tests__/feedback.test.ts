import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'
const ADMIN_TOKEN = 'test-admin-token-123'

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  })
}

async function getFeedback(query = '', headers?: Record<string, string>) {
  return SELF.fetch(`${BASE}/api/feedback${query}`, { headers: { ...(headers ?? {}) } })
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

beforeEach(async () => {
  await applyMigrations()
  // ストレージはテスト間で共有されるため、絶対件数を検証できるよう毎回クリアする。
  await (env as { DB: D1Database }).DB.prepare('DELETE FROM feedback').run()
})

afterEach(() => {
  delete (env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN
})

describe('POST /api/feedback', () => {
  it('本文＋自動コンテキストで保存され 201', async () => {
    const res = await post(
      '/api/feedback',
      { message: '締切を空に戻せませんでした', category: 'bug', pageUrl: 'https://example.com/events/e1/vote', eventId: 'e1', submitter: 'みか' },
      { 'User-Agent': 'test-agent/1.0' },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)

    // admin 経由で保存内容（自動付与の userAgent 含む）を確認
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const list = await getFeedback('', authHeader(ADMIN_TOKEN))
    const listBody = (await list.json()) as { feedback: Array<Record<string, unknown>> }
    expect(listBody.feedback).toHaveLength(1)
    const row = listBody.feedback[0]!
    expect(row.message).toBe('締切を空に戻せませんでした')
    expect(row.category).toBe('bug')
    expect(row.eventId).toBe('e1')
    expect(row.submitter).toBe('みか')
    expect(row.userAgent).toBe('test-agent/1.0')
    expect(row.status).toBe('new')
    expect(typeof row.createdAt).toBe('string')
  })

  it('ログイン不要・任意項目なしでも送れる', async () => {
    const res = await post('/api/feedback', { message: '要望です' })
    expect(res.status).toBe(201)
  })

  it('空本文は 400', async () => {
    const res = await post('/api/feedback', { message: '' })
    expect(res.status).toBe(400)
  })

  it('空白のみ本文は 400', async () => {
    const res = await post('/api/feedback', { message: '   \n  ' })
    expect(res.status).toBe(400)
  })

  it('超長文（4000超）は 400', async () => {
    const res = await post('/api/feedback', { message: 'あ'.repeat(4001) })
    expect(res.status).toBe(400)
  })

  it('不正カテゴリは 400', async () => {
    const res = await post('/api/feedback', { message: 'test', category: 'spam' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/feedback（admin 保護）', () => {
  it('トークン未設定なら 403（安全側）', async () => {
    // FEEDBACK_ADMIN_TOKEN 未設定
    const res = await getFeedback('', authHeader(ADMIN_TOKEN))
    expect(res.status).toBe(403)
  })

  it('トークンなしは 403', async () => {
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await getFeedback()
    expect(res.status).toBe(403)
  })

  it('誤ったトークンは 403', async () => {
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await getFeedback('', authHeader('wrong-token'))
    expect(res.status).toBe(403)
  })

  it('正しいトークンで新しい順に取得', async () => {
    await post('/api/feedback', { message: '1件目' })
    await post('/api/feedback', { message: '2件目' })
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await getFeedback('', authHeader(ADMIN_TOKEN))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { feedback: Array<{ message: string; createdAt: string }> }
    expect(body.feedback.length).toBe(2)
    // desc（新しい順）
    const [a, b] = body.feedback
    expect(new Date(a!.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(b!.createdAt).getTime())
  })

  it('?status フィルタが効く', async () => {
    await post('/api/feedback', { message: 'new のまま' })
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const resNew = await getFeedback('?status=new', authHeader(ADMIN_TOKEN))
    expect(((await resNew.json()) as { feedback: unknown[] }).feedback).toHaveLength(1)
    const resResolved = await getFeedback('?status=resolved', authHeader(ADMIN_TOKEN))
    expect(((await resResolved.json()) as { feedback: unknown[] }).feedback).toHaveLength(0)
  })

  it('?since フィルタが効く（新着だけ返す）', async () => {
    await post('/api/feedback', { message: '古い' })
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const first = await getFeedback('', authHeader(ADMIN_TOKEN))
    const firstBody = (await first.json()) as { feedback: Array<{ createdAt: string }> }
    const cursor = firstBody.feedback[0]!.createdAt

    // カーソル以降に新規投稿
    await new Promise((r) => setTimeout(r, 5))
    await post('/api/feedback', { message: '新しい' })

    const since = await getFeedback(`?since=${encodeURIComponent(cursor)}`, authHeader(ADMIN_TOKEN))
    const sinceBody = (await since.json()) as { feedback: Array<{ message: string }> }
    expect(sinceBody.feedback).toHaveLength(1)
    expect(sinceBody.feedback[0]!.message).toBe('新しい')
  })

  it('不正な since は 400', async () => {
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await getFeedback('?since=not-a-date', authHeader(ADMIN_TOKEN))
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/feedback/:id（admin 保護）', () => {
  it('status を更新できる', async () => {
    await post('/api/feedback', { message: 'triage する' })
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const list = await getFeedback('', authHeader(ADMIN_TOKEN))
    const id = ((await list.json()) as { feedback: Array<{ id: string }> }).feedback[0]!.id

    const res = await SELF.fetch(`${BASE}/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(ADMIN_TOKEN) },
      body: JSON.stringify({ status: 'resolved' }),
    })
    expect(res.status).toBe(200)

    const after = await getFeedback('?status=resolved', authHeader(ADMIN_TOKEN))
    expect(((await after.json()) as { feedback: unknown[] }).feedback).toHaveLength(1)
  })

  it('トークンなしは 403', async () => {
    ;(env as Record<string, unknown>).FEEDBACK_ADMIN_TOKEN = ADMIN_TOKEN
    const res = await SELF.fetch(`${BASE}/api/feedback/some-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    })
    expect(res.status).toBe(403)
  })
})
