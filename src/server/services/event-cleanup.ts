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
 *
 * 安全設計:
 * - 候補 SELECT と DELETE の間にイベントが再オープンされる競合（applyDecisions は
 *   closed → open に戻すことがある）に備え、各 DELETE 文は「親イベントが**今も**
 *   削除条件を満たす」ことをサブクエリで再検査する。`db.batch` は単一トランザクション
 *   なのでバッチ内では一貫する。
 * - 1 回の実行で削除するのは最終活動が古い順に最大 `MAX_EVENTS_PER_RUN` 件。
 *   消し切れない分は翌日の cron に持ち越す。
 * - 監査ログの INSERT は削除と同じ `db.batch`（チャンクごと）に含め、
 *   「記録なき削除」「削除なき記録」がどちらも起きないようにする。
 */

const CHUNK_SIZE = 50
/** 1 回の cron 実行で削除するイベント数の上限。超過分は翌日に持ち越す。 */
export const MAX_EVENTS_PER_RUN = 200
/** 監査ログ payload に残す削除イベント ID のサンプル数（全件は列挙しない） */
const AUDIT_SAMPLE_SIZE = 10

export interface EventCleanupResult {
  /** 実際に削除したイベント数（events への DELETE の meta.changes を集計） */
  deletedCount: number
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

/**
 * 「今この瞬間も削除条件を満たす」イベント ID を選ぶサブクエリ。
 * バインドは [...ids, cutoff] の順（プレースホルダは ids ぶん）。
 * 各 DELETE をこの条件でガードすることで、候補列挙後に再オープンされた
 * イベント（とその子レコード）を誤って消さない。
 */
function stillExpiredEventIds(placeholders: string): string {
  return `SELECT e.id FROM events e
           WHERE e.id IN (${placeholders})
             AND e.status IN ('closed', 'cancelled')
             AND MAX(
                   COALESCE((SELECT MAX(d.decidedAt) FROM decisions d WHERE d.eventId = e.id), 0),
                   COALESCE((SELECT MAX(d.cancelledAt) FROM decisions d WHERE d.eventId = e.id), 0),
                   e.createdAt
                 ) < ?`
}

export async function cleanupExpiredEvents(
  db: D1Database,
  retentionDays: number,
  now: Date,
): Promise<EventCleanupResult> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000

  // 最終活動時刻 = max(decision の decidedAt / cancelledAt, event の createdAt)。
  // SQLite の多引数 max() は scalar 関数、max(col) は集約関数として解決される。
  // 古い順に MAX_EVENTS_PER_RUN 件まで（残りは翌日の実行に持ち越す）。
  const rows = await db
    .prepare(
      `SELECT e.id AS id,
              MAX(COALESCE(MAX(d.decidedAt), 0), COALESCE(MAX(d.cancelledAt), 0), e.createdAt) AS lastActivityAt
         FROM events e
         LEFT JOIN decisions d ON d.eventId = e.id
        WHERE e.status IN ('closed', 'cancelled')
        GROUP BY e.id
       HAVING lastActivityAt < ?
        ORDER BY lastActivityAt ASC
        LIMIT ${MAX_EVENTS_PER_RUN}`,
    )
    .bind(cutoff)
    .all<{ id: string }>()

  const eventIds = (rows.results ?? []).map((r) => r.id)
  if (eventIds.length === 0) {
    return { deletedCount: 0 }
  }

  let deletedCount = 0
  for (const ids of chunk(eventIds, CHUNK_SIZE)) {
    const placeholders = ids.map(() => '?').join(', ')
    const guard = stillExpiredEventIds(placeholders)
    const guardBinds = [...ids, cutoff]
    const results = await db.batch([
      // 監査ログは削除と同一トランザクションに同梱（チャンクごと）。
      // deletedCount / sampleIds はガード条件をトランザクション内で評価して
      // SQL 側で組み立てるので、この後の DELETE が消す集合と必ず一致する。
      // 消すものが無ければ（HAVING）行自体を追加しない。
      db
        .prepare(
          `INSERT INTO audit_logs (id, actorDiscordId, action, payload, createdAt)
           SELECT ?, NULL, 'event.retention.deleted',
                  json_object(
                    'retentionDays', ?,
                    'deletedCount', COUNT(*),
                    'sampleIds', json_group_array(id) FILTER (WHERE rn <= ${AUDIT_SAMPLE_SIZE})
                  ),
                  ?
             FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM (${guard}))
           HAVING COUNT(*) > 0`,
        )
        .bind(crypto.randomUUID(), retentionDays, now.getTime(), ...guardBinds),
      // FK カスケードが無いので子 → 親の順で明示削除（votes は candidates 経由で全件届く）。
      // 子の削除は decision 行を消して最終活動時刻を「下げる」方向にしか作用しない
      // （cutoff 超過のまま）ので、同一バッチ内の後続ガードと矛盾しない。
      db
        .prepare(
          `DELETE FROM votes WHERE candidateId IN (SELECT id FROM candidates WHERE eventId IN (${guard}))`,
        )
        .bind(...guardBinds),
      db.prepare(`DELETE FROM decisions WHERE eventId IN (${guard})`).bind(...guardBinds),
      db.prepare(`DELETE FROM candidates WHERE eventId IN (${guard})`).bind(...guardBinds),
      db.prepare(`DELETE FROM participants WHERE eventId IN (${guard})`).bind(...guardBinds),
      db.prepare(`DELETE FROM events WHERE id IN (${guard})`).bind(...guardBinds),
    ])
    // 削除件数は events への DELETE（バッチ末尾）の meta.changes から集計する
    deletedCount += results[results.length - 1]?.meta.changes ?? 0
  }

  return { deletedCount }
}
