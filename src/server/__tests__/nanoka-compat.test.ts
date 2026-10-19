import { describe, expect, it } from 'vitest'
import { defineModel } from '@nanokajs/core'
import { participantFields, participantTableName } from '../../models/participant'
import { sessionFields, sessionTableName } from '../../models/session'
import { calendarSubscriptionFields, calendarSubscriptionTableName } from '../../models/calendarSubscription'

// Keep the model boundary contract explicit when upgrading nanoka: persisted
// secrets never enter public input/output, and response validation stays strict.
const Participant = defineModel(participantTableName, participantFields)
const Session = defineModel(sessionTableName, sessionFields)
const Subscription = defineModel(calendarSubscriptionTableName, calendarSubscriptionFields)
const now = new Date('2026-10-01T00:00:00.000Z')
const id = '00000000-0000-4000-8000-000000000001'
const participant = {
  id,
  eventId: id,
  kind: 'guest',
  displayName: 'Guest',
  guestTokenHash: 'private-guest-hash',
  discordUserId: 'private-discord-id',
  createdAt: now,
}

describe('nanoka model compatibility', () => {
  it('strips participant secrets from single and batch responses without changing dates', () => {
    const expected = { id, eventId: id, kind: 'guest', displayName: 'Guest', createdAt: now }
    expect(Participant.toResponse(participant)).toEqual(expected)
    expect(Participant.toResponseMany([participant])).toEqual([expected])
  })

  it('strips session and calendar subscription token hashes from responses', () => {
    const session = Session.toResponse({
      id, userId: id, tokenHash: 'private-session-hash',
      createdAt: now, lastUsedAt: now, expiresAt: now, kind: 'web',
    })
    const subscription = Subscription.toResponse({
      id, ownerDiscordId: '123', tokenHash: 'private-calendar-hash',
      scope: 'user-all', createdAt: now, lastAccessedAt: undefined,
    })
    expect(session).not.toHaveProperty('tokenHash')
    expect(subscription).not.toHaveProperty('tokenHash')
    expect(session).toHaveProperty('expiresAt', now)
    expect(subscription).toHaveProperty('scope', 'user-all')
  })

  it('does not accept server-only or read-only participant fields from public input', () => {
    const input = Participant.inputSchema('create').parse(participant)
    expect(input).toEqual({ eventId: id, kind: 'guest', displayName: 'Guest' })
    expect(Participant.inputSchema('create').safeParse({ ...participant, displayName: '' }).success).toBe(false)
  })

  it('rejects malformed stored public fields instead of silently bypassing response validation', () => {
    expect(() => Participant.toResponse({ ...participant, displayName: '' })).toThrow()
    expect(() => Participant.toResponseMany([{ ...participant, eventId: 'not-a-uuid' }])).toThrow()
  })
})
