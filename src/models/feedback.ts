import { t } from '@nanokajs/core'

// 不具合報告・フィードバック（層1・Hiyori 単体で完結）。
// フォーム（ログイン不要）→ POST /api/feedback で D1 に保存。
// 読み出しは admin トークン保護の GET /api/feedback のみ。特定インフラに依存しない汎用テーブル。
export const feedbackTableName = 'feedback'
export const feedbackFields = {
  id: t.uuid().primary().readOnly(),
  // 報告本文（必須）。
  message: t.string().min(1).max(4000),
  // 種別。bug / feature / other 等。API 層でホワイトリスト検証する。任意。
  category: t.string().optional(),
  // 報告時に見ていたページの URL / パス。任意。
  pageUrl: t.string().optional(),
  // イベント画面からの報告ならイベント ID。任意。
  eventId: t.string().optional(),
  // 送信元ブラウザの User-Agent（サーバー側で付与）。任意。
  userAgent: t.string().optional(),
  // 表示名や連絡先など、任意の名乗り。匿名可。
  submitter: t.string().optional(),
  // 濫用調査用に送信元 IP の SHA-256 ハッシュのみ保存（生 IP は保存しない）。任意。
  ipHash: t.string().optional(),
  // トリアージ状態。既定 'new'。将来 triaged / resolved。
  status: t.string().default('new'),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
}
