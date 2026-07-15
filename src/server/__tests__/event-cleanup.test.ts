import { describe, it, expect, beforeEach } from 'vitest'
import { env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { cleanupExpiredEvents, parseRetentionDays } from '../services/event-cleanup'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-15T03:00:00.000Z')
const RETENTION_DAYS = 30

function db(): D1Database {
  return (env as { DB: D1Database }).DB
}

async function insertEvent(opts: { status: string; createdAt: number }): Promise<string> {
  const id = crypto.randomUUID()
  await db()
    .prepare(
      `INSERT INTO events (id, organizerDiscordId, title, defaultDurationMinutes, status, timezone, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, '12345678901234567', 'テストイベント', 60, opts.status, 'UTC', opts.createdAt)
    .run()
  return id
}

/** candidate + participant + vote + decision をぶら下げる（カスケード削除の検証用） */
async function insertChildren(
  eventId: string,
  opts: { decidedAt: number; cancelledAt?: number | null },
): Promise<{ candidateId: string; participantId: string; voteId: string; decisionId: string }> {
  const candidateId = crypto.randomUUID()
  const participantId = crypto.randomUUID()
  const voteId = crypto.randomUUID()
  const decisionId = crypto.randomUUID()
  const d = db()
  await d
    .prepare(`INSERT INTO candidates (id, eventId, startAt, endAt) VALUES (?, ?, ?, ?)`)
    .bind(candidateId, eventId, opts.decidedAt, opts.decidedAt + 60 * 60 * 1000)
    .run()
  // participants は (eventId, discordUserId) unique のため毎回ユニークな ID を使う
  const discordUserId = String(Math.floor(Math.random() * 1e17))
  await d
    .prepare(
      `INSERT INTO participants (id, eventId, kind, discordUserId, displayName, createdAt) VALUES (?, ?, 'discord', ?, 'Owner', ?)`,
    )
    .bind(participantId, eventId, discordUserId, opts.decidedAt)
    .run()
  await d
    .prepare(
      `INSERT INTO votes (id, candidateId, participantId, choice, updatedAt) VALUES (?, ?, ?, 'yes', ?)`,
    )
    .bind(voteId, candidateId, participantId, opts.decidedAt)
    .run()
  await d
    .prepare(
      `INSERT INTO decisions (id, eventId, candidateId, decidedAt, icsUid, icsSequence, cancelledAt) VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .bind(decisionId, eventId, candidateId, opts.decidedAt, `${decisionId}@hiyori`, opts.cancelledAt ?? null)
    .run()
  return { candidateId, participantId, voteId, decisionId }
}

async function count(table: string, where: string, ...binds: unknown[]): Promise<number> {
  const row = await db()
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>()
  return row?.n ?? 0
}

describe('parseRetentionDays', () => {
  it('未設定・空・非数値・0 以下は null（自動削除しない）', () => {
    expect(parseRetentionDays(undefined)).toBeNull()
    expect(parseRetentionDays('')).toBeNull()
    expect(parseRetentionDays('  ')).toBeNull()
    expect(parseRetentionDays('abc')).toBeNull()
    expect(parseRetentionDays('0')).toBeNull()
    expect(parseRetentionDays('-5')).toBeNull()
    expect(parseRetentionDays('1.5')).toBeNull()
  })

  it('正の整数はそのまま返す', () => {
    expect(parseRetentionDays('1')).toBe(1)
    expect(parseRetentionDays('90')).toBe(90)
  })
})

describe('cleanupExpiredEvents', () => {
  beforeEach(async () => {
    await applyMigrations()
    // ストレージはファイル内で共有されるため毎回まっさらにする
    for (const table of ['votes', 'decisions', 'candidates', 'participants', 'events', 'audit_logs']) {
      await db().prepare(`DELETE FROM ${table}`).run()
    }
  })

  it('E1: TTL 超過の closed イベントを子テーブルごと物理削除する', async () => {
    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const eventId = await insertEvent({ status: 'closed', createdAt: old - DAY })
    const children = await insertChildren(eventId, { decidedAt: old })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedEventIds).toEqual([eventId])

    expect(await count('events', 'id = ?', eventId)).toBe(0)
    expect(await count('decisions', 'id = ?', children.decisionId)).toBe(0)
    expect(await count('candidates', 'id = ?', children.candidateId)).toBe(0)
    expect(await count('participants', 'id = ?', children.participantId)).toBe(0)
    expect(await count('votes', 'id = ?', children.voteId)).toBe(0)
  })

  it('E2: open イベントはどれだけ古くても削除しない', async () => {
    const veryOld = NOW.getTime() - 365 * DAY
    const eventId = await insertEvent({ status: 'open', createdAt: veryOld })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedEventIds).toEqual([])
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('E3: TTL 以内の closed イベントは削除しない', async () => {
    const recent = NOW.getTime() - (RETENTION_DAYS - 1) * DAY
    const eventId = await insertEvent({ status: 'closed', createdAt: recent - DAY })
    await insertChildren(eventId, { decidedAt: recent })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedEventIds).toEqual([])
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('E4: 基準は最終活動時刻 — createdAt が古くても直近に確定し直したイベントは残す', async () => {
    const veryOld = NOW.getTime() - 365 * DAY
    const recent = NOW.getTime() - DAY
    const eventId = await insertEvent({ status: 'closed', createdAt: veryOld })
    // 古い確定 + 直近の確定し直し
    await insertChildren(eventId, { decidedAt: veryOld })
    await insertChildren(eventId, { decidedAt: recent })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedEventIds).toEqual([])
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('E5: 直近に取消 (cancelledAt) されたイベントは decidedAt が古くても残す', async () => {
    const veryOld = NOW.getTime() - 365 * DAY
    const recent = NOW.getTime() - DAY
    const eventId = await insertEvent({ status: 'cancelled', createdAt: veryOld })
    await insertChildren(eventId, { decidedAt: veryOld, cancelledAt: recent })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedEventIds).toEqual([])
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('E6: decision の無い cancelled イベントは createdAt 基準で削除する', async () => {
    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const eventId = await insertEvent({ status: 'cancelled', createdAt: old })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedEventIds).toEqual([eventId])
    expect(await count('events', 'id = ?', eventId)).toBe(0)
  })

  it('E7: 削除操作を AuditLog に記録する（対象なしなら記録しない）', async () => {
    // 対象なし → AuditLog 追加なし
    await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(await count('audit_logs', `action = 'event.retention.deleted'`)).toBe(0)

    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const eventId = await insertEvent({ status: 'closed', createdAt: old })

    await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    const log = await db()
      .prepare(`SELECT payload FROM audit_logs WHERE action = 'event.retention.deleted'`)
      .first<{ payload: string }>()
    expect(log).toBeTruthy()
    const payload = JSON.parse(log!.payload) as {
      retentionDays: number
      deletedCount: number
      deletedEventIds: string[]
    }
    expect(payload.retentionDays).toBe(RETENTION_DAYS)
    expect(payload.deletedCount).toBe(1)
    expect(payload.deletedEventIds).toEqual([eventId])
  })

  it('E8: 対象と対象外が混在しても対象だけを削除する', async () => {
    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const recent = NOW.getTime() - DAY
    const expired = await insertEvent({ status: 'closed', createdAt: old })
    const active = await insertEvent({ status: 'open', createdAt: old })
    const fresh = await insertEvent({ status: 'closed', createdAt: recent })
    const otherChildren = await insertChildren(fresh, { decidedAt: recent })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedEventIds).toEqual([expired])

    expect(await count('events', 'id = ?', expired)).toBe(0)
    expect(await count('events', 'id = ?', active)).toBe(1)
    expect(await count('events', 'id = ?', fresh)).toBe(1)
    // 対象外イベントの子は残る
    expect(await count('decisions', 'id = ?', otherChildren.decisionId)).toBe(1)
    expect(await count('votes', 'id = ?', otherChildren.voteId)).toBe(1)
  })
})
