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
    headers: {
      'Content-Type': 'application/json',
      ...((extraHeaders as Record<string, string>) ?? {}),
    },
  })
  return res
}

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  return jsonFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
    ...(headers ? { headers } : {}),
  })
}
async function del(path: string, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'DELETE', ...(headers ? { headers } : {}) })
}
async function get(path: string, headers?: Record<string, string>) {
  return jsonFetch(path, { method: 'GET', ...(headers ? { headers } : {}) })
}

const ORG1 = '31111111111111111'
const ME = '32222222222222222'

let org1Cookie: string
let myCookie: string

beforeEach(async () => {
  await applyMigrations()
  org1Cookie = await loginAs(ORG1)
  myCookie = await loginAs(ME)
})

function mkEvent(title: string, startAt: string) {
  return {
    title,
    defaultDurationMinutes: 60,
    candidates: [
      {
        startAt,
        endAt: new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString(),
      },
    ],
  }
}

describe('GET /api/me/busy', () => {
  it('B1: 未認証 → 401', async () => {
    const res = await get('/api/me/busy')
    expect(res.status).toBe(401)
  })

  it('B2: 他イベントで自分が participant + organizer が decide → startAts に含まれる', async () => {
    const startAt = '2027-08-01T10:00:00.000Z'
    const createRes = await post('/api/events', mkEvent('B2-ev', startAt), {
      Cookie: org1Cookie,
    })
    const created = (await createRes.json()) as {
      event: { id: string }
      candidates: Array<{ id: string }>
    }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    await post(
      `/api/events/${eventId}/participants`,
      { kind: 'discord', displayName: 'me' },
      { Cookie: myCookie },
    )
    const decRes = await post(
      `/api/events/${eventId}/decision`,
      { candidateIds: [candidateId] },
      { Cookie: org1Cookie },
    )
    expect(decRes.status).toBe(201)

    const busyRes = await get('/api/me/busy', { Cookie: myCookie })
    expect(busyRes.status).toBe(200)
    const body = (await busyRes.json()) as { startAts: string[] }
    expect(body.startAts).toContain(startAt)
  })

  it('B3: decision を cancel した枠は busy に含まれない', async () => {
    const startAt = '2027-08-10T10:00:00.000Z'
    const createRes = await post('/api/events', mkEvent('B3-ev', startAt), {
      Cookie: org1Cookie,
    })
    const created = (await createRes.json()) as {
      event: { id: string }
      candidates: Array<{ id: string }>
    }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    await post(
      `/api/events/${eventId}/participants`,
      { kind: 'discord', displayName: 'me' },
      { Cookie: myCookie },
    )
    await post(
      `/api/events/${eventId}/decision`,
      { candidateIds: [candidateId] },
      { Cookie: org1Cookie },
    )
    const delRes = await del(`/api/events/${eventId}/decision`, { Cookie: org1Cookie })
    expect(delRes.status).toBe(200)

    const busyRes = await get('/api/me/busy', { Cookie: myCookie })
    const body = (await busyRes.json()) as { startAts: string[] }
    expect(body.startAts).not.toContain(startAt)
  })

  it('B4: excludeEventId で指定したイベントの decisions は除外', async () => {
    const startAtKeep = '2027-08-20T10:00:00.000Z'
    const startAtExclude = '2027-09-20T10:00:00.000Z'
    const create1 = await post('/api/events', mkEvent('B4-keep', startAtKeep), {
      Cookie: org1Cookie,
    })
    const c1 = (await create1.json()) as {
      event: { id: string }
      candidates: Array<{ id: string }>
    }
    const create2 = await post('/api/events', mkEvent('B4-excl', startAtExclude), {
      Cookie: org1Cookie,
    })
    const c2 = (await create2.json()) as {
      event: { id: string }
      candidates: Array<{ id: string }>
    }

    for (const id of [c1.event.id, c2.event.id]) {
      await post(
        `/api/events/${id}/participants`,
        { kind: 'discord', displayName: 'me' },
        { Cookie: myCookie },
      )
    }
    await post(
      `/api/events/${c1.event.id}/decision`,
      { candidateIds: [c1.candidates[0]!.id] },
      { Cookie: org1Cookie },
    )
    await post(
      `/api/events/${c2.event.id}/decision`,
      { candidateIds: [c2.candidates[0]!.id] },
      { Cookie: org1Cookie },
    )

    const res = await get(`/api/me/busy?excludeEventId=${c2.event.id}`, { Cookie: myCookie })
    const body = (await res.json()) as { startAts: string[] }
    expect(body.startAts).toContain(startAtKeep)
    expect(body.startAts).not.toContain(startAtExclude)
  })

  it('B5: 自分が participant でないイベントの確定は busy に含まれない', async () => {
    const startAt = '2027-10-30T10:00:00.000Z'
    const createRes = await post('/api/events', mkEvent('B5-ev', startAt), {
      Cookie: org1Cookie,
    })
    const created = (await createRes.json()) as {
      event: { id: string }
      candidates: Array<{ id: string }>
    }
    await post(
      `/api/events/${created.event.id}/decision`,
      { candidateIds: [created.candidates[0]!.id] },
      { Cookie: org1Cookie },
    )

    const res = await get('/api/me/busy', { Cookie: myCookie })
    const body = (await res.json()) as { startAts: string[] }
    expect(body.startAts).not.toContain(startAt)
  })
})
