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
