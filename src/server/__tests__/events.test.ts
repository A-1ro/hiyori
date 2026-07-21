import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs } from './test-helpers'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'
const ORGANIZER_ID = '12345678901234567'

async function jsonFetch(path: string, init?: RequestInit) {
  const { headers: extraHeaders, ...rest } = init ?? {}
  const res = await SELF.fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders as Record<string, string> ?? {}) },
  })
  return res
}

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) })
}

async function patch(path: string, body: unknown, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'PATCH', body: JSON.stringify(body), ...(headers ? { headers } : {}) })
}

async function del(path: string, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'DELETE', ...(headers ? { headers } : {}) })
}

const validEventBase = {
  title: 'テストイベント',
  defaultDurationMinutes: 60,
  candidates: [
    { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
    { startAt: '2026-07-02T10:00:00.000Z' },
  ],
}

let organizerCookie: string

beforeEach(async () => {
  await applyMigrations()
  organizerCookie = await loginAs(ORGANIZER_ID)
})

describe('POST /api/events', () => {
  it('候補枠 2 件で 201 + endAt 補完', async () => {
    const res = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { event: unknown; candidates: Array<{ startAt: string; endAt: string }> }
    expect(body.event).toBeTruthy()
    expect(body.candidates).toHaveLength(2)
    // 2つ目の候補枠は endAt が省略 → defaultDurationMinutes(60分)で補完
    const second = body.candidates[1]!
    const startMs = new Date(second.startAt).getTime()
    const endMs = new Date(second.endAt).getTime()
    expect(endMs - startMs).toBe(60 * 60 * 1000)
  })

  it('候補枠 0 件で 400', async () => {
    const res = await post('/api/events', { ...validEventBase, candidates: [] }, { Cookie: organizerCookie })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid request')
  })

  it('終日候補枠を含む場合 400', async () => {
    const res = await post('/api/events', {
      ...validEventBase,
      candidates: [{ startAt: '2026-07-01T00:00:00.000Z', endAt: '2026-07-02T00:00:00.000Z' }],
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/events/:id', () => {
  it('存在するイベント → 200 + candidates', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: unknown[] }

    const res = await jsonFetch(`/api/events/${created.event.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: { id: string }; candidates: unknown[] }
    expect(body.event.id).toBe(created.event.id)
    expect(body.candidates).toHaveLength(2)
  })

  it('未存在 → 404 JSON', async () => {
    const res = await jsonFetch('/api/events/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Not Found')
  })

  it('organizerDiscordId は serverOnly のためレスポンスに含まれない', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }

    const res = await jsonFetch(`/api/events/${created.event.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: Record<string, unknown> }
    expect(body.event.organizerDiscordId).toBeUndefined()
  })
})

describe('PATCH /api/events/:id', () => {
  it('title 更新 → 200 + 反映', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }

    const res = await patch(`/api/events/${created.event.id}`, { title: '更新タイトル' }, { Cookie: organizerCookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: { title: string } }
    expect(body.event.title).toBe('更新タイトル')
  })

  it('status を送ると status は反映されない', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string; status: string } }
    const originalStatus = created.event.status

    // patchEventBody には status フィールドがないので無視される
    const res = await patch(`/api/events/${created.event.id}`, {
      title: '新タイトル',
      status: 'confirmed',
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: { status: string } }
    expect(body.event.status).toBe(originalStatus)
  })

  it('deadline を設定 → null で消去 → 締切なしに戻る', async () => {
    const createRes = await post(
      '/api/events',
      { ...validEventBase, deadline: '2026-07-05T12:00:00.000Z' },
      { Cookie: organizerCookie },
    )
    const created = (await createRes.json()) as { event: { id: string; deadline?: string } }
    expect(created.event.deadline).toBe('2026-07-05T12:00:00.000Z')

    // deadline: null を送ると締切が消える（undefined 変換で前値が残るバグの回帰防止）
    const cleared = await patch(
      `/api/events/${created.event.id}`,
      { deadline: null },
      { Cookie: organizerCookie },
    )
    expect(cleared.status).toBe(200)
    const clearedBody = (await cleared.json()) as { event: { deadline?: string } }
    expect(clearedBody.event.deadline ?? null).toBeNull()

    // GET でも締切なしが永続化されている
    const getRes = await jsonFetch(`/api/events/${created.event.id}`)
    const getBody = (await getRes.json()) as { event: { deadline?: string | null } }
    expect(getBody.event.deadline ?? null).toBeNull()
  })

  it('deadline あり → 別 deadline に更新できる（正常系リグレッション）', async () => {
    const createRes = await post(
      '/api/events',
      { ...validEventBase, deadline: '2026-07-05T12:00:00.000Z' },
      { Cookie: organizerCookie },
    )
    const created = (await createRes.json()) as { event: { id: string } }

    const res = await patch(
      `/api/events/${created.event.id}`,
      { deadline: '2026-07-10T09:00:00.000Z' },
      { Cookie: organizerCookie },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: { deadline?: string } }
    expect(body.event.deadline).toBe('2026-07-10T09:00:00.000Z')
  })

  it('deadline を送らない PATCH は既存の締切を維持する', async () => {
    const createRes = await post(
      '/api/events',
      { ...validEventBase, deadline: '2026-07-05T12:00:00.000Z' },
      { Cookie: organizerCookie },
    )
    const created = (await createRes.json()) as { event: { id: string } }

    const res = await patch(
      `/api/events/${created.event.id}`,
      { title: 'タイトルだけ更新' },
      { Cookie: organizerCookie },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: { deadline?: string } }
    expect(body.event.deadline).toBe('2026-07-05T12:00:00.000Z')
  })

  it('organizerDiscordId を送っても無視される（patchEventBody にフィールドがない）', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }

    // patchEventBody には organizerDiscordId がないので無視される
    const res = await patch(`/api/events/${created.event.id}`, {
      title: '新タイトル',
      organizerDiscordId: '99999999999999999',
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(200)
    // organizerDiscordId は serverOnly のためレスポンスに含まれない
    const body = (await res.json()) as { event: Record<string, unknown> }
    expect(body.event.title).toBe('新タイトル')
    expect(body.event.organizerDiscordId).toBeUndefined()
  })
})

describe('DELETE /api/events/:id', () => {
  it('DELETE /api/events/:id cascades to votes, participants, decisions, candidates', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const id = created.event.id
    const candidateId = created.candidates[0]!.id

    const db = (env as { DB: D1Database }).DB

    const participantId = crypto.randomUUID()
    await db.prepare(
      'INSERT INTO participants (id, eventId, kind, displayName, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).bind(participantId, id, 'guest', 'テストユーザー', Date.now()).run()

    await db.prepare(
      'INSERT INTO votes (id, candidateId, participantId, choice, updatedAt) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), candidateId, participantId, 'ok', Date.now()).run()

    await db.prepare(
      'INSERT INTO decisions (id, eventId, candidateId, decidedAt, icsUid, icsSequence) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), id, candidateId, Date.now(), 'test-uid', 0).run()

    const deleteRes = await del(`/api/events/${id}`, { Cookie: organizerCookie })
    expect(deleteRes.status).toBe(204)

    const voteCount = await db.prepare('SELECT COUNT(*) as c FROM votes WHERE candidateId = ?').bind(candidateId).first<{ c: number }>()
    expect(voteCount?.c).toBe(0)

    const participantCount = await db.prepare('SELECT COUNT(*) as c FROM participants WHERE eventId = ?').bind(id).first<{ c: number }>()
    expect(participantCount?.c).toBe(0)

    const decisionCount = await db.prepare('SELECT COUNT(*) as c FROM decisions WHERE eventId = ?').bind(id).first<{ c: number }>()
    expect(decisionCount?.c).toBe(0)

    const candidateCount = await db.prepare('SELECT COUNT(*) as c FROM candidates WHERE eventId = ?').bind(id).first<{ c: number }>()
    expect(candidateCount?.c).toBe(0)

    const getRes = await jsonFetch(`/api/events/${id}`)
    expect(getRes.status).toBe(404)
  })
})

describe('POST /api/events/:id/candidates', () => {
  it('POST candidates → endAt 補完', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string; defaultDurationMinutes: number } }
    const id = created.event.id

    const res = await post(`/api/events/${id}/candidates`, {
      startAt: '2026-07-03T14:00:00.000Z',
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { candidate: { startAt: string; endAt: string } }
    const startMs = new Date(body.candidate.startAt).getTime()
    const endMs = new Date(body.candidate.endAt).getTime()
    expect(endMs - startMs).toBe(60 * 60 * 1000)
  })

  it('終日候補枠は 400', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }
    const id = created.event.id

    const res = await post(`/api/events/${id}/candidates`, {
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-07-02T00:00:00.000Z',
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/events/:id/candidates/:candidateId', () => {
  it('DELETE candidate → GET で消えている', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const deleteRes = await del(`/api/events/${eventId}/candidates/${candidateId}`, { Cookie: organizerCookie })
    expect(deleteRes.status).toBe(204)

    const getRes = await jsonFetch(`/api/events/${eventId}`)
    const body = (await getRes.json()) as { candidates: Array<{ id: string }> }
    expect(body.candidates.find((c) => c.id === candidateId)).toBeUndefined()
  })
})
