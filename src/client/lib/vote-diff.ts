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

// ---------------------------------------------------------------------------
// ローカル下書き（localStorage）の baseline スナップショット方式
//
// 背景: 投票は Web だけでなく CLI / MCP など別経路からもサーバー票を更新できる。
// 「ローカル下書き＝常に最新の未送信」という前提はマルチ経路では崩れ、別経路で
// サーバーが更新されると古い下書きが「未送信のローカル変更」と誤判定される。
//
// 対策: 下書きに「その下書きを作った時点のサーバー票（baseline）」を同梱する。
// 開いたとき現在のサーバー票と baseline を突き合わせ、
//   - baseline == 現在サーバー（外部変更なし）→ 下書きは純粋なローカル未送信 → 採用
//   - baseline != 現在サーバー（別経路で変わった）→ 古い下書きを破棄し最新サーバー採用
// dirty 判定は「votes vs baseline」で行う（外部で増えたサーバー票を未送信と誤認しない）。
// ---------------------------------------------------------------------------

export const VOTE_DRAFT_VERSION = 2

export interface VoteDraft {
  votes: VoteMap
  baseline: VoteMap
  // 旧形式（baseline を持たない v1 下書き）から読み込んだか。true のとき baseline は
  // 空スナップショットとして扱い、外部変更通知は出さない（移行を静かに済ませる）。
  legacy: boolean
}

const VOTE_VALUES = new Set<VoteChoice>(['yes', 'maybe', 'no'])

/**
 * localStorage の生文字列を VoteDraft に復元する。
 * - v2 形式 `{ v:2, votes, baseline }` → そのまま。
 * - 旧 v1 形式（フラットな `{ candidateId: choice }`）→ baseline 空・legacy=true。
 * - 壊れた JSON / 想定外の形 → null。
 */
export function parseVoteDraft(raw: string | null | undefined): VoteDraft | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  if (
    rec.v === VOTE_DRAFT_VERSION &&
    rec.votes &&
    typeof rec.votes === 'object' &&
    rec.baseline &&
    typeof rec.baseline === 'object'
  ) {
    return {
      votes: rec.votes as VoteMap,
      baseline: rec.baseline as VoteMap,
      legacy: false,
    }
  }
  // 旧 v1: v キーが無く、全ての値が投票選択肢ならフラットな votes マップとみなす。
  const values = Object.values(rec)
  const looksLegacy =
    values.length > 0 && values.every((v) => VOTE_VALUES.has(v as VoteChoice))
  if (looksLegacy) {
    return { votes: rec as VoteMap, baseline: {}, legacy: true }
  }
  return null
}

/** VoteDraft を localStorage 保存用の文字列にする（v2 形式）。 */
export function serializeVoteDraft(votes: VoteMap, baseline: VoteMap): string {
  return JSON.stringify({ v: VOTE_DRAFT_VERSION, votes, baseline })
}

export interface ReconcileResult {
  // 画面に採用する votes。
  votes: VoteMap
  // 'draft' = ローカル下書きを採用（外部変更なし）／'server' = 最新サーバーを採用。
  source: 'draft' | 'server'
  // 別経路でサーバーが変わったため下書きを破棄した（ユーザーに一度知らせる用）。
  externalChanged: boolean
}

/**
 * 下書きと現在のサーバー票を突き合わせて、採用する votes を決める。純粋関数。
 * - 下書きあり & baseline==現在サーバー → 下書き採用（外部変更なし）。
 * - 下書きあり & baseline!=現在サーバー → サーバー採用（外部変更あり／旧形式は静かに移行）。
 * - 下書きなし → サーバー採用。
 */
export function reconcileVoteDraft(
  draft: VoteDraft | null,
  currentServer: VoteMap,
): ReconcileResult {
  if (draft && Object.keys(draft.votes).length > 0) {
    if (votesEqual(draft.baseline, currentServer)) {
      return { votes: draft.votes, source: 'draft', externalChanged: false }
    }
    // baseline がずれている＝別経路でサーバーが変わった。最新サーバーを採用。
    // 旧形式（baseline 不明）の移行は通知しない。
    return { votes: currentServer, source: 'server', externalChanged: !draft.legacy }
  }
  return { votes: currentServer, source: 'server', externalChanged: false }
}
