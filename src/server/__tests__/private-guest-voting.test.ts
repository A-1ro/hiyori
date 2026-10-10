import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { beforeEach, describe, expect, inject, it } from 'vitest'
import { loginAs, loginAsBearer } from './test-helpers'

const BASE = 'https://example.com'
const ORGANIZER_ID = '12345678901234567'
const INVITED_ID = '23456789012345678'

type AuthKind = 'cookie' | 'bearer'
type Choice = 'yes' | 'maybe' | 'no'
type Participant = {
  id: string
  kind: 'guest' | 'discord'
  displayName: string
}
type Vote = {
  candidateId: string
  participantId: string
  choice: Choice
  comment: string | null
}
type VotesResponse = { votes: Vote[] }
type MyVotesResponse = VotesResponse & { participant: Participant | null }
type Fixture = {
  path: string
  candidateId: string
  guestId: string
  guestHeaders: Record<string, string>
  organizerHeaders: Record<string, string>
  sessionHeaders: Record<string, string>
  bothHeaders: Record<string, string>
}

async function request(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function voteBody(candidateId: string, choice: Choice, comment: string) {
  return { votes: [{ candidateId, choice, comment }] }
}

async function createPublicGuestFixture(authKind: AuthKind = 'cookie'): Promise<Fixture> {
  const organizerHeaders = { Cookie: await loginAs(ORGANIZER_ID) }
  const sessionHeaders: Record<string, string> = authKind === 'cookie'
    ? { Cookie: await loginAs(INVITED_ID) }
    : { Authorization: await loginAsBearer(INVITED_ID) }
  const created = await request('/api/events', 'POST', organizerHeaders, {
    title: 'Guest identity after making an event private',
    visibility: 'public',
    defaultDurationMinutes: 60,
    candidates: [{ startAt: '2026-11-01T10:00:00.000Z' }],
  })
  expect(created.status).toBe(201)
  const { event, candidates } = await created.json() as {
    event: { id: string }
    candidates: Array<{ id: string }>
  }
  const path = `/api/events/${event.id}`
  const candidateId = candidates[0]!.id
  const registered = await request(`${path}/participants`, 'POST', {}, {
    kind: 'guest', displayName: 'Existing guest',
  })
  expect(registered.status).toBe(201)
  const { participant } = await registered.json() as { participant: Participant }
  expect(participant.kind).toBe('guest')
  const setCookie = registered.headers.get('set-cookie')
  expect(setCookie).not.toBeNull()
  const guestCookie = setCookie!.split(';')[0]!
  expect(guestCookie).toMatch(new RegExp(`^hiyori_guest_${event.id}=`))
  const guestHeaders = { Cookie: guestCookie }
  const initialVote = await request(`${path}/votes`, 'PUT', guestHeaders,
    voteBody(candidateId, 'yes', 'Original guest answer'))
  expect(initialVote.status).toBe(200)
  const initialBody = await initialVote.json() as VotesResponse
  expect(initialBody.votes).toEqual([expect.objectContaining({ participantId: participant.id, choice: 'yes' })])

  return {
    path,
    candidateId,
    guestId: participant.id,
    guestHeaders,
    organizerHeaders,
    sessionHeaders,
    bothHeaders: {
      ...sessionHeaders,
      Cookie: [sessionHeaders.Cookie, guestCookie].filter(Boolean).join('; '),
    },
  }
}

async function makeInviteOnly(fixture: Fixture) {
  // Keep the public-to-private transition and numeric invite compatibility on
  // the real API path, including an already registered and voting guest.
  const invite = await request(`${fixture.path}/invites`, 'POST', fixture.organizerHeaders, {
    discordUserId: INVITED_ID,
  })
  expect(invite.status).toBe(201)
  const updated = await request(fixture.path, 'PATCH', fixture.organizerHeaders, { visibility: 'invite_only' })
  expect(updated.status).toBe(200)
}

async function registerDiscord(fixture: Fixture): Promise<string> {
  const registered = await request(`${fixture.path}/participants`, 'POST', fixture.bothHeaders, {
    kind: 'discord', displayName: 'Invited Discord member',
  })
  expect(registered.status).toBe(201)
  const { participant } = await registered.json() as { participant: Participant }
  expect(participant.kind).toBe('discord')
  expect(participant.id).not.toBe(fixture.guestId)
  const stored = await (env as { DB: D1Database }).DB.prepare(
    'SELECT discordUserId FROM participants WHERE id = ?',
  ).bind(participant.id).first<{ discordUserId: string }>()
  expect(stored?.discordUserId).toBe(INVITED_ID)
  return participant.id
}

async function storedVotes(participantId: string): Promise<Vote[]> {
  const result = await (env as { DB: D1Database }).DB.prepare(
    'SELECT candidateId, participantId, choice, comment FROM votes WHERE participantId = ?',
  ).bind(participantId).all<Vote>()
  return result.results
}

function expectedVote(fixture: Fixture, participantId: string, choice: Choice, comment: string): Vote {
  return { candidateId: fixture.candidateId, participantId, choice, comment }
}

beforeEach(async () => {
  await applyD1Migrations((env as { DB: D1Database }).DB, inject('d1Migrations'))
})

describe('guest voting after a public event becomes invite-only', () => {
  it('conceals both vote endpoints from the old guest cookie without a session', async () => {
    const fixture = await createPublicGuestFixture()
    await makeInviteOnly(fixture)

    const read = await request(`${fixture.path}/votes/me`, 'GET', fixture.guestHeaders)
    expect(read.status).toBe(404)
    expect(await read.json()).toEqual({ error: 'Not Found' })
    const write = await request(`${fixture.path}/votes`, 'PUT', fixture.guestHeaders,
      voteBody(fixture.candidateId, 'no', 'Must not be stored'))
    expect(write.status).toBe(404)
    expect(await write.json()).toEqual({ error: 'Not Found' })
    expect(await storedVotes(fixture.guestId)).toEqual([
      expectedVote(fixture, fixture.guestId, 'yes', 'Original guest answer'),
    ])
  })

  describe.each<AuthKind>(['cookie', 'bearer'])('%s session with an old guest cookie', (authKind) => {
    it('reads and updates only the authorized Discord participant, preserving the old guest vote', async () => {
      const fixture = await createPublicGuestFixture(authKind)
      await makeInviteOnly(fixture)
      const discordId = await registerDiscord(fixture)
      const seeded = await request(`${fixture.path}/votes`, 'PUT', fixture.sessionHeaders,
        voteBody(fixture.candidateId, 'no', 'Initial Discord answer'))
      expect(seeded.status).toBe(200)

      const read = await request(`${fixture.path}/votes/me`, 'GET', fixture.bothHeaders)
      expect(read.status).toBe(200)
      const readBody = await read.json() as MyVotesResponse
      expect(readBody.participant).toMatchObject({ id: discordId, kind: 'discord' })
      expect(readBody.votes).toEqual([
        expect.objectContaining(expectedVote(fixture, discordId, 'no', 'Initial Discord answer')),
      ])

      const write = await request(`${fixture.path}/votes`, 'PUT', fixture.bothHeaders,
        voteBody(fixture.candidateId, 'maybe', 'Updated Discord answer'))
      expect(write.status).toBe(200)
      const writeBody = await write.json() as VotesResponse
      expect(writeBody.votes).toEqual([
        expect.objectContaining(expectedVote(fixture, discordId, 'maybe', 'Updated Discord answer')),
      ])
      const updated = await request(`${fixture.path}/votes/me`, 'GET', fixture.bothHeaders)
      expect(updated.status).toBe(200)
      const updatedBody = await updated.json() as MyVotesResponse
      expect(updatedBody.participant).toMatchObject({ id: discordId, kind: 'discord' })
      expect(updatedBody.votes).toEqual(writeBody.votes)
      expect(await storedVotes(discordId)).toEqual([
        expectedVote(fixture, discordId, 'maybe', 'Updated Discord answer'),
      ])
      expect(await storedVotes(fixture.guestId)).toEqual([
        expectedVote(fixture, fixture.guestId, 'yes', 'Original guest answer'),
      ])
    })

    it('never falls back to the guest participant when the invitee has not registered as Discord', async () => {
      const fixture = await createPublicGuestFixture(authKind)
      await makeInviteOnly(fixture)

      const read = await request(`${fixture.path}/votes/me`, 'GET', fixture.bothHeaders)
      expect(read.status).toBe(200)
      expect(await read.json()).toEqual({ participant: null, votes: [] })
      const write = await request(`${fixture.path}/votes`, 'PUT', fixture.bothHeaders,
        voteBody(fixture.candidateId, 'no', 'Must not overwrite the guest'))
      expect(write.status).toBe(401)
      expect(await write.json()).toEqual({ error: 'Unauthorized' })
      expect(await storedVotes(fixture.guestId)).toEqual([
        expectedVote(fixture, fixture.guestId, 'yes', 'Original guest answer'),
      ])
    })

    it('conceals both vote endpoints after the Discord invitation is revoked', async () => {
      const fixture = await createPublicGuestFixture(authKind)
      await makeInviteOnly(fixture)
      const discordId = await registerDiscord(fixture)
      const seeded = await request(`${fixture.path}/votes`, 'PUT', fixture.sessionHeaders,
        voteBody(fixture.candidateId, 'no', 'Original Discord answer'))
      expect(seeded.status).toBe(200)
      const revoked = await request(`${fixture.path}/invites/${INVITED_ID}`, 'DELETE', fixture.organizerHeaders)
      expect(revoked.status).toBe(204)

      const read = await request(`${fixture.path}/votes/me`, 'GET', fixture.bothHeaders)
      expect(read.status).toBe(404)
      expect(await read.json()).toEqual({ error: 'Not Found' })
      const write = await request(`${fixture.path}/votes`, 'PUT', fixture.bothHeaders,
        voteBody(fixture.candidateId, 'maybe', 'Must not be stored'))
      expect(write.status).toBe(404)
      expect(await write.json()).toEqual({ error: 'Not Found' })
      expect(await storedVotes(discordId)).toEqual([
        expectedVote(fixture, discordId, 'no', 'Original Discord answer'),
      ])
      expect(await storedVotes(fixture.guestId)).toEqual([
        expectedVote(fixture, fixture.guestId, 'yes', 'Original guest answer'),
      ])
    })

    it('preserves public guest precedence and session-only Discord voting', async () => {
      const fixture = await createPublicGuestFixture(authKind)
      const discordId = await registerDiscord(fixture)
      const discordWrite = await request(`${fixture.path}/votes`, 'PUT', fixture.sessionHeaders,
        voteBody(fixture.candidateId, 'no', 'Public Discord answer'))
      expect(discordWrite.status).toBe(200)
      expect((await discordWrite.json() as VotesResponse).votes).toEqual([
        expect.objectContaining(expectedVote(fixture, discordId, 'no', 'Public Discord answer')),
      ])

      const guestRead = await request(`${fixture.path}/votes/me`, 'GET', fixture.bothHeaders)
      expect(guestRead.status).toBe(200)
      const guestBody = await guestRead.json() as MyVotesResponse
      expect(guestBody.participant).toMatchObject({ id: fixture.guestId, kind: 'guest' })
      expect(guestBody.votes).toEqual([
        expect.objectContaining(expectedVote(fixture, fixture.guestId, 'yes', 'Original guest answer')),
      ])
      const guestWrite = await request(`${fixture.path}/votes`, 'PUT', fixture.bothHeaders,
        voteBody(fixture.candidateId, 'maybe', 'Updated public guest answer'))
      expect(guestWrite.status).toBe(200)
      expect((await guestWrite.json() as VotesResponse).votes).toEqual([
        expect.objectContaining(expectedVote(fixture, fixture.guestId, 'maybe', 'Updated public guest answer')),
      ])

      const discordRead = await request(`${fixture.path}/votes/me`, 'GET', fixture.sessionHeaders)
      expect(discordRead.status).toBe(200)
      const discordBody = await discordRead.json() as MyVotesResponse
      expect(discordBody.participant).toMatchObject({ id: discordId, kind: 'discord' })
      expect(discordBody.votes).toEqual([
        expect.objectContaining(expectedVote(fixture, discordId, 'no', 'Public Discord answer')),
      ])
      expect(await storedVotes(fixture.guestId)).toEqual([
        expectedVote(fixture, fixture.guestId, 'maybe', 'Updated public guest answer'),
      ])
      expect(await storedVotes(discordId)).toEqual([
        expectedVote(fixture, discordId, 'no', 'Public Discord answer'),
      ])
    })
  })
})
