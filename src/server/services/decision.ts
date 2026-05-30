import { HTTPException } from 'hono/http-exception'
import { eq, and, isNull } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { NanokaModel, RowType } from '@nanokajs/core'
import type { eventFields } from '../../models/event'
import type { candidateFields } from '../../models/candidate'
import type { decisionFields } from '../../models/decision'
import { decisions, events, audit_logs } from '../../../drizzle/schema'

type DrizzleDb = BaseSQLiteDatabase<'async', any>

interface DecisionContext {
  app: {
    batch(statements: readonly [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]): Promise<readonly unknown[]>
    db: DrizzleDb
  }
  Event: NanokaModel<typeof eventFields>
  Candidate: NanokaModel<typeof candidateFields>
  Decision: NanokaModel<typeof decisionFields>
  workerHost: string
}

export async function applyDecision(
  ctx: DecisionContext,
  params: { eventId: string; candidateId: string; actorDiscordId: string },
): Promise<{
  kind: 'created' | 'updated'
  decision: RowType<typeof decisionFields>
  event: RowType<typeof eventFields>
  previousCandidateId?: string
}> {
  const { app, Event, Candidate, Decision, workerHost } = ctx
  const { eventId, candidateId, actorDiscordId } = params

  const eventRow = await Event.findOne(eventId)
  if (!eventRow) {
    throw new HTTPException(404, { message: 'Event not found' })
  }
  if (eventRow.organizerDiscordId !== actorDiscordId) {
    throw new HTTPException(403, { message: 'Forbidden' })
  }

  const candidateRow = await Candidate.findOne(candidateId)
  if (!candidateRow || candidateRow.eventId !== eventId) {
    throw new HTTPException(400, { message: 'Invalid candidateId' })
  }

  // cancelledAt フィルタを意図的に外す:
  // 1 event = 1 Decision row の設計により、取消済みを含む既存行を UPDATE することで
  // icsUid を再利用し、RFC 5545 の UID 不変 + SEQUENCE 単調増加を保証する。
  const existingDecisions = await app.db
    .select()
    .from(decisions)
    .where(eq(decisions.eventId, eventId))
    .limit(1) as RowType<typeof decisionFields>[]

  const existing = existingDecisions.length > 0 ? existingDecisions[0]! : null
  const now = new Date()

  let kind: 'created' | 'updated'
  let decisionId: string
  let icsUid: string
  let icsSequence: number
  let previousCandidateId: string | undefined

  if (existing) {
    kind = 'updated'
    decisionId = existing.id
    icsUid = existing.icsUid
    icsSequence = existing.icsSequence + 1
    previousCandidateId = existing.candidateId

    await app.batch([
      app.db
        .update(decisions)
        .set({ candidateId, decidedAt: now, icsSequence, cancelledAt: null })
        .where(eq(decisions.id, decisionId)),
      app.db
        .update(events)
        .set({ status: 'closed' })
        .where(eq(events.id, eventId)),
      app.db
        .insert(audit_logs)
        .values({
          id: crypto.randomUUID(),
          actorDiscordId,
          action: 'decision.create',
          payload: { eventId, candidateId, previousCandidateId, icsSequence },
          createdAt: now,
        }),
    ])
  } else {
    kind = 'created'
    decisionId = crypto.randomUUID()
    icsUid = `evt-${eventId}-${decisionId}@${workerHost}`
    icsSequence = 0

    await app.batch([
      app.db
        .insert(decisions)
        .values({
          id: decisionId,
          eventId,
          candidateId,
          decidedAt: now,
          icsUid,
          icsSequence,
          discordMessageId: null,
          cancelledAt: null,
        }),
      app.db
        .update(events)
        .set({ status: 'closed' })
        .where(eq(events.id, eventId)),
      app.db
        .insert(audit_logs)
        .values({
          id: crypto.randomUUID(),
          actorDiscordId,
          action: 'decision.create',
          payload: { eventId, candidateId, previousCandidateId: undefined, icsSequence },
          createdAt: now,
        }),
    ])
  }

  // TODO(F-05): Discord 通知をここで発火
  // TODO(F-07): .ics 再生成キックをここで

  const updatedDecision = await Decision.findOne(decisionId)
  if (!updatedDecision) throw new HTTPException(500, { message: 'Internal Server Error' })
  const updatedEvent = await Event.findOne(eventId)
  if (!updatedEvent) throw new HTTPException(500, { message: 'Internal Server Error' })

  return { kind, decision: updatedDecision, event: updatedEvent, previousCandidateId }
}

export async function cancelDecision(
  ctx: DecisionContext,
  params: { eventId: string; actorDiscordId: string },
): Promise<{
  decision: RowType<typeof decisionFields>
  event: RowType<typeof eventFields>
}> {
  const { app, Event, Decision } = ctx
  const { eventId, actorDiscordId } = params

  const eventRow = await Event.findOne(eventId)
  if (!eventRow) {
    throw new HTTPException(404, { message: 'Event not found' })
  }
  if (eventRow.organizerDiscordId !== actorDiscordId) {
    throw new HTTPException(403, { message: 'Forbidden' })
  }

  const activeDecisions = await app.db
    .select()
    .from(decisions)
    .where(and(eq(decisions.eventId, eventId), isNull(decisions.cancelledAt)))
    .limit(1) as RowType<typeof decisionFields>[]

  if (activeDecisions.length === 0) {
    throw new HTTPException(404, { message: 'No active decision' })
  }

  const activeDecision = activeDecisions[0]!
  const now = new Date()
  const icsSequence = activeDecision.icsSequence + 1

  await app.batch([
    app.db
      .update(decisions)
      .set({ cancelledAt: now, icsSequence })
      .where(eq(decisions.id, activeDecision.id)),
    app.db
      .update(events)
      .set({ status: 'open' })
      .where(eq(events.id, eventId)),
    app.db
      .insert(audit_logs)
      .values({
        id: crypto.randomUUID(),
        actorDiscordId,
        action: 'decision.cancel',
        payload: { eventId, candidateId: activeDecision.candidateId, icsSequence },
        createdAt: now,
      }),
  ])

  // TODO(F-05): Discord 通知をここで発火
  // TODO(F-07): .ics 再生成キックをここで

  const updatedDecision = await Decision.findOne(activeDecision.id)
  if (!updatedDecision) throw new HTTPException(500, { message: 'Internal Server Error' })
  const updatedEvent = await Event.findOne(eventId)
  if (!updatedEvent) throw new HTTPException(500, { message: 'Internal Server Error' })

  return { decision: updatedDecision, event: updatedEvent }
}
