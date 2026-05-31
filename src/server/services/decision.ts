import { HTTPException } from 'hono/http-exception'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { NanokaModel, RowType } from '@nanokajs/core'
import type { eventFields } from '../../models/event'
import type { candidateFields } from '../../models/candidate'
import type { decisionFields } from '../../models/decision'
import type { participantFields } from '../../models/participant'
import { decisions, events, audit_logs, participants } from '../../../drizzle/schema'

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

export interface DecisionDelta {
  decision: RowType<typeof decisionFields>
  candidate: RowType<typeof candidateFields>
}

export interface ApplyDecisionsResult {
  /** 適用後にアクティブな全 decision（保持/再活性化/新規） */
  activeDecisions: RowType<typeof decisionFields>[]
  /** 適用後にアクティブな decision の candidate */
  activeCandidates: Map<string, RowType<typeof candidateFields>>
  event: RowType<typeof eventFields>
  added: DecisionDelta[]
  reactivated: DecisionDelta[]
  cancelled: DecisionDelta[]
  kept: DecisionDelta[]
  participants: RowType<typeof participantFields>[]
}

/**
 * イベントの確定状態を `candidateIds` で指定された集合に同期する。
 *
 * - 既存アクティブで desired に含まれる → 保持（kept）
 * - 既存取消済みで desired に含まれる → 再活性化（reactivated, icsSequence+1, cancelledAt=null）
 * - desired にあるが既存無し → 新規（added, 新しい icsUid）
 * - 既存アクティブで desired に無い → 取消（cancelled, icsSequence+1, cancelledAt=now）
 *
 * イベント status は active 件数 > 0 で 'closed'、ゼロで 'open' に同期する。
 */
export async function applyDecisions(
  ctx: DecisionContext,
  params: { eventId: string; candidateIds: string[]; actorDiscordId: string },
): Promise<ApplyDecisionsResult> {
  const { app, Event, Candidate, Decision, workerHost } = ctx
  const { eventId, candidateIds, actorDiscordId } = params

  const eventRow = await Event.findOne(eventId)
  if (!eventRow) {
    throw new HTTPException(404, { message: 'Event not found' })
  }
  if (eventRow.organizerDiscordId !== actorDiscordId) {
    throw new HTTPException(403, { message: 'Forbidden' })
  }

  const desiredSet = new Set(candidateIds)

  // 候補が全て本イベントに属するか検証
  if (desiredSet.size > 0) {
    const candRows = (await app.db
      .select()
      .from((await import('../../../drizzle/schema')).candidates)
      .where(
        inArray(
          (await import('../../../drizzle/schema')).candidates.id,
          [...desiredSet],
        ),
      )) as RowType<typeof candidateFields>[]
    if (candRows.length !== desiredSet.size) {
      throw new HTTPException(400, { message: 'Invalid candidateId' })
    }
    for (const c of candRows) {
      if (c.eventId !== eventId) {
        throw new HTTPException(400, { message: 'Invalid candidateId' })
      }
    }
  }

  // イベントの全 decision を取得（取消済み含む）
  const allRows = (await app.db
    .select()
    .from(decisions)
    .where(eq(decisions.eventId, eventId))) as RowType<typeof decisionFields>[]

  const byCandidateId = new Map<string, RowType<typeof decisionFields>>()
  // 同一 candidate に複数行（過去の取消含む）があり得るので、最新を残す
  for (const row of allRows) {
    const existing = byCandidateId.get(row.candidateId)
    if (!existing || row.decidedAt.getTime() > existing.decidedAt.getTime()) {
      byCandidateId.set(row.candidateId, row)
    }
  }

  const now = new Date()
  const statements: BatchItem<'sqlite'>[] = []

  const addedIds: string[] = []
  const reactivatedIds: string[] = []
  const cancelledIds: string[] = []
  const keptIds: string[] = []

  for (const cid of desiredSet) {
    const existing = byCandidateId.get(cid)
    if (existing && existing.cancelledAt === null) {
      keptIds.push(existing.id)
    } else if (existing) {
      const nextSeq = existing.icsSequence + 1
      statements.push(
        app.db
          .update(decisions)
          .set({ decidedAt: now, icsSequence: nextSeq, cancelledAt: null })
          .where(eq(decisions.id, existing.id)),
      )
      reactivatedIds.push(existing.id)
      statements.push(
        app.db
          .insert(audit_logs)
          .values({
            id: crypto.randomUUID(),
            actorDiscordId,
            action: 'decision.create',
            payload: { eventId, candidateId: cid, decisionId: existing.id, icsSequence: nextSeq, reactivated: true },
            createdAt: now,
          }),
      )
    } else {
      const decisionId = crypto.randomUUID()
      const icsUid = `evt-${eventId}-${decisionId}@${workerHost}`
      statements.push(
        app.db
          .insert(decisions)
          .values({
            id: decisionId,
            eventId,
            candidateId: cid,
            decidedAt: now,
            icsUid,
            icsSequence: 0,
            discordMessageId: null,
            cancelledAt: null,
          }),
      )
      addedIds.push(decisionId)
      statements.push(
        app.db
          .insert(audit_logs)
          .values({
            id: crypto.randomUUID(),
            actorDiscordId,
            action: 'decision.create',
            payload: { eventId, candidateId: cid, decisionId, icsSequence: 0 },
            createdAt: now,
          }),
      )
    }
  }

  for (const row of allRows) {
    if (row.cancelledAt !== null) continue
    if (desiredSet.has(row.candidateId)) continue
    const nextSeq = row.icsSequence + 1
    statements.push(
      app.db
        .update(decisions)
        .set({ cancelledAt: now, icsSequence: nextSeq })
        .where(eq(decisions.id, row.id)),
    )
    cancelledIds.push(row.id)
    statements.push(
      app.db
        .insert(audit_logs)
        .values({
          id: crypto.randomUUID(),
          actorDiscordId,
          action: 'decision.cancel',
          payload: { eventId, candidateId: row.candidateId, decisionId: row.id, icsSequence: nextSeq },
          createdAt: now,
        }),
    )
  }

  const nextStatus: 'open' | 'closed' = desiredSet.size > 0 ? 'closed' : 'open'
  if (nextStatus !== eventRow.status) {
    statements.push(
      app.db.update(events).set({ status: nextStatus }).where(eq(events.id, eventId)),
    )
  }

  if (statements.length > 0) {
    const [head, ...rest] = statements
    if (head) await app.batch([head, ...rest])
  }

  // 結果取得
  const updatedEvent = await Event.findOne(eventId)
  if (!updatedEvent) throw new HTTPException(500, { message: 'Internal Server Error' })

  const updatedRows = (await app.db
    .select()
    .from(decisions)
    .where(eq(decisions.eventId, eventId))) as RowType<typeof decisionFields>[]

  const activeDecisions: RowType<typeof decisionFields>[] = []
  const byId = new Map<string, RowType<typeof decisionFields>>()
  for (const r of updatedRows) {
    byId.set(r.id, r)
    if (r.cancelledAt === null) activeDecisions.push(r)
  }
  activeDecisions.sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())

  const allCandidateIds = [
    ...new Set([
      ...addedIds.map((id) => byId.get(id)?.candidateId).filter((x): x is string => !!x),
      ...reactivatedIds.map((id) => byId.get(id)?.candidateId).filter((x): x is string => !!x),
      ...cancelledIds.map((id) => byId.get(id)?.candidateId).filter((x): x is string => !!x),
      ...keptIds.map((id) => byId.get(id)?.candidateId).filter((x): x is string => !!x),
    ]),
  ]
  const candidateRows =
    allCandidateIds.length > 0
      ? ((await app.db
          .select()
          .from((await import('../../../drizzle/schema')).candidates)
          .where(
            inArray(
              (await import('../../../drizzle/schema')).candidates.id,
              allCandidateIds,
            ),
          )) as RowType<typeof candidateFields>[])
      : []
  const candidateById = new Map(candidateRows.map((c) => [c.id, c]))
  const activeCandidates = new Map<string, RowType<typeof candidateFields>>()
  for (const d of activeDecisions) {
    const c = candidateById.get(d.candidateId)
    if (c) activeCandidates.set(d.id, c)
  }

  const buildDelta = (ids: string[]): DecisionDelta[] => {
    const out: DecisionDelta[] = []
    for (const did of ids) {
      const d = byId.get(did)
      if (!d) continue
      const c = candidateById.get(d.candidateId)
      if (!c) continue
      out.push({ decision: d, candidate: c })
    }
    return out
  }

  const participantRows = (await app.db
    .select()
    .from(participants)
    .where(eq(participants.eventId, eventId))) as RowType<typeof participantFields>[]

  return {
    activeDecisions,
    activeCandidates,
    event: updatedEvent,
    added: buildDelta(addedIds),
    reactivated: buildDelta(reactivatedIds),
    cancelled: buildDelta(cancelledIds),
    kept: buildDelta(keptIds),
    participants: participantRows,
  }
}

/** 後方互換のためのシングル確定取消（全アクティブ取消）。 */
export async function cancelAllDecisions(
  ctx: DecisionContext,
  params: { eventId: string; actorDiscordId: string },
): Promise<ApplyDecisionsResult> {
  // 既存 active が無ければ 404
  const eventRow = await ctx.Event.findOne(params.eventId)
  if (!eventRow) {
    throw new HTTPException(404, { message: 'Event not found' })
  }
  if (eventRow.organizerDiscordId !== params.actorDiscordId) {
    throw new HTTPException(403, { message: 'Forbidden' })
  }
  const activeRows = (await ctx.app.db
    .select()
    .from(decisions)
    .where(and(eq(decisions.eventId, params.eventId), isNull(decisions.cancelledAt)))) as RowType<typeof decisionFields>[]
  if (activeRows.length === 0) {
    throw new HTTPException(404, { message: 'No active decision' })
  }
  return applyDecisions(ctx, { ...params, candidateIds: [] })
}
