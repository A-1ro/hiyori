# サイト内エージェントと既存22ツール

`src/server/tools/hiyori-tools.ts`をMCPとサイト内エージェントで共有する。MCPのOAuth scope、CLIの確認、RESTの入力・業務権限は変更しない。Web用の会話・確認UIとその補助APIはサイト内セッションに限定するため、別のCLIチャットコマンドやOAuthクライアントは新設しない。CLIからは既存の業務コマンドを利用できる。

| 共通ツール | 分類 | 既存REST / CLIの操作 | サイト内エージェントでの扱い |
|---|---|---|---|
| `hiyori_whoami` | read | 本人情報 / whoami | 接続確認。モデルには認証済みかだけ |
| `hiyori_list_events` | read | 自分のイベント一覧 / event list | 認可後アプリ内に一覧、本人が対象選択。他イベント名をモデルへ流さない |
| `hiyori_get_event` | read | イベント詳細 / event show | 選択対象の名前・候補・タイムゾーンだけモデルへ。主催者判定はサーバー |
| `hiyori_get_my_votes` | read | 自分の回答 / voteの既存回答取得 | 選択対象の本人の○△×だけモデルへ。コメントはアプリ内 |
| `hiyori_tally` | read | 集計 / tally | 候補ごとの○△×人数だけモデルへ。個別回答・参加者名は送らない |
| `hiyori_get_ics` | read | 個別ICS / ics | アプリ内でダウンロード。本文をモデルへ送らない |
| `hiyori_list_invites` | read | 主催者の招待一覧 / invite list | 主催者だけアプリ内で対象選択。招待先をモデルへ返さない |
| `hiyori_my_busy` | read | 本人の確定済み予定 / busy | アプリ内表示。他イベント情報をモデルへ返さない |
| `hiyori_list_subscriptions` | read | 本人の購読一覧 / sub list | アプリ内で購読選択。ID・URLをモデルへ返さない |
| `hiyori_create_event` | write | 新規作成 / event create | 作成の明示意図→全候補・公開範囲等を確認→本人送信。互換の場合は既存フォームへの下書き受渡しも可 |
| `hiyori_vote` | write | 本人回答・回答変更 / vote | 対象確認→既存回答・候補→○△×・コメント→確認→本人送信 |
| `hiyori_confirm` | write | 主催者の確定 / confirm | 候補・通知／配信への影響を確認して本人送信 |
| `hiyori_unconfirm` | write | 主催者の確定取消 / unconfirm | 対象・通知／配信への影響を確認して本人送信 |
| `hiyori_edit_event` | write | 主催者の基本情報編集 / event edit | 変更項目・公開範囲を確認して本人送信 |
| `hiyori_add_candidate` | write | 主催者の候補追加 / candidate add | 対象・日時を確認して本人送信 |
| `hiyori_remove_candidate` | write | 主催者の候補削除 / candidate rm | 対象日時・回答の削除を確認して本人送信 |
| `hiyori_add_invite` | write | 主催者の招待追加 / invite add | ユーザー指定のDiscordユーザー名を確認して本人送信。モデルによる相手の検索なし |
| `hiyori_revoke_invite` | write | 主催者の招待取消 / invite revoke | アプリ内一覧で対象確認。確認時も最新の招待と認可を検証 |
| `hiyori_delete_event` | write | 主催者の削除 / event rm | 回答を含む削除・復元不可を確認して本人送信 |
| `hiyori_add_subscription` | write | 本人の購読発行 / sub add | 確認して本人送信。新URLはアプリ内だけで表示 |
| `hiyori_remove_subscription` | write | 本人の購読削除 / sub rm | 選択購読・旧URL無効化を確認して本人送信 |
| `hiyori_regen_subscription` | write | 本人の購読再生成 / sub regen | 選択購読・旧URL無効化を確認して本人送信。新URLはモデルへ返さない |

readは9、writeは13。モデルへのツール提示は会話の意図・選択対象・主催者権限で絞る。モデルが指定したツール名・引数は未信頼であり、共通schemaと対象／候補の別名対応を検証する。モデルのwrite呼出しは確認カードを準備するだけ。画面で本人が明示送信した署名付き・期限内・未使用の確認だけが実APIを呼ぶ。更新APIは最終の認可・業務検証を再実施する。

招待先・購読・他イベントをモデルに読み込ませる拡張は未承認であり、この実装も送らない。現在は必要な一覧・対象選択をアプリ内に表示して同じ共通処理を使う。機能そのものをリンク案内だけに縮めない。

## 検証の区別

- 22ツールのMCP契約・read/write scopeは既存のローカル回帰テストで検証する。
- Webでは既存セッション・Origin・本人一致・CLIセッション拒否、回答の実API到達、確認前の非更新、改ざん／再送／古い対象／非主催者拒否をローカルD1 fixtureで検証する。
- 実モデルの合成試験は追加20回で終了。モデル単体の選択・返答と、アプリ内の確認・認可テストは別の証拠である。記録は `docs/design/hiyori/agent-synthetic-results.json`。
- 実ユーザーの既存イベントへの投票・招待・確定・通知を試験目的では実行していない。認証付き公開e2eの全経路、実機Safari・読み上げは未検証。コード／モック／モデル単体の成功で全体完了とはしない。

公式根拠：[モデルschema](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)、[traditional function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/traditional/)、[料金](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[データ利用](https://developers.cloudflare.com/workers-ai/platform/data-usage/)。
