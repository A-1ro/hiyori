import { HTTPException } from 'hono/http-exception'
import type { AssistantAction, AssistantMessage, AssistantState } from '../../shared/assistant'

export interface ConversationRow {
  id: string
  history: string
  pending: string | null
  leaseId: string | null
  leaseUntil: number
  lastRequestId: string | null
  updatedAt: number
}

const LEASE_MS = 120_000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function conversationState(row: ConversationRow): AssistantState {
  const pending: AssistantAction | null = row.pending ? JSON.parse(row.pending) : null
  return {
    messages: JSON.parse(row.history),
    pending: pending && pending.expiresAt > Date.now() ? pending : null,
    busy: row.leaseUntil > Date.now(),
  }
}

export async function readConversation(db: D1Database, userId: string): Promise<ConversationRow> {
  const now = Date.now()
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO assistant_conversations (id, history, leaseUntil, updatedAt) VALUES (?, ?, 0, ?)').bind(userId, '[]', now),
    db.prepare('UPDATE assistant_conversations SET history = ?, pending = NULL, lastRequestId = NULL, updatedAt = ? WHERE id = ? AND updatedAt < ? AND leaseUntil <= ?').bind('[]', now, userId, now - RETENTION_MS, now),
  ])
  const row = await db.prepare('SELECT * FROM assistant_conversations WHERE id = ?').bind(userId).first<ConversationRow>()
  if (!row) throw new HTTPException(500, { message: '会話を読み込めませんでした' })
  return row
}

export async function acquireConversation(db: D1Database, userId: string, leaseId: string): Promise<ConversationRow> {
  await readConversation(db, userId)
  const now = Date.now()
  const row = await db.prepare('UPDATE assistant_conversations SET leaseId = ?, leaseUntil = ? WHERE id = ? AND leaseUntil <= ? RETURNING *')
    .bind(leaseId, now + LEASE_MS, userId, now).first<ConversationRow>()
  if (!row) throw new HTTPException(409, { message: '処理中です。少し待ってから再試行してください' })
  return row
}

export async function releaseConversation(db: D1Database, userId: string, leaseId: string): Promise<void> {
  await db.prepare('UPDATE assistant_conversations SET leaseId = NULL, leaseUntil = 0 WHERE id = ? AND leaseId = ?').bind(userId, leaseId).run()
}

export async function saveConversation(db: D1Database, row: ConversationRow, messages: AssistantMessage[], pending: AssistantAction | null, requestId?: string): Promise<void> {
  const result = await db.prepare('UPDATE assistant_conversations SET history = ?, pending = ?, lastRequestId = ?, updatedAt = ? WHERE id = ? AND leaseId = ? AND leaseUntil > ?')
    .bind(JSON.stringify(messages.slice(-40)), pending ? JSON.stringify(pending) : null, requestId ?? row.lastRequestId, Date.now(), row.id, row.leaseId, Date.now()).run()
  if (result.meta.changes !== 1) throw new HTTPException(409, { message: '処理期限を過ぎました。会話を再読み込みしてください' })
}

export async function reserveInference(db: D1Database, userId: string, globalLimit: number, userLimit: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10)
  const globalId = `${day}:global`
  const userKey = `${day}:${userId}`
  // A materialized eligibility check snapshots BOTH counters before updating
  // either of them. The D1 batch is transactional across Worker isolates.
  const sql = `WITH allowed AS MATERIALIZED (
    SELECT 1 WHERE (SELECT calls FROM assistant_usage WHERE id = ?) < ?
    AND (SELECT calls FROM assistant_usage WHERE id = ?) < ?
  ) UPDATE assistant_usage SET calls = calls + 1
    WHERE id IN (?, ?) AND EXISTS (SELECT 1 FROM allowed) RETURNING id, calls`
  const results = await db.batch<{ id: string; calls: number }>([
    db.prepare('INSERT OR IGNORE INTO assistant_usage (id, day, calls) VALUES (?, ?, 0)').bind(globalId, day),
    db.prepare('INSERT OR IGNORE INTO assistant_usage (id, day, calls) VALUES (?, ?, 0)').bind(userKey, day),
    db.prepare(sql).bind(globalId, globalLimit, userKey, userLimit, globalId, userKey),
  ])
  if (results[2]!.results.length !== 2) {
    throw new HTTPException(429, { message: 'AIの利用上限に達しました。次の9:00（日本時間）以降に再試行してください' })
  }
  if (results[2]!.results.find(row => row.id === globalId)?.calls === 1) {
    const cutoff = new Date(Date.now() - RETENTION_MS).toISOString().slice(0, 10)
    await db.batch([
      db.prepare('DELETE FROM assistant_usage WHERE day < ?').bind(cutoff),
      db.prepare('DELETE FROM assistant_conversations WHERE updatedAt < ? AND leaseUntil <= ?').bind(Date.now() - RETENTION_MS, Date.now()),
    ])
  }
}
