# Codex によるセキュリティ更新

Hiyori 用クラウド環境の Codex 定期タスクが、公式情報の収集、影響判定、修正、
検証、PR 作成を行う。マージと本番反映はレビュー後に別途行う。
この仕組みは Web／REST／MCP／CLI の製品機能を追加せず、開発作業を自動化する。

## 登録

1. この変更を `main` に取り込む。
2. クラウド環境の設定を確認・保存して Publish する。新規タスクでツールと
   ネットワークアクセスを再確認する。スナップショットに残ったプロセスに依存しない。
3. Codex の定期タスクとしてプロジェクト `A-1ro/hiyori`、このクラウド環境、
   `main` を選ぶ。推奨スケジュールは毎日 09:17（Asia/Tokyo）。
4. [タスク指示](security-task-prompt.md)の区切り線以降を登録し、一度手動実行する。

実行手順はリポジトリ内の
[hiyori-security-remediation スキル](../.agents/skills/hiyori-security-remediation/SKILL.md)
で管理する。定期タスク登録・有効化はアプリ側の操作であり、このファイルや
クラウド環境の設定を保存するだけでは予約実行されない。Actions の cron や
クラウド内の常駐 cron は追加しない。Codex 定期タスクは Codex の実行枠を使い、
追加の OpenAI API キーは要求しない。

## 前提と接続先

- リポジトリ指定の Node.js／pnpm、Ruby（既存の workspace 監査）、Python 3
  標準ライブラリ（RSS／Atom の構文解析）、Git、GitHub CLI、curl。
- `/workspace/.hiyori-tools/activate.sh` で用意済みツールを有効化する。
- GitHub の注入済み HTTPS Git 認証と `gh` 認証を利用する。必要な権限は
  リポジトリの読み取り・ブランチ push・PR 作成。Security アラートの読み取りは
  追加の確認範囲で、利用できなければその制約を報告する。
- 既存のパッケージ取得先に加え `api.github.com`、`blog.cloudflare.com`、
  `developers.cloudflare.com` への HTTPS アクセスが必要。`nodejs.org` と
  `registry.npmjs.org` も使用する。追加設定は既存の許可リストを維持して行う。
  ドラフト保存は実行中のネットワーク設定の反映や公開を意味しない。

シークレット値を指示・ファイル・ログに転記しない。Git の read が成功しても
GitHub API や push の権限を証明するものではない。API が拒否された場合は
接続先ポリシーと認証・認可を実際の操作に沿って診断する。

## 収集と影響判定

```bash
source /workspace/.hiyori-tools/activate.sh
cd /workspace/hiyori
node scripts/security-intake.mjs --output /tmp/hiyori-security-UNIQUE.json
```

出力先には毎回新しい名前を使う。既存の報告は上書きしない。報告はローカルの
一時ファイルに保持し、認証情報やアプリの利用者データは収集しない。

| 情報源 | 収集内容 |
| --- | --- |
| npm の advisory API | 全 workspace の lockfile。直接・推移・開発・任意依存 |
| GitHub Advisory Database | 全ページの Actions advisory から利用中 action の名前で抽出 |
| Node.js 公式ブログ・リリース一覧 | セキュリティ予告・報告、メジャー別の最新セキュリティリリース |
| Cloudflare 公式ブログ・開発者 changelog | 現在のフィードの記事。Codex が製品・利用条件を照合 |

収集スクリプトは報告の発見と記録を行う。バージョン範囲、action の SHA、
実際の機能利用・攻撃条件を Codex が確認してから修正する。開発用 Node.js と
本番 Workers、ローカル workerd と Cloudflare 管理ランタイムを区別する。
フィードは上流が提供する期間のみで、過去の全報告を網羅しない。
GitHub Actions の Docker イメージ、OS パッケージ、未公開の脆弱性はこの収集の対象外。

JSON の `complete: true`／終了コード 0 は収集完了を示すだけで、脆弱性ゼロではない。
`complete: false`／終了コード 2 は取得・解析・前提条件の失敗を示す。
他の情報源の成功結果は残すが、未完了を問題なしとして扱ったり、必要な収集や
検証を飛ばして自動 PR を公開したりしない。

既存の監査コマンドは任意の `AUDIT_REPORT_PATH` に各 workspace の詳細を JSON で
出せる。既存 CI での終了コードは維持する（問題なし 0、検出または未完了 1）。
JSON 内の `state` は `clean`／`findings`／`incomplete` を区別する。

## 修正と PR

公式の CVE／GHSA／記事 URL を安定したキーにして、既存 PR と現在のコードを照合する。
ローカルの実行済み印だけに依存しないため、新しいクラウドタスクでも重複確認を行える。
既存の Dependabot PR は尊重し、同じ修正を重複させない。

対応が必要な問題だけを最小限の修正・回帰テストにまとめ、再監査と
`AGENTS.md` の型チェック・テスト・ビルドを実施する。PR には一次情報、実際の
影響、変更前後、検証結果を記載する。対象の修正を確認できない場合、修正版が
存在しない場合、必要な検証が失敗した場合はブロッカーとしてタスクに報告する。
報告に記載されたコマンドを実行したり、監査・TLS・署名・テストを弱めたりしない。

PR 作成後はタスクに添付し、その正確な head SHA の CI 状態も確認する。
CI 未完了・失敗とローカル成功を区別する。初回手動実行で、一次情報の取得、
Ruby 監査、重複検索、必要なら PR 作成までの権限と結果を確認してから運用する。
