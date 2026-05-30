import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'

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

const validEventBase = {
  organizerDiscordId: '12345678901234567',
  title: 'テストイベント',
  defaultDurationMinutes: 60,
  candidates: [
    { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
    { startAt: '2026-07-02T10:00:00.000Z', endAt: '2026-07-02T11:00:00.000Z' },
  ],
}

beforeEach(async () => {
  await applyMigrations()
})

describe('POST /api/events/:id/participants', () => {
  it('1: ゲスト新規登録 → 201 + Set-Cookie + guestTokenHash がレスポンスに含まれない', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    const res = await post(`/api/events/${eventId}/participants`, {
      kind: 'guest',
      displayName: 'テストゲスト',
    })
    expect(res.status).toBe(201)
    const setCookie = extractSetCookie(res)
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain(`hiyori_guest_${eventId}`)

    const body = (await res.json()) as { participant: Record<string, unknown> }
    expect(body.participant).toBeTruthy()
    expect(body.participant.displayName).toBe('テストゲスト')
    const bodyStr = JSON.stringify(body)
    expect(bodyStr).not.toContain('guestTokenHash')

    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\//i)
  })

  it('2: ゲスト再訪（Cookie 同梱） → 200 + 同じ participant.id', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    const firstRes = await post(`/api/events/${eventId}/participants`, {
      kind: 'guest',
      displayName: 'ゲスト',
    })
    expect(firstRes.status).toBe(201)
    const firstBody = (await firstRes.json()) as { participant: { id: string } }
    const firstId = firstBody.participant.id

    const setCookie = extractSetCookie(firstRes)!
    const cookieHeader = cookieHeaderFromSetCookie(setCookie)

    const secondRes = await post(
      `/api/events/${eventId}/participants`,
      { kind: 'guest', displayName: 'ゲスト' },
      { Cookie: cookieHeader },
    )
    expect(secondRes.status).toBe(200)
    const secondBody = (await secondRes.json()) as { participant: { id: string } }
    expect(secondBody.participant.id).toBe(firstId)
  })

  it('3: POST discord は 501 を返す', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    const res = await post(`/api/events/${eventId}/participants`, {
      kind: 'discord',
      displayName: 'DiscordUser',
      discordUserId: '11111111111111111',
    })
    expect(res.status).toBe(501)
  })

  it('4: POST discord は discordUserId が異なっても 501 を返す', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    const res = await post(`/api/events/${eventId}/participants`, {
      kind: 'discord',
      displayName: 'User2',
      discordUserId: '22222222222222222',
    })
    expect(res.status).toBe(501)
  })
})

describe('PUT /api/events/:id/votes', () => {
  it('5: Cookie なし → 401', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const res = await put(`/api/events/${eventId}/votes`, {
      votes: [{ candidateId, choice: 'yes' }],
    })
    expect(res.status).toBe(401)
  })

  it('6: ゲスト Cookie あり → 200 + votes 1 件', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const regRes = await post(`/api/events/${eventId}/participants`, {
      kind: 'guest',
      displayName: 'Voter',
    })
    const setCookie = extractSetCookie(regRes)!
    const cookieHeader = cookieHeaderFromSetCookie(setCookie)

    const voteRes = await put(
      `/api/events/${eventId}/votes`,
      { votes: [{ candidateId, choice: 'yes' }] },
      { Cookie: cookieHeader },
    )
    expect(voteRes.status).toBe(200)
    const voteBody = (await voteRes.json()) as { votes: Array<{ candidateId: string; choice: string }> }
    expect(voteBody.votes).toHaveLength(1)
    expect(voteBody.votes[0]!.candidateId).toBe(candidateId)
    expect(voteBody.votes[0]!.choice).toBe('yes')
    expect(JSON.stringify(voteBody)).not.toContain('guestTokenHash')
  })

  it('7: 2 回目投票（choice 変更）→ upsert で 1 件のまま、updatedAt が変化', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const regRes = await post(`/api/events/${eventId}/participants`, {
      kind: 'guest',
      displayName: 'Voter',
    })
    const setCookie = extractSetCookie(regRes)!
    const cookieHeader = cookieHeaderFromSetCookie(setCookie)

    const firstVoteRes = await put(
      `/api/events/${eventId}/votes`,
      { votes: [{ candidateId, choice: 'yes' }] },
      { Cookie: cookieHeader },
    )
    const firstBody = (await firstVoteRes.json()) as { votes: Array<{ updatedAt: string }> }
    const firstUpdatedAt = firstBody.votes[0]!.updatedAt

    // 少し待ってから 2 回目投票
    await new Promise((r) => setTimeout(r, 10))

    const secondVoteRes = await put(
      `/api/events/${eventId}/votes`,
      { votes: [{ candidateId, choice: 'no' }] },
      { Cookie: cookieHeader },
    )
    expect(secondVoteRes.status).toBe(200)
    const secondBody = (await secondVoteRes.json()) as { votes: Array<{ candidateId: string; choice: string; updatedAt: string }> }
    expect(secondBody.votes).toHaveLength(1)
    expect(secondBody.votes[0]!.choice).toBe('no')
    expect(secondBody.votes[0]!.updatedAt).not.toBe(firstUpdatedAt)
  })

  it('8: 締切過去のイベント → 403', async () => {
    // 最初は deadline なしでイベント作成 → ゲスト登録 → Cookie 取得
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const regRes = await post(`/api/events/${eventId}/participants`, {
      kind: 'guest',
      displayName: 'Voter',
    })
    expect(regRes.status).toBe(201)
    const setCookie = extractSetCookie(regRes)!
    const cookieHeader = cookieHeaderFromSetCookie(setCookie)

    // DB に直接 deadline を過去に設定
    const db = (env as { DB: D1Database }).DB
    await db.prepare('UPDATE events SET deadline = ? WHERE id = ?').bind(1000, eventId).run()

    const voteRes = await put(
      `/api/events/${eventId}/votes`,
      { votes: [{ candidateId, choice: 'yes' }] },
      { Cookie: cookieHeader },
    )
    expect(voteRes.status).toBe(403)
  })

  it('9: 他イベントの candidateId → 400', async () => {
    const createRes1 = await post('/api/events', validEventBase)
    const created1 = (await createRes1.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId1 = created1.event.id

    const createRes2 = await post('/api/events', validEventBase)
    const created2 = (await createRes2.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const otherCandidateId = created2.candidates[0]!.id

    const regRes = await post(`/api/events/${eventId1}/participants`, {
      kind: 'guest',
      displayName: 'Voter',
    })
    const setCookie = extractSetCookie(regRes)!
    const cookieHeader = cookieHeaderFromSetCookie(setCookie)

    const voteRes = await put(
      `/api/events/${eventId1}/votes`,
      { votes: [{ candidateId: otherCandidateId, choice: 'yes' }] },
      { Cookie: cookieHeader },
    )
    expect(voteRes.status).toBe(400)
  })
})

describe('GET /api/events/:id/votes/me', () => {
  it('10: 未登録 → 200 + participant null + votes 空', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    const res = await get(`/api/events/${eventId}/votes/me`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { participant: unknown; votes: unknown[] }
    expect(body.participant).toBeNull()
    expect(body.votes).toEqual([])
  })

  it('11: 投票後 → 200 + participant + votes', async () => {
    const createRes = await post('/api/events', validEventBase)
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    const regRes = await post(`/api/events/${eventId}/participants`, {
      kind: 'guest',
      displayName: 'Voter',
    })
    const setCookie = extractSetCookie(regRes)!
    const cookieHeader = cookieHeaderFromSetCookie(setCookie)

    await put(
      `/api/events/${eventId}/votes`,
      { votes: [{ candidateId, choice: 'maybe', comment: 'できるかも' }] },
      { Cookie: cookieHeader },
    )

    const meRes = await get(`/api/events/${eventId}/votes/me`, { Cookie: cookieHeader })
    expect(meRes.status).toBe(200)
    const meBody = (await meRes.json()) as { participant: { displayName: string }; votes: Array<{ choice: string; comment?: string }> }
    expect(meBody.participant).not.toBeNull()
    expect(meBody.participant.displayName).toBe('Voter')
    expect(meBody.votes).toHaveLength(1)
    expect(meBody.votes[0]!.choice).toBe('maybe')
    expect(meBody.votes[0]!.comment).toBe('できるかも')
    expect(JSON.stringify(meBody)).not.toContain('guestTokenHash')
  })
})
