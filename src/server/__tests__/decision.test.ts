import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs } from './test-helpers'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'

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

async function del(path: string, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'DELETE', ...(headers ? { headers } : {}) })
}

async function get(path: string) {
  return jsonFetch(path)
}

const ORGANIZER_ID = '12345678901234567'
const OTHER_ORGANIZER_ID = '98765432109876543'

const validEventBase = {
  title: 'テストイベント',
  defaultDurationMinutes: 60,
  candidates: [
    { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
    { startAt: '2026-07-02T10:00:00.000Z', endAt: '2026-07-02T11:00:00.000Z' },
    { startAt: '2026-07-03T10:00:00.000Z', endAt: '2026-07-03T11:00:00.000Z' },
  ],
}

let organizerCookie: string
let otherCookie: string

beforeEach(async () => {
  await applyMigrations()
  organizerCookie = await loginAs(ORGANIZER_ID)
  otherCookie = await loginAs(OTHER_ORGANIZER_ID)
})

describe('POST /api/events/:id/decision', () => {
  it('D1: organizer 一致で POST → 201 + status=closed + decisions に candidate を含む', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const res = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })
    expect(res.status).toBe(201)

    const body = (await res.json()) as {
      decisions: Array<{ candidateId: string; icsUid: string; icsSequence: number }>
      event: { status: string }
    }
    expect(body.event.status).toBe('closed')
    expect(body.decisions).toHaveLength(1)
    expect(body.decisions[0]!.candidateId).toBe(candidateId)
    expect(body.decisions[0]!.icsSequence).toBe(0)
    expect(body.decisions[0]!.icsUid).toMatch(new RegExp(`^evt-${eventId}-`))
  })

  it('D2: 別 organizer で POST → 403', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const res = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: otherCookie })
    expect(res.status).toBe(403)
  })

  it('D3: 未存在 eventId で POST → 404', async () => {
    const res = await post('/api/events/00000000-0000-4000-8000-000000000000/decision', {
      candidateIds: ['00000000-0000-4000-8000-000000000001'],
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(404)
  })

  it('D4: 他イベントの candidateId で POST → 400', async () => {
    const createRes1 = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created1 = (await createRes1.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId1 = created1.event.id

    const createRes2 = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created2 = (await createRes2.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const candidateFromEvent2 = created2.candidates[0]!.id

    const res = await post(`/api/events/${eventId1}/decision`, {
      candidateIds: [candidateFromEvent2],
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(400)
  })

  it('D5: 既存 decision に別 candidate を加えて POST → 200 + 2件アクティブ', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId1 = created.candidates[0]!.id
    const candidateId2 = created.candidates[1]!.id

    // 1件確定
    const res1 = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId1] }, { Cookie: organizerCookie })
    expect(res1.status).toBe(201)

    // 2件目を追加（[1, 2] で上書き）
    const res2 = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId1, candidateId2] }, { Cookie: organizerCookie })
    expect(res2.status).toBe(201) // 新規追加があるので 201
    const body2 = (await res2.json()) as {
      decisions: Array<{ candidateId: string; icsUid: string; icsSequence: number }>
      event: { status: string }
    }
    expect(body2.event.status).toBe('closed')
    expect(body2.decisions).toHaveLength(2)
    const sortedCands = body2.decisions.map((d) => d.candidateId).sort()
    expect(sortedCands).toEqual([candidateId1, candidateId2].sort())
  })

  it('D5b: 既存 decision のうち 1 件だけ残す（縮小）→ 200 + 残った 1 件 + 外したのは cancelled', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId1 = created.candidates[0]!.id
    const candidateId2 = created.candidates[1]!.id

    // 2 件確定
    await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId1, candidateId2] }, { Cookie: organizerCookie })

    // candidate2 だけに縮小
    const res = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId2] }, { Cookie: organizerCookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      decisions: Array<{ candidateId: string }>
      event: { status: string }
    }
    expect(body.decisions).toHaveLength(1)
    expect(body.decisions[0]!.candidateId).toBe(candidateId2)
    expect(body.event.status).toBe('closed')

    // DB: candidate1 の decision は cancelledAt 設定
    const db = (env as { DB: D1Database }).DB
    const row = await db.prepare('SELECT cancelledAt FROM decisions WHERE eventId = ? AND candidateId = ?').bind(eventId, candidateId1).first()
    expect(row).not.toBeNull()
    expect((row as { cancelledAt: number | null }).cancelledAt).not.toBeNull()
  })
})

describe('DELETE /api/events/:id/decision', () => {
  it('D6: DELETE 正常 → 200 + 全 active が cancelled + status=open', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })

    const res = await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { decisions: unknown[]; event: { status: string } }
    expect(body.event.status).toBe('open')
    expect(body.decisions).toEqual([])

    const db = (env as { DB: D1Database }).DB
    const row = await db.prepare('SELECT cancelledAt, icsSequence FROM decisions WHERE eventId = ?').bind(eventId).first()
    expect(row).not.toBeNull()
    expect((row as { cancelledAt: number | null }).cancelledAt).not.toBeNull()
    expect((row as { icsSequence: number }).icsSequence).toBe(1)
  })

  it('D7: 別 organizer で DELETE → 403', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })

    const res = await del(`/api/events/${eventId}/decision`, { Cookie: otherCookie })
    expect(res.status).toBe(403)
  })

  it('D8: Decision 無しで DELETE → 404', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    const res = await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })
    expect(res.status).toBe(404)
  })
})

describe('Decision シーケンス管理', () => {
  it('D9: 取消後同 candidate で再確定 → 同じ icsUid 保持 + cancelledAt=null + icsSequence+2', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    // 1: 確定 (seq=0)
    const res1 = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })
    const body1 = (await res1.json()) as { decisions: Array<{ icsUid: string; icsSequence: number }> }
    const firstIcsUid = body1.decisions[0]!.icsUid
    expect(body1.decisions[0]!.icsSequence).toBe(0)

    // 2: 全取消 (seq=1)
    await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })

    // 3: 同 candidate を再確定 → 既存行 reactivate (seq=2, 同 icsUid)
    const res3 = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })
    expect(res3.status).toBe(201)
    const body3 = (await res3.json()) as { decisions: Array<{ icsUid: string; icsSequence: number; cancelledAt?: string | null }> }
    expect(body3.decisions[0]!.icsUid).toBe(firstIcsUid)
    expect(body3.decisions[0]!.icsSequence).toBe(2)
    expect(body3.decisions[0]!.cancelledAt ?? null).toBeNull()

    const db = (env as { DB: D1Database }).DB
    const row = await db.prepare('SELECT cancelledAt FROM decisions WHERE eventId = ?').bind(eventId).first()
    expect((row as { cancelledAt: number | null }).cancelledAt).toBeNull()
  })

  it('D10: AuditLog に decision.create と decision.cancel が記録される', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })
    await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })

    const db = (env as { DB: D1Database }).DB
    const createLog = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'decision.create' AND actorDiscordId = ?")
      .bind(ORGANIZER_ID)
      .first()
    expect(createLog).not.toBeNull()

    const cancelLog = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'decision.cancel' AND actorDiscordId = ?")
      .bind(ORGANIZER_ID)
      .first()
    expect(cancelLog).not.toBeNull()
  })

  it('D11: 確定後 tally の decisions が返る / 取消後 decisions が空配列になる', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const tally1 = await get(`/api/events/${eventId}/tally`)
    const tallyBody1 = (await tally1.json()) as { decisions: unknown[] }
    expect(tallyBody1.decisions).toEqual([])

    await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })
    const tally2 = await get(`/api/events/${eventId}/tally`)
    const tallyBody2 = (await tally2.json()) as { decisions: Array<{ candidateId: string }> }
    expect(tallyBody2.decisions).toHaveLength(1)
    expect(tallyBody2.decisions[0]!.candidateId).toBe(candidateId)

    await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })
    const tally3 = await get(`/api/events/${eventId}/tally`)
    const tallyBody3 = (await tally3.json()) as { decisions: unknown[] }
    expect(tallyBody3.decisions).toEqual([])
  })

  it('D12: 複数件同時確定 → 全 candidate がアクティブ + 各々独立 icsUid', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const ids = created.candidates.map((c) => c.id)

    const res = await post(`/api/events/${eventId}/decision`, { candidateIds: ids }, { Cookie: organizerCookie })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      decisions: Array<{ candidateId: string; icsUid: string; icsSequence: number }>
      event: { status: string }
    }
    expect(body.decisions).toHaveLength(3)
    expect(body.event.status).toBe('closed')
    const uids = new Set(body.decisions.map((d) => d.icsUid))
    expect(uids.size).toBe(3)
    for (const d of body.decisions) {
      expect(d.icsSequence).toBe(0)
    }
  })
})
