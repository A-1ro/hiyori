/**
 * F-12 (#24): 完了済みイベントの TTL ベース自動削除。
 *
 * `status` が `closed` / `cancelled` のイベントを、最終活動時刻から
 * `retentionDays` 日経過した時点で物理削除する（Cron Trigger から呼ばれる）。
 *
 * 「最終活動時刻」は保守的に、そのイベントの decision の decidedAt / cancelledAt と
 * イベント自身の createdAt のうち最も新しいものを採用する（events に updatedAt が
 * 無いため）。確定し直しや取消のたびに時計が巻き戻るので、直近まで動きのあった
 * イベントを消してしまうことはない。
 *
 * D1 には FK カスケードが無いため、子テーブル（votes / decisions / candidates /
 * participants）もこの関数内で明示的に削除する。
 */

const CHUNK_SIZE = 50

export interface EventCleanupResult {
  deletedEventIds: string[]
}

/**
 * `EVENT_RETENTION_DAYS` 環境変数の解釈。
 * 未設定・空・数値でない・0 以下はすべて「自動削除しない」= null。
 */
export function parseRetentionDays(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function cleanupExpiredEvents(
  db: D1Database,
  retentionDays: number,
  now: Date,
): Promise<EventCleanupResult> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000

  // 最終活動時刻 = max(decision の decidedAt / cancelledAt, event の createdAt)。
  // SQLite の多引数 max() は scalar 関数、max(col) は集約関数として解決される。
  const rows = await db
    .prepare(
      `SELECT e.id AS id
         FROM events e
         LEFT JOIN decisions d ON d.eventId = e.id
        WHERE e.status IN ('closed', 'cancelled')
        GROUP BY e.id
       HAVING MAX(COALESCE(MAX(d.decidedAt), 0), COALESCE(MAX(d.cancelledAt), 0), e.createdAt) < ?`,
    )
    .bind(cutoff)
    .all<{ id: string }>()

  const eventIds = (rows.results ?? []).map((r) => r.id)
  if (eventIds.length === 0) {
    return { deletedEventIds: [] }
  }

  for (const ids of chunk(eventIds, CHUNK_SIZE)) {
    const placeholders = ids.map(() => '?').join(', ')
    // FK カスケードが無いので子 → 親の順で明示削除（votes は candidates 経由で全件届く）
    await db.batch([
      db
        .prepare(
          `DELETE FROM votes WHERE candidateId IN (SELECT id FROM candidates WHERE eventId IN (${placeholders}))`,
        )
        .bind(...ids),
      db.prepare(`DELETE FROM decisions WHERE eventId IN (${placeholders})`).bind(...ids),
      db.prepare(`DELETE FROM candidates WHERE eventId IN (${placeholders})`).bind(...ids),
      db.prepare(`DELETE FROM participants WHERE eventId IN (${placeholders})`).bind(...ids),
      db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).bind(...ids),
    ])
  }

  await db
    .prepare(
      `INSERT INTO audit_logs (id, actorDiscordId, action, payload, createdAt) VALUES (?, NULL, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      'event.retention.deleted',
      JSON.stringify({ retentionDays, deletedCount: eventIds.length, deletedEventIds: eventIds }),
      now.getTime(),
    )
    .run()

  return { deletedEventIds: eventIds }
}
