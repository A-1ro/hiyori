import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { beforeEach, expect, inject, it } from 'vitest'
import { loginAs } from './test-helpers'

const BASE = 'https://example.com'
const OWNER = '42345678901234567'
const INVITED = '52345678901234567'
const OTHER = '62345678901234567'

async function request(path: string, method: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function createEvent(owner: string, visibility: 'public' | 'invite_only', startAt = '2026-11-01T10:00:00.000Z') {
  const response = await request('/api/events', 'POST', owner, {
    title: 'projection-privacy', visibility, defaultDurationMinutes: 60,
    ...(visibility === 'invite_only' ? { invitedDiscordUserIds: [INVITED] } : {}),
    candidates: [{ startAt }],
  })
  expect(response.status).toBe(201)
  return await response.json() as { event: { id: string }; candidates: Array<{ id: string }> }
}

beforeEach(async () => {
  await applyD1Migrations((env as { DB: D1Database }).DB, inject('d1Migrations'))
})

it('event, candidate, and decision writes conceal hidden private events while keeping visible nonowner 403', async () => {
  const owner = await loginAs(OWNER)
  const invited = await loginAs(INVITED)
  const other = await loginAs(OTHER)
  const privateEvent = await createEvent(owner, 'invite_only')
  const publicEvent = await createEvent(owner, 'public')
  const missingId = crypto.randomUUID()
  const candidateId = privateEvent.candidates[0]!.id
  const operations = [
    { suffix: '', method: 'PATCH', body: { title: 'should not change' } },
    { suffix: '', method: 'DELETE' },
    { suffix: '/candidates', method: 'POST', body: { startAt: '2026-12-01T10:00:00.000Z' } },
    { suffix: `/candidates/${candidateId}`, method: 'DELETE' },
    { suffix: '/decision', method: 'POST', body: { candidateIds: [candidateId] } },
    { suffix: '/decision', method: 'DELETE' },
  ]
  for (const { suffix, method, body } of operations) {
    const hidden = await request(`/api/events/${privateEvent.event.id}${suffix}`, method, other, body)
    const missing = await request(`/api/events/${missingId}${suffix}`, method, other, body)
    expect(hidden.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await hidden.json()).toEqual(await missing.json())
    expect((await request(`/api/events/${privateEvent.event.id}${suffix}`, method, invited, body)).status).toBe(403)
    expect((await request(`/api/events/${publicEvent.event.id}${suffix}`, method, other, body)).status).toBe(403)
  }
})

it('busy times recheck private ACL after revocation, including decisions changed afterward', async () => {
  const owner = await loginAs(OWNER)
  const invited = await loginAs(INVITED)
  const privateEvent = await createEvent(owner, 'invite_only')
  const publicStart = '2026-12-01T10:00:00.000Z'
  const publicEvent = await createEvent(owner, 'public', publicStart)
  for (const event of [privateEvent, publicEvent]) {
    expect((await request(`/api/events/${event.event.id}/participants`, 'POST', invited, { kind: 'discord', displayName: 'member' })).status).toBe(201)
    expect((await request(`/api/events/${event.event.id}/decision`, 'POST', owner, { candidateIds: [event.candidates[0]!.id] })).status).toBe(201)
  }
  const before = await request('/api/me/busy', 'GET', invited)
  expect((await before.json() as { startAts: string[] }).startAts).toContain('2026-11-01T10:00:00.000Z')
  expect((await request(`/api/events/${privateEvent.event.id}/invites/${INVITED}`, 'DELETE', owner)).status).toBe(204)
  const added = await request(`/api/events/${privateEvent.event.id}/candidates`, 'POST', owner, { startAt: '2026-11-02T10:00:00.000Z' })
  expect(added.status).toBe(201)
  const newCandidate = await added.json() as { candidate: { id: string } }
  expect((await request(`/api/events/${privateEvent.event.id}/decision`, 'POST', owner, { candidateIds: [newCandidate.candidate.id] })).status).toBe(201)
  const after = await request('/api/me/busy', 'GET', invited)
  expect(await after.json()).toEqual({ startAts: [publicStart] })
})
