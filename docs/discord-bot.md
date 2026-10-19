# Discord Bot の構築

本番サービスを利用するだけなら、[トップページ](https://hiyori-schedule.com)の「Discord サーバーに追加」から既存 Bot を招待する。以下はセルフホストで自分の Application / Bot を用意する手順。[開発・セルフホスト手順](development.md)で先に自分の Worker を設定する。

1. [Discord Developer Portal](https://discord.com/developers/applications) で Application と Bot を作成
2. [環境変数一覧](environment.md)の Discord 設定を `pnpm exec wrangler secret put <KEY>` で登録（ローカルは `.dev.vars`）
3. **OAuth2 → Redirects** に `DISCORD_OAUTH_REDIRECT_URI` と同じ URL を登録
4. **Interactions Endpoint URL** に `https://{your-worker}.workers.dev/api/discord/interactions` を設定
5. `pnpm discord:register` でスラッシュコマンドを登録
6. Bot 招待 URL: `https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&scope=bot%20applications.commands&permissions=2048`

> セキュリティ上、`POST/PATCH /api/events` は raw な `discordChannelId` を受け付けず、`/hiyori new` 経由で発行された署名付き `discordChannelToken` のみを受理する（cross-tenant 投稿防止）。詳細は [開発時の注意](../CLAUDE.md) 参照。

チャンネルの「閲覧」と「メッセージ送信」の権限を確認する。上記 URL の `CLIENT_ID` と `your-worker` は自分の設定に置き換え、独自ドメインを利用する場合はそのホスト名を使う。

`DISCORD_APP_ID` と `DISCORD_BOT_TOKEN` を `.dev.vars` に設定してから、リポジトリルートで `pnpm discord:register` を実行する。`DISCORD_GUILD_ID` を指定すればサーバー限定登録、未指定ならグローバル登録になる。

通知を使う場合は Discord 上で `/hiyori new` を実行し、返されたリンクから**公開イベント**を作成する。Web / CLI / MCP だけで作ったイベントには通知先チャンネルが紐付かない。招待限定イベントは、チャンネル連携があっても Discord 通知の対象外。

[README に戻る](../README.md)
