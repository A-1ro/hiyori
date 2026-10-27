# ﾋﾖﾘﾁｬﾝ

マイページのサイドパネルから使う、Hiyori専用AIエージェント。
Worker・Workers AI・既存D1で構成し、新しいDurable Object、WebSocket、常駐処理、待機中の定期ポーリングは追加しない。
既存のリモートMCP用Durable Objectは既存セッションの互換用に維持する。e2eの新規Streamable HTTP接続はDOを経由せず、同じツール登録簿を使う。Web・REST・CLIからのチャットもDOを呼び出さない。本番の外部MCPは従来のDO経路を維持する。

## モデルと実行

モデルは Workers AI の `@cf/qwen/qwen3.8-27b`。日本語の依頼理解とfunction callingを重視して選定し、日本語の予定確認から構造化ツール呼び出しが返ることを実モデルで確認した。
モデルの内部思考は表示・保存・ツール実行に使わず、構造化されたfunction callだけを処理する。

- [Cloudflareのモデル仕様](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)
- reasoning effortは`low`、出力上限は推論を含め4096トークン。
- 1送信は最大4回の推論、最大8回の通常の読み取りツール呼び出し。変更提案の表示用に、対象イベントを追加で1回取得することがある。
- 入力メッセージは4000文字、HTTP本文は16KiB。モデルへ送るJSONはツール定義を含め64,000バイトまで。
- モデルのコンテキストに入れる履歴は直近12メッセージ、合計16,000文字まで。ツール結果は1件12,000文字まで。
- 1送信は90秒で中断し、同一ユーザーの並行処理はD1の120秒リースで防ぐ。新しいDOは不要。別タブで処理中の場合や再接続時だけ3秒ごとに状態を取得し、リースの終了後は停止する。
- 出力上限到達や空の応答では失敗した会話を保存せず、入力を保持して同じ内容で再試行できるようにする。途中のツール呼び出しを確認待ちにしない。
- 自動再試行、定期推論、外部MCP URLの登録、モデルの自動切替は行わない。

`src/server/mcp/tools.ts` が既存MCPとエージェント共通の登録簿。
エージェントはMCP SDKの`InMemoryTransport`で同じスキーマ・ハンドラを呼び、既存のHono APIで認可・バリデーション・業務処理を行う。
認証情報はモデルに渡さず、新しい会話テーブルにも保存しない。
読み取りの自動実行は固定allowlistに限定し、書き込みはすべてユーザーの確認待ちにする。

## コスト上限

| 設定 | 既定値 | 意味 |
| --- | --- | --- |
| `HIYORICHAN_DAILY_CALLS` | 100 | Worker全体の1日あたり推論回数 |
| `HIYORICHAN_USER_DAILY_CALLS` | 20 | 1ユーザーの1日あたり推論回数 |
| `ASSISTANT_RATELIMIT` | e2eで10回/60秒 | ユーザー単位の会話・操作・履歴削除リクエスト数 |

日次枠はUTC 00:00（日本時間09:00）に切り替わる。回数は会話数ではなく、ツール利用後の追加推論も含む。
D1のトランザクション内で全体・個人の両カウンターを同時に予約し、並行リクエストでも上限を超えない。実行失敗分も返却しない。
回数と入出力の上限で推論量を制限するもので、ドル建ての請求上限ではない。Worker・D1・Workers AIの従量料金は別途発生する。
有効な設定値は1〜2000。未設定・不正値は上記の既定値を使う。利用を止める場合は`HIYORICHAN_ENABLED=false`にする。

## 会話と操作の保存

`assistant_conversations`に本人の直近40メッセージと確認待ちの操作1件を保存する。
ユーザーIDはサーバーがセッションから決め、他人の会話は参照・実行できない。
ブラウザからの書き込みは同一Originを必須とし、アカウント切替時の誤保存を`X-Hiyori-User`の一致条件で防ぐ。
UIは会話をlocalStorageに保存しない。

確認待ち操作は10分で失効する。確認時に送るのは操作IDとapprove/cancelだけで、保存した引数は差し替えられない。
実行直前に操作を消費してから既存APIを呼ぶため、二重クリックやHTTP再試行で変更を重複実行しない。
承認後もAPIが現在のセッション・主催者・招待・公開範囲を再確認する。
実行中に通信が切れた場合は、再実行する前にイベント一覧で状況を確認する。

会話は明示的に削除でき、30日以上未使用の会話は次回アクセス時に初期化し、日次枠の最初の利用時にも古い会話を削除する。
古い利用回数レコードは利用時に30日分へ整理する。
カレンダー購読URLなどのワンタイムの結果は承認リクエストの呼び出し元へ一度だけ返し、会話履歴・モデル入力には保存しない。

## Web / REST / MCP / CLI 対応表

| 操作 | Web | REST | MCP | CLI |
| --- | --- | --- | --- | --- |
| 相談 | サイドパネルの送信 | `POST /api/assistant/chat` | `hiyori_assistant_chat` | `assistant ask` |
| 履歴・確認待ち取得 | 会話表示 | `GET /api/assistant/history` | `hiyori_assistant_history` | `assistant history` |
| 確認した内容の実行 | この内容で実行 | `POST /api/assistant/actions/:id`、`decision=approve` | `hiyori_assistant_resolve` | `assistant approve` |
| 未実行の操作を取消 | 取り消す | 同上、`decision=cancel` | `hiyori_assistant_resolve` | `assistant cancel` |
| 会話削除 | ごみ箱 | `DELETE /api/assistant/history` | `hiyori_assistant_clear` | `assistant clear` |

MCPでは履歴取得がread、相談・実行・取消・削除がwriteスコープを要求する。
相談はイベント変更を自動実行しないが、AI利用枠を消費して会話を保存するためwriteとする。
外部MCPクライアントも、保存された操作名・引数をユーザーに示して明示承認を受けてからresolveを呼ぶ。
CLIのapprove/clearは非対話時に`--yes`が必須。JSONモードでも確認を暗黙に省略しない。

## e2e限定の公開

リポジトリでは本番の`HIYORICHAN_ENABLED=false`、named environment `e2e`だけtrue。
AI bindingもe2eのみに追加する。DO binding・DO migrationは追加しない。

```sh
pnpm build:e2e
pnpm exec wrangler deploy --env e2e --dry-run
# e2e専用DBのbinding名で指定する。位置引数に本番DB名 hiyori を指定しない。
pnpm exec wrangler d1 migrations apply DB --env e2e --remote
pnpm deploy:e2e
```

対象Workerは`hiyori-e2e`、DBは`hiyori-e2e`（`dfb132a9-0f57-4661-9830-f3295fc8c589`）、OAuth KVは`39d9cbf7472747d7aa3148e2fedd9993`。
確認URLは https://e2e.hiyori-schedule.com/me 。本番Worker・DB・KVへのデプロイやmigrationはこの作業の対象外。
