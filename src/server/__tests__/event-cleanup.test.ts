import { describe, it, expect, beforeEach } from 'vitest'
import { env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import {
  cleanupExpiredEvents,
  parseRetentionDays,
  MAX_EVENTS_PER_RUN,
} from '../services/event-cleanup'

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

interface AuditPayload {
  retentionDays: number
  deletedCount: number
  sampleIds: string[]
}

async function auditPayloads(): Promise<AuditPayload[]> {
  const rows = await db()
    .prepare(`SELECT payload FROM audit_logs WHERE action = 'event.retention.deleted'`)
    .all<{ payload: string }>()
  return (rows.results ?? []).map((r) => JSON.parse(r.payload) as AuditPayload)
}

/**
 * 候補 SELECT の直後（DELETE バッチの前）に onAfterSelect を差し込む D1 ラッパ。
 * 「削除リスト取得後にイベントが再オープンされる」競合の再現用。
 */
function raceDb(onAfterSelect: () => Promise<void>): D1Database {
  const real = db()
  const wrapStatement = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        if (prop === 'bind') {
          return (...args: unknown[]) =>
            wrapStatement((target.bind as (...a: unknown[]) => D1PreparedStatement)(...args))
        }
        if (prop === 'all') {
          return async () => {
            const res = await target.all()
            await onAfterSelect()
            return res
          }
        }
        const v = (target as unknown as Record<PropertyKey, unknown>)[prop]
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      },
    })
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'prepare') {
        // SELECT（候補列挙）だけラップし、batch に渡る文は素の statement のままにする
        return (sql: string) => {
          const stmt = target.prepare(sql)
          return /^\s*SELECT/i.test(sql) ? wrapStatement(stmt) : stmt
        }
      }
      const v = (target as unknown as Record<PropertyKey, unknown>)[prop]
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  }) as D1Database
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
    expect(result.deletedCount).toBe(1)

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
    expect(result.deletedCount).toBe(0)
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('E3: TTL 以内の closed イベントは削除しない', async () => {
    const recent = NOW.getTime() - (RETENTION_DAYS - 1) * DAY
    const eventId = await insertEvent({ status: 'closed', createdAt: recent - DAY })
    await insertChildren(eventId, { decidedAt: recent })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedCount).toBe(0)
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
    expect(result.deletedCount).toBe(0)
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('E5: 直近に取消 (cancelledAt) されたイベントは decidedAt が古くても残す', async () => {
    const veryOld = NOW.getTime() - 365 * DAY
    const recent = NOW.getTime() - DAY
    const eventId = await insertEvent({ status: 'cancelled', createdAt: veryOld })
    await insertChildren(eventId, { decidedAt: veryOld, cancelledAt: recent })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedCount).toBe(0)
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('E6: decision の無い cancelled イベントは createdAt 基準で削除する', async () => {
    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const eventId = await insertEvent({ status: 'cancelled', createdAt: old })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedCount).toBe(1)
    expect(await count('events', 'id = ?', eventId)).toBe(0)
  })

  it('E7: 削除操作を AuditLog に記録する（対象なしなら記録しない・payload はサンプル方式）', async () => {
    // 対象なし → AuditLog 追加なし
    await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(await count('audit_logs', `action = 'event.retention.deleted'`)).toBe(0)

    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const eventId = await insertEvent({ status: 'closed', createdAt: old })

    await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    const payloads = await auditPayloads()
    expect(payloads).toHaveLength(1)
    expect(payloads[0].retentionDays).toBe(RETENTION_DAYS)
    expect(payloads[0].deletedCount).toBe(1)
    expect(payloads[0].sampleIds).toEqual([eventId])
    // 全 ID の列挙はやめた（サンプルのみ）
    expect(payloads[0]).not.toHaveProperty('deletedEventIds')
  })

  it('E8: 対象と対象外が混在しても対象だけを削除する', async () => {
    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const recent = NOW.getTime() - DAY
    const expired = await insertEvent({ status: 'closed', createdAt: old })
    const active = await insertEvent({ status: 'open', createdAt: old })
    const fresh = await insertEvent({ status: 'closed', createdAt: recent })
    const otherChildren = await insertChildren(fresh, { decidedAt: recent })

    const result = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(result.deletedCount).toBe(1)

    expect(await count('events', 'id = ?', expired)).toBe(0)
    expect(await count('events', 'id = ?', active)).toBe(1)
    expect(await count('events', 'id = ?', fresh)).toBe(1)
    // 対象外イベントの子は残る
    expect(await count('decisions', 'id = ?', otherChildren.decisionId)).toBe(1)
    expect(await count('votes', 'id = ?', otherChildren.voteId)).toBe(1)
  })

  it('E9: 競合ガード — 削除リスト取得後に open へ戻されたイベントは消さない', async () => {
    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const reopened = await insertEvent({ status: 'closed', createdAt: old - DAY })
    const reopenedChildren = await insertChildren(reopened, { decidedAt: old })
    const stillExpired = await insertEvent({ status: 'closed', createdAt: old })

    // 候補 SELECT の直後（DELETE の前）に applyDecisions 相当の再オープンを差し込む
    const racy = raceDb(async () => {
      await db().prepare(`UPDATE events SET status = 'open' WHERE id = ?`).bind(reopened).run()
    })
    const result = await cleanupExpiredEvents(racy, RETENTION_DAYS, NOW)

    // 再オープンされたイベントとその子はまるごと残る
    expect(await count('events', 'id = ?', reopened)).toBe(1)
    expect(await count('decisions', 'id = ?', reopenedChildren.decisionId)).toBe(1)
    expect(await count('candidates', 'id = ?', reopenedChildren.candidateId)).toBe(1)
    expect(await count('participants', 'id = ?', reopenedChildren.participantId)).toBe(1)
    expect(await count('votes', 'id = ?', reopenedChildren.voteId)).toBe(1)
    // もう一方（条件を満たしたまま）だけが消える
    expect(result.deletedCount).toBe(1)
    expect(await count('events', 'id = ?', stillExpired)).toBe(0)
    // 監査ログの件数・サンプルも実際に消えたものと一致する
    const payloads = await auditPayloads()
    expect(payloads).toHaveLength(1)
    expect(payloads[0].deletedCount).toBe(1)
    expect(payloads[0].sampleIds).toEqual([stillExpired])
  })

  it('E10: 1 回の実行では MAX_EVENTS_PER_RUN 件までに留め、残りは次回に持ち越す', async () => {
    const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
    const extra = 5
    const total = MAX_EVENTS_PER_RUN + extra
    const stmt = db().prepare(
      `INSERT INTO events (id, organizerDiscordId, title, defaultDurationMinutes, status, timezone, createdAt)
       VALUES (?, '12345678901234567', 'bulk', 60, 'closed', 'UTC', ?)`,
    )
    // createdAt をずらして「古い順に消える」ことも確かめる
    await db().batch(
      Array.from({ length: total }, (_, i) => stmt.bind(crypto.randomUUID(), old - (total - i) * 1000)),
    )

    const first = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(first.deletedCount).toBe(MAX_EVENTS_PER_RUN)
    expect(await count('events', `status = 'closed'`)).toBe(extra)
    // 残ったのは最終活動が新しい方（古い順に削除された）
    expect(await count('events', 'createdAt >= ?', old - extra * 1000)).toBe(extra)

    // 監査ログの deletedCount 合計は 1 回目の削除件数と一致（チャンクごとに記録）
    const payloads = await auditPayloads()
    expect(payloads.reduce((sum, p) => sum + p.deletedCount, 0)).toBe(MAX_EVENTS_PER_RUN)
    for (const p of payloads) {
      expect(p.sampleIds.length).toBeLessThanOrEqual(10)
    }

    // 持ち越し分は次回の実行で消える
    const second = await cleanupExpiredEvents(db(), RETENTION_DAYS, NOW)
    expect(second.deletedCount).toBe(extra)
    expect(await count('events', `status = 'closed'`)).toBe(0)
  })
})
