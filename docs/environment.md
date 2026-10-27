# 環境変数とシークレット

`vars`（非機密）は `wrangler.jsonc` に、シークレットは `pnpm exec wrangler secret put <KEY>` で登録する。ローカル開発では `.dev.vars`（Git 管理外）に記述する。実値をドキュメントやログに転記しない。

| キー | 区分 | 用途 |
|---|---|---|
| `ENVIRONMENT` | var | `development` / `production`。`production` 以外で dev 用 React Refresh preamble を注入 |
| `DISCORD_CLIENT_ID` | var/secret | Discord Application ID（= OAuth2 Client ID） |
| `DISCORD_CLIENT_SECRET` | secret | OAuth2 Client Secret |
| `DISCORD_OAUTH_REDIRECT_URI` | var | OAuth コールバック URL（例: `https://{worker}.workers.dev/api/auth/discord/callback`） |
| `DISCORD_BOT_TOKEN` | secret | Bot トークン（チャンネル通知・コマンド登録・ログイン済みユーザーの招待照合に使用） |
| `DISCORD_PUBLIC_KEY` | secret | Interactions の署名検証用 公開鍵 |
| `DISCORD_CHANNEL_TOKEN_SECRET` | secret | チャンネル連携トークン（HMAC-SHA256）の署名鍵。**未設定だと署名付きチャンネル連携を利用できない**（トークン提示時に 503） |
| `EVENT_RETENTION_DAYS` | var | 完了済み（`closed` / `cancelled`）イベントを最終活動から N 日経過後に日次 cron で自動削除する保持日数（正の整数）。**未設定ではこの cron による自動削除を行わない** |
| `FEEDBACK_ADMIN_TOKEN` | secret | 不具合報告フォームの読み出しAPI（`GET /api/feedback` / `PATCH /api/feedback/:id`）を保護する admin トークン。**未設定だと読み出しAPIは常に 403**。投稿フォーム（`POST /api/feedback`）は未設定でも動作し、報告は D1 に蓄積される（読み出しだけが無効） |
| `ANNOUNCEMENTS_ADMIN_TOKEN` | secret | 運営お知らせの書き込み API（`POST /api/announcements` / `PATCH /api/announcements/:id`）を保護する admin トークン。**未設定では管理操作を許可しない**（認証判定は 403。先行するレート制限では 429 の場合あり）。公開 GET（`GET /api/announcements`）は未設定でも動作する。ローテーション手順は [運用マニュアル](ops.md) 参照 |

> `pnpm discord:register` は `DISCORD_APP_ID`（= `DISCORD_CLIENT_ID` と同値）と `DISCORD_BOT_TOKEN`、任意で `DISCORD_GUILD_ID`（ギルド限定登録）を `.dev.vars` から読む。

## MCP とコマンド登録

| キー | 区分 | 用途 |
|---|---|---|
| `MCP_ENABLED` | var | `true` / `1` で MCP を有効化。未設定・その他では `/mcp` は 404。リポジトリの現行 `wrangler.jsonc` は `"true"` |
| `MCP_STATELESS_ENABLED` | var | `true` / `1` で `/mcp` の新規Streamable HTTP接続をDOなし・JSON応答にする。本番false、e2e true。既存のセッションID付き接続は従来のDO経路を維持 |
| `DISCORD_APP_ID` | コマンド登録用環境変数 | `DISCORD_CLIENT_ID` と同じ Application ID。`scripts/register-discord-commands.mjs` が使用 |
| `DISCORD_GUILD_ID` | コマンド登録用環境変数（任意） | 開発中に特定サーバーだけへコマンドを登録する場合に指定 |

`DB`（D1）、`OAUTH_KV`（KV）、`MCP_OBJECT`（Durable Object）、rate limit は文字列の環境変数ではなく Wrangler のバインディング。[開発・セルフホスト手順](development.md) を参照。

[README に戻る](../README.md)

## ﾋﾖﾘﾁｬﾝ

`HIYORICHAN_ENABLED`は本番false・e2e true。e2eにWorkers AI binding `AI`と`ASSISTANT_RATELIMIT`を設定します。`HIYORICHAN_DAILY_CALLS=100`、`HIYORICHAN_USER_DAILY_CALLS=20`は推論回数の日次枠（UTC日付）です。新しいDOは追加しません。詳細は[ﾋﾖﾘﾁｬﾝ](hiyorichan.md)。
