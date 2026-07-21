import type { VoteChoice } from '../components/primitives'

// 候補枠 id → 投票（○△×）のマップ。画面の入力値・サーバー送信済みの両方をこの形で扱う。
export type VoteMap = Record<string, VoteChoice>

/**
 * 「画面の入力値 current」と「サーバー送信済み server」を枠単位で比較し、
 * 値が食い違う（＝まだ送信していない）候補枠 id の一覧を返す。
 *
 * - current にあって server に無い枠（新規入力・未送信）→ 差分あり
 * - server にあって current に無い枠（通常は起きないが、下書きで消えた等）→ 差分あり
 * - 同じ値どうし → 差分なし
 *
 * 純粋関数。React に依存しないのでそのまま単体テストできる。
 */
export function dirtyCandidateIds(current: VoteMap, server: VoteMap): string[] {
  const ids = new Set<string>([...Object.keys(current), ...Object.keys(server)])
  const out: string[] = []
  for (const id of ids) {
    if (current[id] !== server[id]) out.push(id)
  }
  return out
}

/** current と server が完全に一致（未送信の変更なし）なら true。 */
export function votesEqual(current: VoteMap, server: VoteMap): boolean {
  return dirtyCandidateIds(current, server).length === 0
}
