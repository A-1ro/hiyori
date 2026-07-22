import { t } from '@nanokajs/core'

// 運営からのお知らせ（層1・Hiyori 単体で完結）。
// 公開 GET は無認証・書き込みは admin トークン保護。特定インフラに依存しない汎用テーブル。
// 公開 GET は `Cache-Control: no-store` で origin 直返し（edge cache 不使用）。
export const announcementTableName = 'announcement'
export const announcementFields = {
  id: t.uuid().primary().readOnly(),
  // タイトル（必須）。ヘッダのドロップダウンで表示するのでコンパクトに。
  title: t.string().min(1).max(120),
  // 本文（必須）。プレーンテキスト＋改行のみ。Markdown/HTML は解釈しない（クライアント側で自動リンク化のみ）。
  body: t.string().min(1).max(4000),
  // カテゴリ。API 層でホワイトリスト検証する（bug_fix / new_feature / notice）。
  category: t.string(),
  // 表示ステータス。'published' が公開中、'archived' は取り下げ済み（GET から除外）。
  // 'draft' は MVP 未使用（将来の予約投稿等で拡張余地）。
  status: t.string().default('published'),
  // 公開日時。既定は作成時刻。順序 (DESC) とクライアント未読比較のキー。
  publishedAt: t.timestamp().default(() => new Date()),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
}
