# 企画: Hiyori MCP サーバー（リモート / Cloudflare Workers・CLI 同等フル）

- 作成日: 2026-07-21
- ステータス: 企画（承認待ち）
- 種別: AI 連携 第2弾（第1弾 = `hiyori` CLI）
- 関連: `docs/requirements.md`（プロダクト決定）、`CLAUDE.md`（CLI 認証基盤 / Discord OAuth / device-code フロー）

---

## 1. 概要

Hiyori（Discord 連携の日程調整ツール・単一 Cloudflare Worker・OSS/セルフホスト容認）に、**リモート型 MCP サーバー**を追加する。CLI（`hiyori`）と同じ操作を **AI アシスタント（Claude 等の MCP クライアント）から直接** 呼べるようにして、日程調整の裾野を「端末に CLI を入れられる技術者」から「AI に日本語で頼める全員」へ広げる。

トランスポートは **リモート（Workers 上の Streamable HTTP）で確定**。ローカル stdio 型だと結局 CLI と同じ層の人しか使えず MCP 化の旨味が薄い。リモートなら **インストール不要・URL を貼るだけで接続** でき、対象が最大化する。ツール範囲は **CLI 同等フル**（作成 / 編集 / 一覧 / 取得 / 候補追加削除 / 投票 / 集計 / 確定 / ics / カレンダー購読）。

実装は **Hiyori 本体と同じ Worker に相乗り**し、**env で有効化する任意機能**として提供する（セルフホスターが自分のインスタンスで on/off できる）。**費用は 0 円**（新規課金リソースなし・Cloudflare 無料枠内）。

---

## 2. 課題と狙い（ユーザーストーリー）

### 誰のどんな問題

- **これまで**: Hiyori を使うには Web UI を開くか、`hiyori` CLI をインストールしてログインする必要があった。CLI は速いが技術者向けで、しかも npm 未公開。
- **これから**: すでに Claude 等の AI アシスタントを日常使いしている人が、**チャットの流れのまま日程調整を完了**できる。

### ユーザーストーリー

> 「来週の飲み会、金土日の夜で候補出して日程調整して」
> → AI が `hiyori_create_event`（候補3件）を呼び、共有 URL を返す
> → 「メンバーに配って」→ ユーザーが URL を Discord に貼る
> → 数日後「集計どう？」→ AI が `hiyori_tally` で ○×表を要約
> → 「一番いい日で確定して」→ AI が `hiyori_confirm` → `.ics` 購読リンクを案内

- **read 系**（一覧・詳細・集計・busy・購読一覧）は「今どうなってる？」の即答に効く。
- **write 系**（作成・投票・確定）は「やっといて」を実行に移す。

### CLI との棲み分け

| | CLI (`hiyori`) | MCP サーバー（本企画） |
|---|---|---|
| 対象 | 端末を持つ技術者 | AI アシスタント利用者全般 |
| 導入 | npm インストール + `hiyori login` | クライアントに URL を貼るだけ |
| 認証 | device-code → Bearer（`~/.config`） | MCP OAuth（Discord 上流） |
| 操作 | 人間がコマンドを打つ | AI が自然言語から呼ぶ |
| 実体 | 同じ Hiyori API を叩く | **同じ Hiyori API を叩く**（裏は共通） |

CLI と MCP は**同じ Hono API の別フロントエンド**。ロジック本体は増やさない。

---

## 3. スコープ

### MVP でやること（= 企画上は CLI フル同等）

CLI の全実行コマンドを MCP ツールへ写像する（§4）。認証は Discord ユーザーとして。read/write のスコープ分離。

### やらないこと

- **ゲスト投票**（表示名だけの匿名投票）。MCP は常に「認証済み Discord ユーザー」として動く。ブラウザの `guestToken` cookie 前提の匿名フローは MCP に持ち込まない（CLI も非対応）。
- **Discord チャンネル連携付きのイベント作成**。`discordChannelToken` は `/hiyori new` スラッシュコマンド起点でしか発行されない設計（cross-tenant 投稿防止）。MCP で作るイベントは CLI 同様「チャンネル未連携」。連携したいときは Discord の `/hiyori new` から。
- **設定/認証の CLI サブコマンド**（`login` / `logout` / `config get|set`）。これらは接続・認証の plumbing で、MCP ではクライアント側 OAuth と接続 URL が肩代わりするためツール化しない。
- MCP の **Resources / Prompts**（今回は Tools のみ。将来 read 系を Resource 化する余地はあるが MVP 外）。

---

## 4. MCP ツール一覧（CLI ↔ MCP 対応表）

`hiyori_*` プレフィックスで命名。裏で叩く既存 API と必要権限を明記。

### 認証 / プロフィール

| MCP ツール | 対応 CLI | 叩く API | 権限 | 入力 → 出力（概要） |
|---|---|---|---|---|
| `hiyori_whoami` | `whoami` | `GET /api/auth/me` | 認証必須 | なし → `{ discordUserId, displayName, ... }` |

（`login` / `logout` / `config` はツール化しない。§3 参照）

### イベント CRUD

| MCP ツール | 対応 CLI | 叩く API | 権限 | 入力 → 出力 |
|---|---|---|---|---|
| `hiyori_list_events` | `event list` | `GET /api/me/events` | 認証必須 | なし → `{ organized[], participating[] }` |
| `hiyori_get_event` | `event show` | `GET /api/events/:id` + `/permissions` | 公開読取（+任意で認証） | `{ eventId }` → `{ event, candidates[], isOrganizer }` |
| `hiyori_create_event` | `event create` | `POST /api/events` | 認証必須（作成者=主催者） | `{ title, defaultDurationMinutes, candidates[{startAt}], description?, deadline?, timezone? }` → `{ event, candidates[] }` |
| `hiyori_edit_event` | `event edit` | `PATCH /api/events/:id` | **主催者のみ** | `{ eventId, title?, description?, deadline?(null で解除), defaultDurationMinutes?, timezone? }` → `{ event }` |
| `hiyori_delete_event` | `event rm` | `DELETE /api/events/:id` | **主催者のみ** | `{ eventId }` → `{ ok }`（**破壊的**・確認注釈） |

### 候補（日時スロット）

| MCP ツール | 対応 CLI | 叩く API | 権限 | 入力 → 出力 |
|---|---|---|---|---|
| `hiyori_add_candidate` | `candidate add` | `POST /api/events/:id/candidates` | **主催者のみ** | `{ eventId, startAt, endAt? }` → `{ candidate }` |
| `hiyori_remove_candidate` | `candidate rm` | `DELETE /api/events/:id/candidates/:candidateId` | **主催者のみ** | `{ eventId, candidateId }` → `{ ok }`（破壊的） |

### 投票 / 集計

| MCP ツール | 対応 CLI | 叩く API | 権限 | 入力 → 出力 |
|---|---|---|---|---|
| `hiyori_get_my_votes` | (`vote` 内部) | `GET /api/events/:id/votes/me` | 認証必須 | `{ eventId }` → `{ votes[] }` |
| `hiyori_vote` | `vote` | 必要時 `POST /api/events/:id/participants` → `PUT /api/events/:id/votes` | 認証必須（参加者として自己登録） | `{ eventId, votes: [{candidateId, choice: yes\|no\|maybe}] }` → `{ votes[] }` |
| `hiyori_tally` | `tally` | `GET /api/events/:id/tally` | 公開読取 | `{ eventId }` → `{ candidates[], participants[], matrix }` |

### 確定 / カレンダー配布

| MCP ツール | 対応 CLI | 叩く API | 権限 | 入力 → 出力 |
|---|---|---|---|---|
| `hiyori_confirm` | `confirm` | `POST /api/events/:id/decision` | **主催者のみ** | `{ eventId, candidateIds[] }` → `{ decision }` |
| `hiyori_unconfirm` | `unconfirm` | `DELETE /api/events/:id/decision` | **主催者のみ** | `{ eventId }` → `{ ok }` |
| `hiyori_get_ics` | `ics` | `GET /api/events/:id/decision.ics` | 公開読取（確定済み） | `{ eventId }` → `{ icsText }`（text/calendar 本文） |

### 個人カレンダー / 購読

| MCP ツール | 対応 CLI | 叩く API | 権限 | 入力 → 出力 |
|---|---|---|---|---|
| `hiyori_my_busy` | `busy` | `GET /api/me/busy` | 認証必須 | なし → `{ busy[] }` |
| `hiyori_list_subscriptions` | `sub list` | `GET /api/me/subscriptions` | 認証必須 | なし → `{ subscriptions[] }` |
| `hiyori_add_subscription` | `sub add` | `POST /api/subscriptions` | 認証必須 | なし → `{ subscription, webcalUrl }` |
| `hiyori_remove_subscription` | `sub rm` | `DELETE /api/subscriptions/:id` | 認証必須（本人分） | `{ subscriptionId }` → `{ ok }`（破壊的） |
| `hiyori_regen_subscription` | `sub regen` | `POST /api/subscriptions/:id/regenerate` | 認証必須（本人分） | `{ subscriptionId }` → `{ subscription, webcalUrl }` |

### 棚卸しサマリ

- **CLI leaf コマンド総数: 22**（login, logout, whoami, config get, config set, event list/show/create/edit/rm, candidate add/rm, vote, tally, busy, ics, confirm, unconfirm, sub list/add/rm/regen）。
- うち **plumbing 4 個**（login / logout / config get / config set）はツール化しない。
- 残り 18 コマンドを写像 → **MCP ツール 18 個**。加えて内部利用の `get_my_votes` を明示ツール化して **合計 19 ツール**（フル同等 + 補助 1）。
- 権限内訳: **主催者限定 write = 6**（edit / delete / candidate add / candidate rm / confirm / unconfirm）、**認証必須 = 10**、**公開読取 = 3**（get_event / tally / get_ics）。
- 破壊的操作 = 4（delete_event, remove_candidate, remove_subscription, unconfirm）→ `destructiveHint` 注釈 + 実行前サマリ返却。

---

## 5. ★認証設計（最重要）

「リモート MCP で、AI が**誰として**操作するか」を決める部分。Hiyori には既に 3 系統の認証がある:

1. **Discord OAuth2 + セッション cookie**（Web・`src/server/auth/`）
2. **CLI device-code フロー（RFC 8628）→ `kind:'cli'` Bearer トークン**（`~/.config/hiyori`, 90 日 TTL）
3. **ゲスト投票**（`guestToken` cookie・表示名のみ・ブラウザ限定）

MCP クライアント（Claude 等）が期待するのは **MCP Authorization 仕様 = OAuth 2.1（authorization code + PKCE + 動的クライアント登録）** で、上記のどれとも直結しない。ここをどう繋ぐかで実装の成否が決まる。以下 3 案 + 推奨。

### 案 A（推奨）: `workers-oauth-provider` を MCP 向け OAuth 2.1 プロバイダにし、上流 IdP に既存 Discord OAuth を再利用

- Cloudflare 公式の [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) で Worker 自身を **MCP クライアントに対する OAuth 2.1 プロバイダ**にする。`/authorize` `/token` `/register`（動的登録）を提供し、発行したアクセストークン/グラントは **KV（`OAUTH_KV`）**に保存。
- ログイン画面（provider の `defaultHandler`）は **既存の Discord OAuth に委譲**する。`src/server/auth/discord.ts` の `buildAuthorizeUrl` / `exchangeCodeForToken` / `fetchDiscordMe` をそのまま再利用 → ユーザーはいつもの Discord 認可画面を見るだけ。
- 認可完了後、Discord ユーザー情報が McpAgent の **`props`**（`{ discordUserId, displayName, ... }`）に入り、各ツールは「誰として動くか」を props から得る。
- **既存認可ロジックの再利用**: ツール実装は props の discordUserId に対して **`kind:'mcp'` の短命セッションを 1 つ発行**し（既存 `Session` モデル + `loadSession` の Bearer 経路に相乗り）、**既存の `/api/*` ハンドラを `Authorization: Bearer` で内部呼び出し**する。これにより `isOrganizer` 判定・入力バリデーション・レート制限など**サーバー側の認可を一切二重実装しない**（CLI が Bearer で叩くのと同じ経路）。
- **read/write スコープ分離**: MCP スコープ `hiyori:read` / `hiyori:write` を定義。read 系ツールは read、write 系は write を要求。クライアントは登録時にスコープ申請し、**ユーザーは同意画面でどこまで許すか確認**できる（例: 「読み取りだけ許可」）。破壊的ツールは write + `destructiveHint`。
- **ゲスト**: MCP からは扱わない（§3）。常に Discord ユーザーとして動く。
- **濫用対策（Rate Limit）**: 既存の Rate Limiting binding を流用し、**IP ではなく `props.discordUserId` をキー**にした MCP 用リミットを追加（AI は同一 IP から大量に叩きうるため）。write / 破壊的操作は低め。
- **トークン保管 / 失効**: MCP アクセス/リフレッシュトークンは `OAUTH_KV` に TTL 付き保存。ユーザーは MCP クライアント側で接続解除 → provider の revoke で失効。上流 Discord セッションとは独立。`kind:'mcp'` セッションも短命 TTL + 失効可能に。

**メリット**: MCP ネイティブの「URL 貼るだけ → Discord でログイン → 同意」の体験。既存 Discord OAuth と認可ロジックを最大限再利用。スコープ同意で権限事故を抑止。
**デメリット**: OAuth provider の配線が最も重い。動的登録・同意画面・KV グラント管理の実装とテストが要る。

### 案 B: 既存 CLI device-code トークンを MCP ヘッダに貼る（Bearer パススルー）

- ユーザーが `hiyori login`（既存 device-code）で `kind:'cli'` トークンを取得し、MCP クライアントの接続設定に `Authorization: Bearer <token>` として貼る。サーバーは既存 `loadSession` の Bearer 経路でそのまま認証。
- **メリット**: 既存フローを 100% 再利用。OAuth provider 不要で**最小実装**。ツール本体を先に固められる。
- **デメリット**: MCP ネイティブの認証 UX（OAuth ディスカバリ）ではなく、静的ヘッダ対応クライアントに限られる。トークンが設定ファイルに平文。スコープ同意なし。「インストール不要・URL だけ」の売りを削ぐ（結局 CLI ログインが要る）。
- **位置づけ**: **本命ではない**が、**Phase 1 でツール群を先行実装・検証するためのブートストラップ**として有用。OAuth（案 A）が乗るまでの繋ぎ / パワーユーザー向けの補助経路として残す判断もあり。

### 案 C: Cloudflare Access（Zero Trust）を `/mcp` の前段に置く

- Access が MCP クライアントに OAuth を提供し、運用者が IdP（メール等）を設定。公式にサポートされた構成（`remote-mcp-cf-access`）。
- **メリット**: 実装が最小・堅牢。
- **デメリット**: 認証が**運用者の Zero Trust 組織とメール許可リスト**に紐づく。「1 Bot を任意の Discord サーバーに招待、誰でも Discord さえあれば使える」というマルチテナント / OSS の前提と噛み合わない。**公開インスタンスには不適**。
- **位置づけ**: **鍵をかけた私用セルフホスト向けの選択肢**としてのみ有効。README に「社内限定運用なら Access 前段でも可」と併記。

### 推奨

**案 A を製品パスとする**（Discord 上流 + `workers-oauth-provider`、スコープ分離、既存 API を Bearer 内部呼び出しで再利用）。実装のリスク低減として、**Phase 1 では案 B（Bearer パススルー）でツール群を先に完成・検証** → **Phase 2 で案 A の OAuth を被せて「URL 貼るだけ」体験に引き上げる**、の二段構えを推奨する。案 C はセルフホスト（社内限定）向けオプションとして文書化のみ。

---

## 6. 技術構成（Cloudflare 上）

### リモート MCP の実装手段（現行の Cloudflare 推奨）

- **Agents SDK の `McpAgent` クラス**（`agents/mcp`）+ `@modelcontextprotocol/sdk` の `McpServer`。`McpAgent.serve("/mcp")` で **Streamable HTTP** トランスポートの Worker ハンドラを生成（公式に「最も簡単・約 15 行」）。
- 認証は **`workers-oauth-provider`** と統合。`props` に認証済みユーザー情報が渡る（§5 案 A）。
- `McpAgent` は内部で **Durable Object**（SQLite バックエンド）を 1 つ使う（セッション/状態・トランスポート）。→ Hiyori 本体に **初めて DO を追加**する点に注意（wrangler に DO binding + migration）。

### 同一 Worker に相乗り（推奨）/ 別 Worker

**推奨: 既存 Hiyori Worker に相乗り。** `workers-oauth-provider` は既存 Hono アプリを **`defaultHandler`** に、MCP を **`apiHandler`（`/mcp`）** に据えて合成できる:

```
export default new OAuthProvider({
  apiHandlers: { '/mcp': HiyoriMCP.serve('/mcp') },
  defaultHandler: honoApp,          // 既存 SSR + /api/* + Discord OAuth
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})
```

- D1・models・Discord OAuth・secrets を**そのまま共有**でき、`/mcp` ツール → 内部 `/api/*` 呼び出しが同一 Worker 内で完結。
- 追加物: **`OAUTH_KV` namespace**、**DO クラス（McpAgent）+ migration**、MCP 用 **Rate Limit binding**、feature フラグ（`MCP_ENABLED` 等）。
- **別 Worker 案**（Service Binding で Hiyori API を呼ぶ）は分離度は上がるが、env/secrets 二重化と 1 ホップ増を招く。DO を本体に入れたくない特別な理由がなければ相乗りが素直。

### 構成図（テキスト）

```
Claude / MCP クライアント
   │  Streamable HTTP + OAuth 2.1 (PKCE, dynamic registration)
   ▼
[ Hiyori Worker（単一） ]
   ├─ OAuthProvider（workers-oauth-provider）
   │     ├─ /authorize /token /register … MCP 向け OAuth
   │     │     └─(上流)→ Discord OAuth（既存 buildAuthorizeUrl/exchange/fetchMe）
   │     ├─ grants/tokens ─────────────→ [ KV: OAUTH_KV ]
   │     ├─ apiHandler  /mcp → HiyoriMCP (McpAgent/DO, SQLite)
   │     │     └─ 各 hiyori_* ツール → props.discordUserId で kind:'mcp' セッション発行
   │     │            → 内部 fetch /api/*（Bearer）→ 既存 authz/バリデーション/レート制限
   │     └─ defaultHandler → 既存 Hono（SSR + /api/* + Web Discord OAuth）
   ├─ [ D1: hiyori ]（events / candidates / participants / votes / sessions / subscriptions …）
   └─ Rate Limit binding（CLI_AUTH_RATELIMIT + MCP 用を追加, key=discordUserId）
```

---

## 7. OSS / セルフホスト整合

- **独自インフラ非依存**。ひなた側の資産（ポータル等）には一切依存しない。使うのは Cloudflare の一次プリミティブ（Workers / D1 / KV / DO / Rate Limit）のみ。
- **env で完結・任意機能**。MCP は `MCP_ENABLED`（+ `OAUTH_KV` binding の有無）でゲート。**未設定なら MCP 機能は無効**（`/mcp` は 404/503）。Discord チャンネル連携が secret 未設定で無効になる既存作法（`DISCORD_CHANNEL_TOKEN_SECRET`）と同じ流儀。
- セルフホスターの手順は「①`wrangler kv namespace create OAUTH_KV` して**返ってきた id を `wrangler.jsonc` の `OAUTH_KV` binding に貼る**（D1 の `database_id` と同じ運用。`wrangler deploy` は `MCP_ENABLED=false` でも binding の id を検証するため、他アカウントでは差し替え必須）②DO migration 適用 ③（Discord OAuth App は Hiyori 運用に元々必要なので流用）④deploy」だけ。**運用者の Discord OAuth App がそのまま MCP の上流 IdP** になる。
- 社内限定運用者向けに、案 C（Cloudflare Access 前段）を README のオプションとして併記。

---

## 8. 費用と収支計画

**費用: なし（Cloudflare 無料枠内で完結）。** 収益を目的にしないインフラ機能のため収支表は非対象。0 円の根拠と前提:

| リソース | 用途 | 無料枠 | 本機能の想定 |
|---|---|---|---|
| Workers | 実行 | 100,000 req/日 | 既存 Worker に相乗り。MCP 呼び出しは既存枠内 |
| Durable Objects（SQLite） | McpAgent 状態/トランスポート | **Free プランで利用可**・5M rows read/日, 100k rows written/日, 5GB。**Free プランはストレージ課金対象外** | セッション状態のみ。極小 |
| KV（`OAUTH_KV`） | OAuth グラント/トークン | 100k reads/日, 1k writes/日, 1GB | トークン発行/更新は低頻度。小規模なら余裕 |
| D1 | 既存 DB | 5M rows read/日, 100k written/日 | 既存イベント/投票。MCP 経由でも同枠 |
| Rate Limit binding | 濫用対策 | 無料 | — |

- **新規に課金が必要なリソースは無し。** DO は 2025-04 に Free プラン提供開始、SQLite ストレージ課金（2026-01 開始）も **Free プランは対象外**（本文の一次情報で確認済み）。
- **前提条件（無料枠の境界）**: ① Workers Free の 100k req/日。② DO の 100k rows written/日・KV の **1k writes/日**が実質の上限になりやすい（OAuth トークン更新が書き込みを消費）。→ **想定は個人〜小コミュニティ規模のセルフホスト**。大量ユーザーが張り付くと KV writes / DO writes が先に効く。
- **超えるとき**: Workers Paid（$5/月）に上げれば桁が変わる。**本企画は 0 円前提なので、有料化が要るスケールに達したら別途承認フロー**（ワークスペース絶対ルール 2）。現時点で有料要素は無く、**この企画の実装自体は 0 円**。

---

## 9. リスクと撤退ライン

| リスク | 影響 | 緩和 |
|---|---|---|
| MCP 仕様 / Authorization 仕様の変動 | 実装が陳腐化 | Agents SDK / `workers-oauth-provider` に追従（公式が吸収）。薄く保つ |
| OAuth provider 配線の複雑さ | Phase 2 が重い | Phase 1 を案 B（Bearer）で先行しツールを固める。OAuth は独立して被せる |
| **権限事故**（AI が他人/意図しないイベントを操作） | データ破損・信頼失墜 | サーバー側 `isOrganizer` 判定を**再利用**（二重実装しない）。write/read スコープ同意。破壊的ツールに `destructiveHint` + 実行前サマリ |
| **プロンプトインジェクション**（AI が誘導され削除等を実行） | 破壊的操作の誤発火 | 既定は read スコープ。write は明示同意。破壊系は確認注釈。レート制限 |
| KV writes / DO writes 1k〜100k/日の無料枠 | 規模拡大で頭打ち | 小規模前提を明記。超過は有料化を別承認 |
| DO を本体 Worker に初導入 | 運用面の新要素 | migration とロールバック手順を整備。feature フラグで無効化可能 |
| ゲスト/Discord チャンネル連携が MCP 非対応 | 一部ユースケース欠落 | §3 で明示。CLI と同じ制約。将来課題 |

**撤退ライン**: 費用は 0 円なので金銭的撤退ラインは無い。技術的撤退ラインは「案 A の OAuth 配線が Phase 2 で見合わない工数になった場合 → 案 B（Bearer）止まりで確定し、リモート URL 体験は見送る」。機能フラグで無効化すれば本体に影響を残さず撤収できる。

---

## 10. 実装ステップ（Phase 分け）と受け入れ条件

**企画はフル同等・実装はコアから段階化。**

### Phase 0: 足場（DO / MCP スケルトン）
- Agents SDK 導入、`McpAgent` サブクラス + `serve('/mcp')`、DO binding / migration、`MCP_ENABLED` フラグ。
- ツールは `hiyori_whoami` 1 個だけ動く状態。認証は暫定で **案 B（Bearer パススルー）**。
- **受け入れ**: MCP Inspector / Workers AI Playground から `/mcp` に接続でき、Bearer で `hiyori_whoami` が本人を返す。既存 Web / CLI に影響なし（フラグ off で完全に不可視）。

### Phase 1: コア日程調整 + read（案 B 認証のまま）
- ツール: `list_events` / `get_event` / `tally` / `create_event` / `vote` / `get_my_votes` / `confirm` / `get_ics`。
- 各ツール → 既存 `/api/*` を内部 Bearer 呼び出し。スキーマ（zod）と `destructiveHint` 整備。
- **受け入れ**: 「候補作成 → 投票 → 集計 → 確定 → ics」の一連が MCP クライアントから完走。主催者限定操作が非主催者で 403。全ツールに単体/統合テスト（既存 CLI テストと同水準）。

### Phase 2: OAuth 化（案 A）+ 残りフル同等ツール
- `workers-oauth-provider` 導入、Discord 上流連携、`/authorize` `/token` `/register`、`hiyori:read`/`hiyori:write` スコープ、同意画面、`OAUTH_KV`、`kind:'mcp'` 短命セッション発行、`props` 経由の本人特定、MCP 用 Rate Limit（key=discordUserId）。
- 残りツール: `edit_event` / `delete_event` / `add_candidate` / `remove_candidate` / `unconfirm` / `my_busy` / `list/add/remove/regen_subscription`。
- **受け入れ**: MCP クライアントが URL 指定のみで接続 → Discord ログイン → スコープ同意 → 全 19 ツールが本人権限で動作。read 同意のみのクライアントで write 系が拒否。トークン失効が効く。レート制限が discordUserId で効く。

### Phase 3: セルフホスト整備 / ドキュメント
- README に有効化手順（KV 作成・migration・env）と接続方法（クライアント別）を追記。案 C（Access 前段）併記。`requirements.md` にオープン項目を反映。
- **受け入れ**: まっさらなクローンから README だけで MCP を有効化・接続できる。フラグ off がデフォルト。

---

## 11. 承認のお願い

本企画は **Cloudflare 無料枠内・費用 0 円**（新規課金リソースなし）で、Hiyori 本体・OSS/セルフホストの設計思想を崩さずに実装できます。特に判断いただきたい論点:

1. **認証は「案 A（Discord 上流 OAuth）を本命 + 案 B（Bearer）で Phase 1 先行」の二段構え**で進めてよいか。
2. **同一 Worker 相乗り**（DO を Hiyori 本体に初導入）でよいか。分離したいなら別 Worker 案に切り替え可。
3. **スコープを read/write の 2 段**で十分か（もっと細かい per-tool 同意を求めるか）。
4. Phase 1 の**コア 8 ツール**の顔ぶれで日程調整体験として過不足ないか。

以上、承認いただければ Phase 0 → 1 から着手します（実装は独立リポ `projects/hiyori` 内、サブエージェント委譲で進行）。
