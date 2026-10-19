# Hiyori

**日程を決めて、知らせて、カレンダーに追加する。** Hiyori は Discord と連携した日程調整ツールです。候補日時への `○ / △ / ×` の回答を集め、主催者が開催日を確定し、Discord 通知やカレンダーへの追加まで進められます。

**[Hiyori を使う](https://hiyori-schedule.com)** · [使い方ガイド](https://hiyori-schedule.com/help)

Web ブラウザからすぐに利用できます。自分で運用したい方向けに、Cloudflare Workers で動くソースコードも公開しています。

## 主な機能

- **イベント作成・編集**：タイトル、説明、所要時間、候補日時、回答締切を設定できます。
- **回答と集計**：候補ごとに `○ / △ / ×` で回答し、参加者ごとの回答と候補ごとのスコアを確認できます。曜日・時間帯で絞った一括入力にも対応しています。
- **開催日の確定・取消**：主催者が集計から候補を選び、複数の日程を確定することもできます。
- **公開・招待限定**：公開イベントには表示名だけのゲスト回答が可能です。招待限定イベントは主催者と招待された Discord アカウントだけが閲覧・回答できます。招待には Discord のユーザー名を使います。
- **Discord 通知**：Bot の `/hiyori new` からチャンネルに連携した公開イベントは、確定時にそのチャンネルへ通知します。
- **カレンダー連携**：確定日を `.ics` ファイルで追加できます。Webcal を購読すると、自分が参加または主催する公開イベントの有効な確定日がカレンダー側の更新に合わせて反映されます。

**招待限定イベントは、公開 Discord 通知・公開 Webcal フィードの対象外です。** 個別の `.ics` は閲覧権限のあるログイン済みユーザーが取得できます。

## 使い方

1. [Hiyori](https://hiyori-schedule.com) で Discord にログインし、イベントを作成します。Discord 通知を使う場合は、Bot をサーバーに追加し、通知先チャンネルで `/hiyori new` を実行したリンクから作成します。
2. 候補日時と公開範囲を設定し、参加者にイベントの URL を共有します。招待限定の場合は相手の Discord ユーザー名も登録します。
3. 参加者が `○ / △ / ×` で回答します。ゲスト回答は公開イベントの Web 画面で利用できます。招待限定への参加には Discord ログインが必要です。
4. 主催者が集計を確認して開催日を確定します。参加者は `.ics` のダウンロードや、公開イベント向けの Webcal 購読を利用できます。

招待の受取り・取消やカレンダーの詳しい条件は、[利用ガイド](docs/usage.md)を参照してください。

## CLI・ChatGPT / Claude との連携

### CLI

端末からイベント、回答、集計、確定、招待、Webcal 購読を操作できます。以下はリポジトリからビルドする手順です。Node.js / pnpm の要件は[ローカル開発](#ローカル開発)と共通です。

```bash
git clone https://github.com/A-1ro/hiyori.git
cd hiyori
pnpm install --frozen-lockfile
pnpm -C cli build

node cli/dist/index.js --api-url https://hiyori-schedule.com login
node cli/dist/index.js --api-url https://hiyori-schedule.com event list --json
node cli/dist/index.js --api-url https://hiyori-schedule.com busy
```

`busy` は引数なしで、自分が参加したイベントの確定済み開始日時を返します。CLI の既定 API URL はプレースホルダーなので、上のように接続先を明示してください。設定の保存、各コマンド、招待管理は [CLI README](cli/README.md) にまとめています。

### ChatGPT / Claude（MCP）

リモート MCP を追加できるクライアントでは、接続先に **`https://hiyori-schedule.com/mcp`** を指定し、Discord ログインとアクセス許可を行います。読み取りと書き込みの権限は別で、作成・回答・確定などには書き込み権限が必要です。

利用可能な接続設定はクライアント・プラン・組織設定によって異なります。[MCP 接続ガイド](docs/integrations.md)で接続の流れ、操作範囲、セルフホスト時の条件を確認してください。

## ローカル開発

Hiyori は単一の Cloudflare Worker で Web 画面・API・静的ファイルを配信します。主な構成は Hono、React 19、Vite 8、Cloudflare D1、Drizzle ORM、nanoka、Tailwind CSS v4 です。

必要な環境は **Node.js 22.22.2 以降の 22.x、24.15.0 以降の 24.x、または 26 以降**と **pnpm 10.33.2** です。`package.json` と CI の検証対象に合わせています。

```bash
# リポジトリルートで実行
pnpm install --frozen-lockfile
# .dev.vars の設定は docs/development.md を参照
pnpm db:migrate:local
pnpm dev
```

初回はコミット済みの migration をローカル D1 に適用します。`pnpm db:generate` はモデル定義を変更したときに使います。Discord 認証の設定、D1 / `OAUTH_KV` の用意、セルフホスト、検証コマンドは[開発ガイド](docs/development.md)を参照してください。

## 詳細資料・貢献

| 資料 | 内容 |
|---|---|
| [利用ガイド](docs/usage.md) | 招待限定イベント、Discord 通知、ICS / Webcal の条件 |
| [CLI README](cli/README.md) | ローカルビルド、接続先設定、コマンドと招待管理 |
| [MCP 接続ガイド](docs/integrations.md) | ChatGPT / Claude 連携、権限、操作範囲 |
| [開発ガイド](docs/development.md) | ローカル開発、セルフホスト、技術構成、コマンド |
| [環境変数一覧](docs/environment.md) | Discord・MCP・運営用設定とシークレット |
| [Discord Bot 構築](docs/discord-bot.md) | 自分の Application / Bot の設定とコマンド登録 |
| [運用マニュアル](docs/ops.md) | フィードバック API、お知らせ投稿、トークン管理と緊急対応 |
| [製品仕様](docs/requirements.md) | 製品判断、データモデル、設計上の決定事項 |
| [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) | 開発時の規約とアーキテクチャ上の注意 |
| [MCP 設計資料](docs/plans/2026-07-21-mcp-server.md) / [OAuth 移行資料](docs/oauth-provider-migration.md) | 設計の経緯と互換性に関する記録 |

不具合や改善案は [Issues](https://github.com/A-1ro/hiyori/issues) へ、変更提案は Pull Request で受け付けています。開発前に `AGENTS.md` と製品仕様を確認し、変更に関係する Web / API / CLI / MCP と検証を揃えてください。サービス内のフィードバックフォームからも報告できます。認証情報や個人の予定は Issue・PR・画像に含めないでください。

## ライセンス

[MIT License](LICENSE) © 2026 A-1ro
