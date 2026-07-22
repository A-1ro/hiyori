// お知らせ本文の URL 自動リンク化。純粋関数として export し、React JSX 側で
// { type: 'text' | 'url'; value } の配列を受け取って `<a>` を組み立てる。
//
// 実装方針（企画書 §7.1 の詳細仕様に準拠）:
//   1) `https?://` に限定した regex で URL 抽出。末尾の句読点・閉じ括弧は文字クラスで除外し、
//      素朴な `[^\s]+` が末尾記号を URL に取り込む問題を防ぐ。
//   2) 抽出した候補は必ず `new URL(candidate)` で parse し直し、`protocol` が `http:` / `https:`
//      であることを allowlist で二重チェック。`javascript:` / `data:` 等は parse 成功しても弾く。
//   3) React JSX 側は `<a href={url}>{url}</a>` の変数直渡しで描画すること（テンプレ文字列で
//      href を組み立てない）。React が自動でエスケープする。
//
// 6+ ケースのユニットテストは同ディレクトリの __tests__ に配置。
export type LinkifySegment =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string }

// scheme を `https?://` に限定。空白と JSX 破壊文字は除外し、日本語本文で URL の境界が
// おかしくなるのを防ぐため、全角句読点・全角/半角の閉じ括弧は本体からも除外する
// （企画書 §7.1 の regex は本体でこれらを許容しているが、それだと `https://foo）を参照` の
//  ような日本語本文で URL に「）を参照」まで取り込まれる。境界が確実に切れるように本体側でも
//  弾く方針に強化）。最後の 1 文字も末尾記号でない文字クラスに縛ることで、半角句読点（`.` `,` 等）
//  で終わるケースを排除する。
const URL_REGEX = /(https?:\/\/[^\s<>"'`、。）)]+[^\s<>"'`.,;:!?、。)）])/g

function isSafeHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function linkify(text: string): LinkifySegment[] {
  if (!text) return []
  const segments: LinkifySegment[] = []
  let lastIndex = 0

  // regex は stateful なので毎回 lastIndex を 0 に戻す（グローバル regex を関数間で共有する事故防止）。
  URL_REGEX.lastIndex = 0
  let match: RegExpExecArray | null = URL_REGEX.exec(text)
  while (match !== null) {
    const candidate = match[0]
    // scheme allowlist 二重チェック。regex を通っても javascript:/data: 等は URL コンストラクタで
    // parse 成功する（将来 Markdown 対応時の別経路対策）ので必ず protocol を確認する。
    if (!isSafeHttpUrl(candidate)) {
      // リンク化しない → 通常テキスト扱いで進める（regex を1文字進めて誤マッチを避ける）
      URL_REGEX.lastIndex = match.index + 1
      match = URL_REGEX.exec(text)
      continue
    }
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'url', value: candidate })
    lastIndex = match.index + candidate.length
    match = URL_REGEX.exec(text)
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}
