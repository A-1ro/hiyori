import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs } from './test-helpers'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  })
  return res
}

async function del(path: string, headers?: Record<string, string>) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  })
  return res
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

async function createEventAndDecide() {
  const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
  const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
  const eventId = created.event.id
  const candidateId = created.candidates[0]!.id

  // DB に直接 participant を挿入（Discord 参加者）
  const db = (env as { DB: D1Database }).DB
  await db.prepare(
    `INSERT INTO participants (id, eventId, kind, discordUserId, displayName, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), eventId, 'discord', ORGANIZER_ID, 'Owner', Date.now()).run()

  await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })

  return { eventId, candidateId }
}

describe('Webcal feed', () => {
  beforeEach(async () => {
    await applyMigrations()
    organizerCookie = await loginAs(ORGANIZER_ID)
  })

  it('W1: POST /api/subscriptions → 201 + webcalUrl + token 漏洩なし', async () => {
    const res = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.webcalUrl).toMatch(/^webcal:\/\/.*\/feeds\/[0-9a-f]{64}\.ics$/)
    expect(JSON.stringify(body)).not.toContain('"token"')
  })

  it('W2: GET /feeds/:token.ics 確定無し → 200 + 空 VCALENDAR', async () => {
    const subRes = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    const subBody = (await subRes.json()) as { webcalUrl: string }
    const webcalUrl = subBody.webcalUrl
    // webcal:// → http:// に変換してフェッチ
    const httpUrl = webcalUrl.replace('webcal://', 'http://')

    const res = await SELF.fetch(httpUrl)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).toContain('END:VCALENDAR')
    expect(text).not.toContain('BEGIN:VEVENT')
  })

  it('W3: GET 確定あり → 200 + VEVENT + ETag/Cache-Control', async () => {
    await createEventAndDecide()

    const subRes = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    const subBody = (await subRes.json()) as { webcalUrl: string }
    const httpUrl = subBody.webcalUrl.replace('webcal://', 'http://')

    const res = await SELF.fetch(httpUrl)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('ETag')).toBeTruthy()
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300')

    const text = await res.text()
    expect(text).toContain('BEGIN:VEVENT')
    expect(text).toContain('STATUS:CONFIRMED')
  })

  it('W4: If-None-Match → 304', async () => {
    await createEventAndDecide()

    const subRes = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    const subBody = (await subRes.json()) as { webcalUrl: string }
    const httpUrl = subBody.webcalUrl.replace('webcal://', 'http://')

    const res1 = await SELF.fetch(httpUrl)
    expect(res1.status).toBe(200)
    const etag = res1.headers.get('ETag')
    expect(etag).toBeTruthy()

    const res2 = await SELF.fetch(httpUrl, {
      headers: { 'If-None-Match': etag! },
    })
    expect(res2.status).toBe(304)
    const body2 = await res2.text()
    expect(body2).toBe('')
  })

  it('W5: 不正 token → 404', async () => {
    const res1 = await SELF.fetch(`${BASE}/feeds/invalid.ics`)
    expect(res1.status).toBe(404)

    const fakeToken = 'a'.repeat(64)
    const res2 = await SELF.fetch(`${BASE}/feeds/${fakeToken}.ics`)
    expect(res2.status).toBe(404)
  })

  it('W6: DELETE owner 不一致 → 404、一致 → 204 → token 失効', async () => {
    const subRes = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    const subBody = (await subRes.json()) as { subscription: { id: string }; webcalUrl: string }
    const subId = subBody.subscription.id
    const httpUrl = subBody.webcalUrl.replace('webcal://', 'http://')

    // 他人で DELETE → 404
    const otherCookie = await loginAs('98765432109876543')
    const delRes1 = await del(`/api/subscriptions/${subId}`, { Cookie: otherCookie })
    expect(delRes1.status).toBe(404)

    // owner で DELETE → 204
    const delRes2 = await del(`/api/subscriptions/${subId}`, { Cookie: organizerCookie })
    expect(delRes2.status).toBe(204)

    // 削除後 GET → 404
    const feedRes = await SELF.fetch(httpUrl)
    expect(feedRes.status).toBe(404)
  })

  it('W8: 同じユーザーの POST × 2 → 1 件のみ・2 回目は 200 で同一 id', async () => {
    const res1 = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    expect(res1.status).toBe(201)
    const body1 = (await res1.json()) as { subscription: { id: string }; webcalUrl: string }

    const res2 = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as { subscription: { id: string }; webcalUrl: string }

    expect(body2.subscription.id).toBe(body1.subscription.id)
    expect(body2.webcalUrl).toBe(body1.webcalUrl)

    // DB 上も 1 件のみ
    const db = (env as { DB: D1Database }).DB
    const rows = await db.prepare(
      `SELECT id FROM calendar_subscriptions WHERE ownerDiscordId = ?`
    ).bind(ORGANIZER_ID).all<{ id: string }>()
    expect(rows.results.length).toBe(1)
  })

  it('W9: 直接挿入で 2 件あっても POST/GET は最古 1 件に整理する', async () => {
    const db = (env as { DB: D1Database }).DB
    const now = Date.now()
    const idOld = crypto.randomUUID()
    const idNew = crypto.randomUUID()
    await db.prepare(
      `INSERT INTO calendar_subscriptions (id, ownerDiscordId, token, scope, createdAt) VALUES (?, ?, ?, ?, ?)`
    ).bind(idOld, ORGANIZER_ID, 'a'.repeat(64), 'user-all', now - 1000).run()
    await db.prepare(
      `INSERT INTO calendar_subscriptions (id, ownerDiscordId, token, scope, createdAt) VALUES (?, ?, ?, ?, ?)`
    ).bind(idNew, ORGANIZER_ID, 'b'.repeat(64), 'user-all', now).run()

    const res = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { subscription: { id: string } }
    expect(body.subscription.id).toBe(idOld)

    const rows = await db.prepare(
      `SELECT id FROM calendar_subscriptions WHERE ownerDiscordId = ?`
    ).bind(ORGANIZER_ID).all<{ id: string }>()
    expect(rows.results.length).toBe(1)
    expect(rows.results[0]!.id).toBe(idOld)
  })

  it('W7: regenerate → 旧 token 失効 + 新 token で 200', async () => {
    const subRes = await post('/api/subscriptions', {}, { Cookie: organizerCookie })
    const subBody = (await subRes.json()) as { subscription: { id: string }; webcalUrl: string }
    const subId = subBody.subscription.id
    const oldHttpUrl = subBody.webcalUrl.replace('webcal://', 'http://')

    const regenRes = await post(`/api/subscriptions/${subId}/regenerate`, {}, { Cookie: organizerCookie })
    expect(regenRes.status).toBe(200)
    const regenBody = (await regenRes.json()) as { webcalUrl: string }
    const newHttpUrl = regenBody.webcalUrl.replace('webcal://', 'http://')

    // 旧 token で GET → 404
    const oldRes = await SELF.fetch(oldHttpUrl)
    expect(oldRes.status).toBe(404)

    // 新 token で GET → 200
    const newRes = await SELF.fetch(newHttpUrl)
    expect(newRes.status).toBe(200)
  })
})
