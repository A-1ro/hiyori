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

async function put(path: string, body: unknown, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'PUT', body: JSON.stringify(body), ...(headers ? { headers } : {}) })
}

async function get(path: string, headers?: Record<string, string>) {
  return jsonFetch(path, headers ? { headers } : undefined)
}

function extractSetCookie(res: Response): string | null {
  return res.headers.get('set-cookie')
}

function cookieHeaderFromSetCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0]!.trim()
}

const ORGANIZER_ID = '12345678901234567'

const validEventBase = {
  title: 'テストイベント',
  defaultDurationMinutes: 60,
  candidates: [
    { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
    { startAt: '2026-07-02T10:00:00.000Z', endAt: '2026-07-02T11:00:00.000Z' },
  ],
}

let organizerCookie: string

beforeEach(async () => {
  await applyMigrations()
  organizerCookie = await loginAs(ORGANIZER_ID)
})

describe('GET /api/events/:id/tally', () => {
  it('T1: 未存在 id → 404', async () => {
    const res = await get('/api/events/00000000-0000-0000-0000-000000000000/tally')
    expect(res.status).toBe(404)
  })

  it('T2: 候補 2 / 参加者 0 → 200, participants=[], totalScore=0, counts all 0, votesByParticipantId={}', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id

    const res = await get(`/api/events/${eventId}/tally`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      participants: unknown[]
      candidates: Array<{ totalScore: number; counts: { yes: number; maybe: number; no: number }; votesByParticipantId: Record<string, unknown> }>
      decisions: unknown[]
    }
    expect(body.participants).toEqual([])
    expect(body.candidates).toHaveLength(2)
    for (const cand of body.candidates) {
      expect(cand.totalScore).toBe(0)
      expect(cand.counts.yes).toBe(0)
      expect(cand.counts.maybe).toBe(0)
      expect(cand.counts.no).toBe(0)
      expect(cand.votesByParticipantId).toEqual({})
    }
    expect(body.decisions).toEqual([])
  })

  it('T3: 候補 2 × 参加者 2 投票 → スコアと counts が正しい', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const [cand1, cand2] = created.candidates as [{ id: string }, { id: string }]

    // participant1 登録
    const reg1 = await post(`/api/events/${eventId}/participants`, { kind: 'guest', displayName: 'P1' })
    const cookie1 = cookieHeaderFromSetCookie(extractSetCookie(reg1)!)

    // participant2 登録
    const reg2 = await post(`/api/events/${eventId}/participants`, { kind: 'guest', displayName: 'P2' })
    const cookie2 = cookieHeaderFromSetCookie(extractSetCookie(reg2)!)

    // participant1 投票: cand1=yes, cand2=yes
    await put(
      `/api/events/${eventId}/votes`,
      { votes: [{ candidateId: cand1.id, choice: 'yes' }, { candidateId: cand2.id, choice: 'yes' }] },
      { Cookie: cookie1 },
    )

    // participant2 投票: cand1=maybe, cand2=no
    await put(
      `/api/events/${eventId}/votes`,
      { votes: [{ candidateId: cand1.id, choice: 'maybe' }, { candidateId: cand2.id, choice: 'no' }] },
      { Cookie: cookie2 },
    )

    const res = await get(`/api/events/${eventId}/tally`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      candidates: Array<{ id: string; totalScore: number; counts: { yes: number; maybe: number; no: number } }>
    }

    const tCand1 = body.candidates.find((c) => c.id === cand1.id)!
    const tCand2 = body.candidates.find((c) => c.id === cand2.id)!

    // cand1: yes(2) + maybe(1) = 3; counts={yes:1,maybe:1,no:0}
    expect(tCand1.totalScore).toBe(3)
    expect(tCand1.counts).toEqual({ yes: 1, maybe: 1, no: 0 })

    // cand2: yes(2) + no(0) = 2; counts={yes:1,maybe:0,no:1}
    expect(tCand2.totalScore).toBe(2)
    expect(tCand2.counts).toEqual({ yes: 1, maybe: 0, no: 1 })
  })

  it('T4: レスポンス body に guestTokenHash / discordUserId が含まれない', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    await post(`/api/events/${eventId}/participants`, { kind: 'guest', displayName: 'LeakTest' })

    const res = await get(`/api/events/${eventId}/tally`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('guestTokenHash')
    expect(JSON.stringify(body)).not.toContain('discordUserId')
  })

  it('T5: 参加者 3 名を順番に登録 → participants が createdAt 昇順（登録順）', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    for (const name of ['First', 'Second', 'Third']) {
      await post(`/api/events/${eventId}/participants`, { kind: 'guest', displayName: name })
    }

    const res = await get(`/api/events/${eventId}/tally`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { participants: Array<{ displayName: string }> }
    expect(body.participants).toHaveLength(3)
    expect(body.participants.map((p) => p.displayName)).toEqual(['First', 'Second', 'Third'])
  })

  it('T7: candidates が startAt 昇順で返る（逆順投入でも）', async () => {
    const reversedEvent = {
      title: '昇順テスト',
      defaultDurationMinutes: 60,
      candidates: [
        { startAt: '2026-09-10T10:00:00.000Z', endAt: '2026-09-10T11:00:00.000Z' },
        { startAt: '2026-08-10T10:00:00.000Z', endAt: '2026-08-10T11:00:00.000Z' },
      ],
    }

    const createRes = await post('/api/events', reversedEvent, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    const res = await get(`/api/events/${eventId}/tally`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { candidates: Array<{ startAt: string }> }
    expect(body.candidates).toHaveLength(2)
    expect(body.candidates[0]!.startAt < body.candidates[1]!.startAt).toBe(true)
  })

  it('T6: 締切後でも GET tally は 200', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    // DB に直接 deadline を過去に設定
    const db = (env as { DB: D1Database }).DB
    await db.prepare('UPDATE events SET deadline = ? WHERE id = ?').bind(1000, eventId).run()

    const res = await get(`/api/events/${eventId}/tally`)
    expect(res.status).toBe(200)
  })

  it('T-chunk: 候補 120 件のイベントでも /tally が 200 を返す（D1 bind 上限の回帰）', async () => {
    const N = 120
    const candidates = Array.from({ length: N }, (_, i) => {
      const dt = new Date('2030-01-01T10:00:00.000Z')
      dt.setUTCDate(dt.getUTCDate() + i)
      return {
        startAt: dt.toISOString(),
        endAt: new Date(dt.getTime() + 30 * 60 * 1000).toISOString(),
      }
    })

    const createRes = await post(
      '/api/events',
      {
        title: 'big-event',
        defaultDurationMinutes: 30,
        candidates,
      },
      { Cookie: organizerCookie },
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { event: { id: string } }

    const res = await get(`/api/events/${created.event.id}/tally`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { candidates: unknown[] }
    expect(body.candidates).toHaveLength(N)
  })
})
