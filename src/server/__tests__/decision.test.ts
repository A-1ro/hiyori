import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs } from './test-helpers'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'http://example.com'

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
  it('D1: organizer 一致で POST → 201 + status=closed + icsSequence=0 + icsUid プレフィックス', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const res = await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })
    expect(res.status).toBe(201)

    const body = (await res.json()) as { decision: { candidateId: string; icsUid: string; icsSequence: number }; event: { status: string } }
    expect(body.event.status).toBe('closed')
    expect(body.decision.icsSequence).toBe(0)
    expect(body.decision.candidateId).toBe(candidateId)
    expect(body.decision.icsUid).toMatch(new RegExp(`^evt-${eventId}-`))
  })

  it('D2: 別 organizer で POST → 403', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const res = await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: otherCookie })
    expect(res.status).toBe(403)
  })

  it('D3: 未存在 eventId で POST → 404', async () => {
    const res = await post('/api/events/00000000-0000-4000-8000-000000000000/decision', {
      candidateId: '00000000-0000-4000-8000-000000000001',
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(404)
  })

  it('D4: 他イベントの candidateId で POST → 400', async () => {
    // event1 作成
    const createRes1 = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created1 = (await createRes1.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId1 = created1.event.id

    // event2 作成
    const createRes2 = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created2 = (await createRes2.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const candidateFromEvent2 = created2.candidates[0]!.id

    // event1 に event2 の候補で確定しようとする
    const res = await post(`/api/events/${eventId1}/decision`, {
      candidateId: candidateFromEvent2,
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(400)
  })

  it('D5: 再 POST で別 candidate → 200 + 同じ icsUid + icsSequence=1', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId1 = created.candidates[0]!.id
    const candidateId2 = created.candidates[1]!.id

    // 最初の確定
    const res1 = await post(`/api/events/${eventId}/decision`, { candidateId: candidateId1 }, { Cookie: organizerCookie })
    expect(res1.status).toBe(201)
    const body1 = (await res1.json()) as { decision: { icsUid: string; icsSequence: number } }
    const firstIcsUid = body1.decision.icsUid

    // 再確定（別 candidate）
    const res2 = await post(`/api/events/${eventId}/decision`, { candidateId: candidateId2 }, { Cookie: organizerCookie })
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as { decision: { candidateId: string; icsUid: string; icsSequence: number } }
    expect(body2.decision.icsUid).toBe(firstIcsUid)
    expect(body2.decision.icsSequence).toBe(1)
    expect(body2.decision.candidateId).toBe(candidateId2)
  })
})

describe('DELETE /api/events/:id/decision', () => {
  it('D6: DELETE 正常 → 200 + cancelledAt 設定 + status=open + icsSequence+1', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    // 先に確定
    await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })

    // 取り消し
    const res = await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { decision: { icsSequence: number }; event: { status: string } }
    expect(body.event.status).toBe('open')
    expect(body.decision.icsSequence).toBe(1)

    // DB 直接確認: cancelledAt が設定されている
    const db = (env as { DB: D1Database }).DB
    const row = await db.prepare('SELECT cancelledAt FROM decisions WHERE eventId = ?').bind(eventId).first()
    expect(row).not.toBeNull()
    expect((row as { cancelledAt: number | null }).cancelledAt).not.toBeNull()
  })

  it('D7: 別 organizer で DELETE → 403', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })

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
  it('D9: DELETE 後再 POST → 200 + 同じ icsUid 保持 + cancelledAt=null + icsSequence さらに +1', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId1 = created.candidates[0]!.id
    const candidateId2 = created.candidates[1]!.id

    // 最初の確定 (icsSeq=0)
    const res1 = await post(`/api/events/${eventId}/decision`, { candidateId: candidateId1 }, { Cookie: organizerCookie })
    const body1 = (await res1.json()) as { decision: { icsUid: string; icsSequence: number } }
    const firstIcsUid = body1.decision.icsUid
    expect(body1.decision.icsSequence).toBe(0)

    // 取り消し (icsSeq=1)
    const res2 = await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })
    const body2 = (await res2.json()) as { decision: { icsSequence: number } }
    expect(body2.decision.icsSequence).toBe(1)

    // 再確定 (icsSeq=2)
    const res3 = await post(`/api/events/${eventId}/decision`, { candidateId: candidateId2 }, { Cookie: organizerCookie })
    expect(res3.status).toBe(200)
    const body3 = (await res3.json()) as { decision: { icsUid: string; icsSequence: number; cancelledAt?: string } }
    expect(body3.decision.icsUid).toBe(firstIcsUid)
    expect(body3.decision.icsSequence).toBe(2)
    expect(body3.decision.cancelledAt ?? null).toBeNull()

    // DB 直接確認: cancelledAt が null
    const db = (env as { DB: D1Database }).DB
    const row = await db.prepare('SELECT cancelledAt FROM decisions WHERE eventId = ?').bind(eventId).first()
    expect((row as { cancelledAt: number | null }).cancelledAt).toBeNull()
  })

  it('D10: AuditLog に decision.create と decision.cancel が記録される', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })
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

  it('D11: 確定後 tally の decision が返る / 取消後 decision が null になる', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    // 確定前: decision null
    const tally1 = await get(`/api/events/${eventId}/tally`)
    const tallyBody1 = (await tally1.json()) as { decision: unknown }
    expect(tallyBody1.decision).toBeNull()

    // 確定後: decision あり
    await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })
    const tally2 = await get(`/api/events/${eventId}/tally`)
    const tallyBody2 = (await tally2.json()) as { decision: { candidateId: string } | null }
    expect(tallyBody2.decision).not.toBeNull()
    expect(tallyBody2.decision?.candidateId).toBe(candidateId)

    // 取消後: decision null
    await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })
    const tally3 = await get(`/api/events/${eventId}/tally`)
    const tallyBody3 = (await tally3.json()) as { decision: unknown }
    expect(tallyBody3.decision).toBeNull()
  })
})
