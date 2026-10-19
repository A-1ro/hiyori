# ChatGPT / Claude との MCP 連携

Hiyori のリモート MCP サーバーを使うと、対応クライアントから自分のイベントを確認し、日程調整を操作できる。

## 接続の流れ

1. ChatGPT / Claude 側でリモート MCP サーバーを追加できる設定を開く。設定名や利用可否は、アプリ・プラン・組織設定によって異なる。
2. 接続先に **`https://hiyori-schedule.com/mcp`** を指定する。セルフホストの場合は自分の Worker の URL + `/mcp` を使う。
3. ブラウザで Discord にログインし、Hiyori の同意画面で権限を選ぶ。
4. 接続後、まず「Hiyori に接続しているアカウントを確認して」「自分のイベントを一覧にして」のような読み取りで確かめる。

`hiyori:read` は読み取り、`hiyori:write` は作成・回答・編集・確定・削除などの変更用。クライアントがスコープを要求しなかった場合、同意画面は読み取りのみを提示する。書き込みが拒否される場合は許可したスコープを確認する。主催者のみの操作には、書き込み権限に加えて対象イベントの主催者であることが必要。

このリポジトリの登録実装は [`src/server/mcp/agent.ts`](../src/server/mcp/agent.ts)。接続先から取得できるツール一覧を確認すること。本番とソースのリビジョン、クライアントの表示が常に一致するとは限らない。

## 操作の入口

| やりたいこと | 主なツール |
|---|---|
| アカウント・イベントを確認 | `hiyori_whoami`、`hiyori_list_events`、`hiyori_get_event` |
| 回答・集計・予定を確認 | `hiyori_get_my_votes`、`hiyori_tally`、`hiyori_my_busy` |
| 作成・編集・削除 | `hiyori_create_event`、`hiyori_edit_event`、`hiyori_delete_event` |
| 候補・回答・確定を操作 | `hiyori_add_candidate`、`hiyori_remove_candidate`、`hiyori_vote`、`hiyori_confirm`、`hiyori_unconfirm` |
| 招待を管理 | `hiyori_list_invites`、`hiyori_add_invite`、`hiyori_revoke_invite` |
| カレンダーを利用 | `hiyori_get_ics`、`hiyori_list_subscriptions`、`hiyori_add_subscription`、`hiyori_remove_subscription`、`hiyori_regen_subscription` |

招待限定の対象者・ユーザー名の扱い・公開配信からの除外は [利用ガイド](usage.md)を参照。ゲスト回答と Discord チャンネル連携の開始は Web / Discord の機能で、MCP の対象外。

## セルフホスト

- [`wrangler.jsonc`](../wrangler.jsonc) の現行設定は `MCP_ENABLED: "true"`。実装では `true` / `1` の場合に有効で、未設定・その他の値では `/mcp` は 404 になる。「常に既定オフ」とは扱わず、実際の環境を確認する。
- `OAUTH_KV` と `MCP_OBJECT`、Durable Object migration が必要。[開発・セルフホスト手順](development.md)に従い、D1 と KV は自分のリソースに置き換える。
- 公開の `GET /api/mcp/status` で有効状態を確認できる。OAuth のリソース情報は `/.well-known/oauth-protected-resource/mcp` にあり、リソース URL はそのホストの `/mcp`。
- OAuth の互換性に関する検証範囲は [OAuth provider 移行資料](oauth-provider-migration.md)を参照。実クライアントでのログイン・同意・操作の成功は、公開メタデータだけでは確認できない。

[MCP 設計資料](plans/2026-07-21-mcp-server.md)は設計の経緯を残した資料。現在のツールと設定は実装を優先する。

[README に戻る](../README.md)
