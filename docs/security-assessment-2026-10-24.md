# 初回セキュリティ確認（2026-10-24）

基準コミットは `ba1cd9742c793521e6db4a3475bde2523767dad6`。
`security-intake.mjs` で npm 監査、GitHub Actions advisory、Node.js 公式ブログと
リリース一覧、Cloudflare 公式ブログと changelog の6系統を収集した。
既存の open PR はなかった。報告の収集と、各記事の影響判定は区別する。

## 依存関係

root の監査で12件の異なる advisory（low 2、moderate 7、high 3）、CLI でそのうち
Vitest 関連2件を検出した。GitHub の一次 advisory の修正範囲も確認した。
以下は lockfile 内に存在したバージョンと、今回適用したバージョン。

| パッケージ | 変更前 → 変更後 | 依存経路・扱い |
| --- | --- | --- |
| Vitest / `@vitest/mocker` | 4.1.11 → 4.1.12 | root／CLI の開発用。unauthenticated mock registration、Windows traversal の修正 |
| `ip-address` | 10.7.1 → 10.7.4 | MCP SDK → express-rate-limit。zone identifier による計算量問題 |
| `fast-uri` | 3.1.8 → 3.1.9 | MCP SDK → ajv。scheme／host／path 正規化の4件 |
| `body-parser` | 2.3.0 → 2.4.0 | MCP SDK → express。圧縮されたリクエスト本文による DoS |
| `undici` 7.x | 7.29.1 → 7.30.1 | Miniflare／Wrangler のローカルツール。EventSource／SRI／content-encoding の3件 |
| `zod` | 4.4.3 → 4.6.7 | Workers テストプール内の別コピー。大きな constrained collection によるメモリ消費。アプリ直下の 4.6.7 は元から対象外 |

Vitest は両 manifest の要求バージョンを更新した。推移依存は従来のセキュリティ
override を修正版に更新し、body-parser と zod に同じメジャー内の範囲限定 override
を追加した。pnpm の依存ビルドスクリプト許可リストは維持した。
MCP SDK の依存グラフに存在することだけでは、本番 Workers に Express の
HTTP サーバーや脆弱な入力経路が存在する証明にはならない。今回の更新は
依存グラフの脆弱なバージョンを除去するもので、本番の悪用可能性を確認したという
意味ではない。既存の Workers／MCP／CLI テストとビルドで互換性を確認する。

一次情報:

- Vitest: [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)、[GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)
- ip-address: [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5)
- fast-uri: [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)、[GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h)、[GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr)、[GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp)
- body-parser: [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)
- undici: [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685)、[GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472)、[GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)
- zod: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

更新後の再監査は root／CLI ともに info／low／moderate／high／critical がすべて0。
全情報源の収集も再実行して完了した。これは収集時点の公開 advisory に対する結果で、
未公開の脆弱性や将来の安全性を保証するものではない。

## ツール・公式情報

- [Node.js October 2026 security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases):
  公式リリース一覧のセキュリティリリースは 22.23.4／24.22.1／26.12.1。
  CI matrix と root engines はすでにその版を要求しており、クラウド環境も 24.22.1。
  今回の追加変更は不要。
- [GHSA-vqf5-2xx6-9wfm](https://github.com/advisories/GHSA-vqf5-2xx6-9wfm):
  Actions の名前照合で CodeQL が候補になったが、対象は v2.26.11 以降の v2 と
  v3.26.11〜v3.28.2。現行の SHA pin は v4.39.0 なので対象外。
- Cloudflare の直近記事・関連製品の changelog では、今回追加のローカル修正を
  必要とするセキュリティ報告は確認しなかった。例えば PHP／NetScaler の防御記事は
  Hiyori が採用している構成への脆弱性報告ではない。Workers／D1 等の一般的な
  新機能・運用変更を脆弱性修正と混同せず、管理ランタイムの更新をローカルの
  compatibility date 変更で代用しない。

公式フィードの収集範囲は上流の提供内容に依存する。毎日のタスクでも既存 PR と
現在の lockfile を調べ、未解決の古い advisory を公開日だけで除外しない。
定期タスクの登録とクラウド環境の公開は、この初回実行とは別の操作。
