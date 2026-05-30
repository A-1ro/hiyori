import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'http://example.com'

async function jsonFetch(path: string, init?: RequestInit) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return res
}

async function post(path: string, body: unknown) {
  return jsonFetch(path, { method: 'POST', body: JSON.stringify(body) })
}

async function patch(path: string, body: unknown) {
  return jsonFetch(path, { method: 'PATCH', body: JSON.stringify(body) })
}

async function del(path: string) {
  return jsonFetch(path, { method: 'DELETE' })
}

const validEventBase = {
  organizerDiscordId: '12345678901234567',
  title: 'テストイベント',
  defaultDurationMinutes: 60,
  candidates: [
    { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
    { startAt: '2026-07-02T10:00:00.000Z' },
  ],
}

beforeEach(async () => {
  await applyMigrations()
})

describe('POST /api/events', () => {
  it('候補枠 2 件で 201 + endAt 補完', async () => {
    const res = await post('/api/events', validEventBase)
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
    const res = await post('/api/events', { ...validEventBase, candidates: [] })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid request')
  })

  it('終日候補枠を含む場合 400', async () => {
    const res = await post('/api/events', {
      ...validEventBase,
      candidates: [{ startAt: '2026-07-01T00:00:00.000Z', endAt: '2026-07-02T00:00:00.000Z' }],
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/events/:id', () => {
  it('存在するイベント → 200 + candidates', async () => {
    const createRes = await post('/api/events', validEventBase)
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
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }

    const res = await jsonFetch(`/api/events/${created.event.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: Record<string, unknown> }
    expect(body.event.organizerDiscordId).toBeUndefined()
  })
})

describe('PATCH /api/events/:id', () => {
  it('title 更新 → 200 + 反映', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }

    const res = await patch(`/api/events/${created.event.id}`, { title: '更新タイトル' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: { title: string } }
    expect(body.event.title).toBe('更新タイトル')
  })

  it('status を送ると status は反映されない', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string; status: string } }
    const originalStatus = created.event.status

    // patchEventBody には status フィールドがないので無視される
    const res = await patch(`/api/events/${created.event.id}`, {
      title: '新タイトル',
      status: 'confirmed',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { event: { status: string } }
    expect(body.event.status).toBe(originalStatus)
  })

  it('organizerDiscordId を送っても無視される（patchEventBody にフィールドがない）', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }

    // patchEventBody には organizerDiscordId がないので無視される
    const res = await patch(`/api/events/${created.event.id}`, {
      title: '新タイトル',
      organizerDiscordId: '99999999999999999',
    })
    expect(res.status).toBe(200)
    // organizerDiscordId は serverOnly のためレスポンスに含まれない
    const body = (await res.json()) as { event: Record<string, unknown> }
    expect(body.event.title).toBe('新タイトル')
    expect(body.event.organizerDiscordId).toBeUndefined()
  })
})

describe('DELETE /api/events/:id', () => {
  it('DELETE /api/events/:id cascades to votes, participants, decisions, candidates', async () => {
    const createRes = await post('/api/events', validEventBase)
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

    const deleteRes = await del(`/api/events/${id}`)
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
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string; defaultDurationMinutes: number } }
    const id = created.event.id

    const res = await post(`/api/events/${id}/candidates`, {
      startAt: '2026-07-03T14:00:00.000Z',
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { candidate: { startAt: string; endAt: string } }
    const startMs = new Date(body.candidate.startAt).getTime()
    const endMs = new Date(body.candidate.endAt).getTime()
    expect(endMs - startMs).toBe(60 * 60 * 1000)
  })

  it('終日候補枠は 400', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }
    const id = created.event.id

    const res = await post(`/api/events/${id}/candidates`, {
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-07-02T00:00:00.000Z',
    })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/events/:id/candidates/:candidateId', () => {
  it('DELETE candidate → GET で消えている', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const deleteRes = await del(`/api/events/${eventId}/candidates/${candidateId}`)
    expect(deleteRes.status).toBe(204)

    const getRes = await jsonFetch(`/api/events/${eventId}`)
    const body = (await getRes.json()) as { candidates: Array<{ id: string }> }
    expect(body.candidates.find((c) => c.id === candidateId)).toBeUndefined()
  })
})
