import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs, loginAsBearer } from './test-helpers'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'
const ORGANIZER_ID = '12345678901234567'
const OTHER_ID = '98765432109876543'

async function jsonFetch(path: string, init?: RequestInit) {
  const { headers: extraHeaders, ...rest } = init ?? {}
  return SELF.fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders as Record<string, string> ?? {}) },
  })
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

async function createEventWithSession(sessionCookie: string): Promise<{ eventId: string; candidateId: string }> {
  const createRes = await post('/api/events', {
    title: 'テストイベント',
    defaultDurationMinutes: 60,
    candidates: [
      { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
    ],
  }, { Cookie: sessionCookie })
  const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
  return { eventId: created.event.id, candidateId: created.candidates[0]!.id }
}

beforeEach(async () => {
  await applyMigrations()
})

describe('POST /api/events — 認証ガード', () => {
  it('G1: Cookie なしで 401', async () => {
    const res = await post('/api/events', {
      title: 'テスト',
      defaultDurationMinutes: 60,
      candidates: [{ startAt: '2026-07-01T10:00:00.000Z' }],
    })
    expect(res.status).toBe(401)
  })

  it('G2: 有効なセッションで 201', async () => {
    const cookie = await loginAs(ORGANIZER_ID)
    const res = await post('/api/events', {
      title: 'テスト',
      defaultDurationMinutes: 60,
      candidates: [{ startAt: '2026-07-01T10:00:00.000Z' }],
    }, { Cookie: cookie })
    expect(res.status).toBe(201)
  })
})

describe('POST /api/events — 入力を始めた主催者との一致条件', () => {
  const body = {
    title: 'A の入力と招待',
    description: '架空の非公開メモ',
    visibility: 'invite_only',
    defaultDurationMinutes: 60,
    invitedDiscordUsernames: ['fictional_friend'],
    candidates: [{ startAt: '2026-07-01T10:00:00.000Z' }],
  }

  async function counts() {
    const counts: number[] = []
    for (const table of ['events', 'candidates', 'event_invites']) {
      const row = await (env as { DB: D1Database }).DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>()
      counts.push(row!.count)
    }
    return counts
  }

  it('A として処理された /me の返答を受け取る間に Cookie が B へ変わっても A の下書きを B の所有物として書き込まない', async () => {
    const cookieA = await loginAs(ORGANIZER_ID)
    const checkedAsA = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookieA } })
    // A の応答をまだクライアントで消費していない間に、別タブ相当で B に切り替える。
    const cookieB = await loginAs(OTHER_ID)
    const checked = await checkedAsA.json() as { user: { discordUserId: string } }
    const before = await counts()
    const res = await post('/api/events', {
      ...body, expectedOrganizerDiscordId: checked.user.discordUserId,
    }, { Cookie: cookieB })
    expect(res.status).toBe(412)
    expect(await res.json()).toEqual({ error: 'ログイン中のアカウントが変わりました。元の Discord アカウントでログインしてください。' })
    expect(await counts()).toEqual(before)
  })

  it('期待 ID だけを送っても認証できず、一切書き込まない', async () => {
    const before = await counts()
    const res = await post('/api/events', { ...body, expectedOrganizerDiscordId: ORGANIZER_ID })
    expect(res.status).toBe(401)
    expect(await counts()).toEqual(before)
  })

  it('既存 CLI 型 Bearer のリクエストは一致条件を省略しても互換性を維持する', async () => {
    const authorization = await loginAsBearer(OTHER_ID)
    const res = await post('/api/events', body, { Authorization: authorization })
    expect(res.status).toBe(201)
    const { event } = await res.json() as { event: { id: string } }
    const row = await (env as { DB: D1Database }).DB.prepare('SELECT organizerDiscordId FROM events WHERE id = ?').bind(event.id).first<{ organizerDiscordId: string }>()
    expect(row?.organizerDiscordId).toBe(OTHER_ID)
  })

  it.each(['invalid', '123', null])('不正な一致条件 %s は 400 で拒否し、書き込まない', async (expectedOrganizerDiscordId) => {
    const cookie = await loginAs(ORGANIZER_ID)
    const before = await counts()
    const res = await post('/api/events', { ...body, expectedOrganizerDiscordId }, { Cookie: cookie })
    expect(res.status).toBe(400)
    expect(await counts()).toEqual(before)
  })

  it('期待 ID がセッション本人と一致する場合だけ、その認証済み本人を主催者として作成する', async () => {
    const cookie = await loginAs(ORGANIZER_ID)
    const res = await post('/api/events', { ...body, expectedOrganizerDiscordId: ORGANIZER_ID }, { Cookie: cookie })
    expect(res.status).toBe(201)
    const { event } = await res.json() as { event: { id: string } }
    const row = await (env as { DB: D1Database }).DB.prepare('SELECT organizerDiscordId FROM events WHERE id = ?').bind(event.id).first<{ organizerDiscordId: string }>()
    expect(row?.organizerDiscordId).toBe(ORGANIZER_ID)
  })
})

describe('PATCH /api/events/:id — オーガナイザーガード', () => {
  it('G3: 他人のセッションで 403', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const otherCookie = await loginAs(OTHER_ID)

    const { eventId } = await createEventWithSession(organizerCookie)

    const res = await patch(`/api/events/${eventId}`, { title: '変更' }, { Cookie: otherCookie })
    expect(res.status).toBe(403)
  })

  it('G4: オーガナイザー本人なら 200', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const { eventId } = await createEventWithSession(organizerCookie)

    const res = await patch(`/api/events/${eventId}`, { title: '変更後' }, { Cookie: organizerCookie })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/events/:id — オーガナイザーガード', () => {
  it('G5: 他人のセッションで 403', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const otherCookie = await loginAs(OTHER_ID)
    const { eventId } = await createEventWithSession(organizerCookie)

    const res = await del(`/api/events/${eventId}`, { Cookie: otherCookie })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/subscriptions — 認証ガード', () => {
  it('G6: Cookie なしで 401', async () => {
    const res = await post('/api/subscriptions', {})
    expect(res.status).toBe(401)
  })

  it('G7: 有効なセッションで 201', async () => {
    const cookie = await loginAs(ORGANIZER_ID)
    const res = await post('/api/subscriptions', {}, { Cookie: cookie })
    expect(res.status).toBe(201)
  })
})

describe('POST /api/events/:id/decision — 認証ガード', () => {
  it('G8: Cookie なしで 401', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const { eventId, candidateId } = await createEventWithSession(organizerCookie)

    const res = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] })
    expect(res.status).toBe(401)
  })

  it('G9: 他人のセッションで 403', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const otherCookie = await loginAs(OTHER_ID)
    const { eventId, candidateId } = await createEventWithSession(organizerCookie)

    const res = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: otherCookie })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/events/:id/permissions', () => {
  it('G10: 未ログインで { isOrganizer: false }', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const { eventId } = await createEventWithSession(organizerCookie)

    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/permissions`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { isOrganizer: boolean }
    expect(body.isOrganizer).toBe(false)
  })

  it('G11: オーガナイザーセッションで { isOrganizer: true }', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const { eventId } = await createEventWithSession(organizerCookie)

    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/permissions`, {
      headers: { Cookie: organizerCookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { isOrganizer: boolean }
    expect(body.isOrganizer).toBe(true)
  })
})

describe('POST /api/events/:id/candidates — 認証・オーガナイザーガード', () => {
  it('G12: Cookie なしで 401', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const { eventId } = await createEventWithSession(organizerCookie)

    const res = await post(`/api/events/${eventId}/candidates`, {
      startAt: '2026-08-01T10:00:00.000Z',
    })
    expect(res.status).toBe(401)
  })

  it('G13: 他人のセッションで 403', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const otherCookie = await loginAs(OTHER_ID)
    const { eventId } = await createEventWithSession(organizerCookie)

    const res = await post(`/api/events/${eventId}/candidates`, {
      startAt: '2026-08-01T10:00:00.000Z',
    }, { Cookie: otherCookie })
    expect(res.status).toBe(403)
  })

  it('G14: オーガナイザーで POST → 201', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const { eventId } = await createEventWithSession(organizerCookie)

    const res = await post(`/api/events/${eventId}/candidates`, {
      startAt: '2026-08-01T10:00:00.000Z',
      endAt: '2026-08-01T11:00:00.000Z',
    }, { Cookie: organizerCookie })
    expect(res.status).toBe(201)
  })
})

describe('DELETE /api/events/:id/candidates/:candidateId — 認証・オーガナイザーガード', () => {
  it('G15: Cookie なしで 401', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const { eventId, candidateId } = await createEventWithSession(organizerCookie)

    const res = await del(`/api/events/${eventId}/candidates/${candidateId}`)
    expect(res.status).toBe(401)
  })

  it('G16: 他人のセッションで 403', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const otherCookie = await loginAs(OTHER_ID)
    const { eventId, candidateId } = await createEventWithSession(organizerCookie)

    const res = await del(`/api/events/${eventId}/candidates/${candidateId}`, { Cookie: otherCookie })
    expect(res.status).toBe(403)
  })

  it('G17: オーガナイザーで DELETE → 204', async () => {
    const organizerCookie = await loginAs(ORGANIZER_ID)
    const { eventId, candidateId } = await createEventWithSession(organizerCookie)

    const res = await del(`/api/events/${eventId}/candidates/${candidateId}`, { Cookie: organizerCookie })
    expect(res.status).toBe(204)
  })
})
