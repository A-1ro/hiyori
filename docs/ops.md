# 運用マニュアル

Hiyori の運用手順集。管理者トークンの取り扱いと定期的なローテーション、緊急対応（PII 混入時の物理削除）を含む。

## お知らせ機能

### 概要

- 公開 GET `/api/announcements` は認証不要・`Cache-Control: no-store`・IP 単位 rate limit 付き。
- 書き込み `POST /api/announcements` と `PATCH /api/announcements/:id` は Bearer `ANNOUNCEMENTS_ADMIN_TOKEN` 保護。
- 投稿 CLI: `scripts/announce.mjs`（Node 22 標準依存ゼロ）。投稿例は本ページの「お知らせ投稿 CLI」を参照。

### `ANNOUNCEMENTS_ADMIN_TOKEN` の取り扱いルール

- Cloudflare Secret として保存し、リポジトリにコミットしない。`pnpm exec wrangler secret put ANNOUNCEMENTS_ADMIN_TOKEN` で設定する。
- PR 説明・コミットメッセージ・Issue 本文・CI ログ・GitHub Actions ログ・スクリーンショットにトークン値を書かない。
- CLI 実行時は shell 履歴に残るリスクがあるので、`.env` 相当のファイルから export するか、`read -s` で対話入力する運用にする。
- **未設定なら管理操作は許可されない**（認証判定は 403。先行するレート制限で 429 になる場合もある）。

### admin token rotation 手順（半年〜1年に 1 回・人員入れ替え時・漏洩疑い時に即実施）

1. 新トークン生成:
   ```
   openssl rand -hex 32
   # または
   node -e "console.log(crypto.randomBytes(32).toString('hex'))"
   ```
2. 対話入力で新トークンを Cloudflare Secret として保存:
   ```
   pnpm exec wrangler secret put ANNOUNCEMENTS_ADMIN_TOKEN
   ```
3. `wrangler secret put` 自体が反映を伴うため、対象 Worker と実行結果を確認する。
4. 旧トークンで認証が拒否されることを確認（レート制限時は 429 になり得る）:
   ```
   curl -X POST -H "Authorization: Bearer <旧token>" -H "Content-Type: application/json" \
     -d '{"title":"probe","body":"probe","category":"notice"}' \
     https://hiyori-schedule.com/api/announcements
   # → HTTP/1.1 403 Forbidden
   ```
5. トークンの配布箇所（運営が使う `.env` ファイル / パスワードマネージャ / 手元メモ）を更新。

### rotation 頻度の推奨

- 半年〜1 年に 1 回の定期 rotation
- 人員入れ替え時（管理権限を持っていた人が抜けたとき）
- 漏洩疑い時（Bearer が git 履歴・スクショ・CI ログに写り込んだ疑いがあるとき）は即時ローテ

Secret 更新・デプロイや各サービスの利用条件は契約プランを確認する。

### PII 混入時の緊急対応（誤って個人情報を投稿してしまった場合）

MVP は `DELETE /api/announcements/:id` を提供しないため、`PATCH status='archived'` だけでは D1 レコードは残る。個人情報（本名・連絡先・メール・電話等）が本文に混入した場合は以下の手順で物理削除する。

1. **即座に archive で公開停止**:
   ```
   ANNOUNCEMENTS_ADMIN_TOKEN=xxx node scripts/announce.mjs \
     --api-url https://hiyori-schedule.com --archive <id> --yes
   ```
2. **D1 から物理削除**:
   ```
   pnpm exec wrangler d1 execute hiyori --remote \
     --command "DELETE FROM announcement WHERE id='<id>'"
   ```
3. **GET レスポンスから消えていることを確認**:
   ```
   curl https://hiyori-schedule.com/api/announcements | jq '.announcements[] | select(.id=="<id>")'
   # → 空
   ```
4. **事後**: 何を投稿してしまったか、混入経路（承認プロセス漏れ・コピペミス等）を運営内 incident log に記録し、再発防止策を議論。

#### D1 Time Travel の注記

物理 DELETE 後も、Time Travel の保持期間内は DB 全体の復元でレコードが戻る可能性がある。保持期間は Workers Free で 7 日、Paid で 30 日。契約プランと現在の条件は [Cloudflare の Time Travel 資料](https://developers.cloudflare.com/d1/reference/time-travel/)を確認する。

- テーブル / レコード単位ではなく、DB 全体を指定時点に戻す操作になる。
- 削除以外の書き込みも巻き戻るため、個人情報の削除後に復元する場合は、再公開の可能性と他のデータへの影響を運営内で評価する。
- 保持期間の終了だけで、別途保存したエクスポートや外部コピーまで削除されたことにはならない。

### 投稿頻度モニタリング

- 想定投稿頻度: 週 0〜2 件（月 3〜8 件）
- 頻度が想定より高い場合（月 30 件超・週 10 件超が続く場合）は、投稿導線が壊れていないか（自動投稿の暴走・スクリプトの誤呼び出し等）を確認する
- Cloudflare Analytics で `/api/announcements` の POST リクエスト数を月次で確認する
- 何らかの理由で高頻度投稿が必要になった場合は、rate limit の緩和ではなく設計の見直し（Discord 通知連動・別チャネルへの移行）を検討する

### 撤退ライン

3 ヶ月運用しても投稿数がゼロ / 月なら、機能を archive して README 告知に一本化する。判断は運営内で行う。

## フィードバック API

ヘッダーのフキダシアイコン、またはヘルプ画面下部からログイン不要で送信できる。送信時に現在のページ URL・イベント ID・User-Agent・ログイン状態を自動添付する。報告は D1 の `feedback` テーブルに保存される。

読み出しは admin 保護の汎用 API（特定インフラ非依存・外部連携は「外部 → この API」の一方通行）:

```
# 一覧（新しい順）。FEEDBACK_ADMIN_TOKEN 未設定なら常に 403
GET /api/feedback?status=new&since=<ISO8601>&limit=<1..500>
Authorization: Bearer <FEEDBACK_ADMIN_TOKEN>

# ステータス更新（new / triaged / resolved）
PATCH /api/feedback/:id   { "status": "resolved" }
Authorization: Bearer <FEEDBACK_ADMIN_TOKEN>
```

- `since` は ISO8601 の日時。`createdAt` が指定時刻より新しい行だけ返すため、受信済みの最新 `createdAt` を次回の `since` に使える。ただし上限件数に達した場合や同一時刻の行がある場合は取りこぼしに注意し、重複排除と取得範囲の照合を行う。
- `pnpm exec wrangler secret put FEEDBACK_ADMIN_TOKEN` で登録（ローカルは `.dev.vars`）。未設定でもフォーム投稿は動き、報告は D1 に貯まる（読み出しのみ無効）。

## お知らせ投稿 CLI

接続先は運用者が信頼する HTTPS URL を指定する。開発用 HTTP は CLI と同じく `localhost`、IPv4 loopback (`127.0.0.0/8`)、IPv6 loopback (`[::1]`) のみ許可する。LAN アドレス・`.local` 名への HTTP と、ユーザー名・パスワード入り URL は拒否する。投稿・アーカイブはリダイレクトを拒否するため、最終の API URL を直接指定する。`--dry-run` でも同じ URL 検証を行い、管理トークンは出力しない。

ヘッダのベルアイコンからログイン不要で閲覧できる。公開 GET は `Cache-Control: no-store` で origin 直返し・レート制限（60 req/min per IP）付き。投稿は admin Bearer 保護（`ANNOUNCEMENTS_ADMIN_TOKEN`）で、CLI `scripts/announce.mjs`（Node 22 標準依存ゼロ）から行う。

```
# セットアップ: 秘密トークン生成 → wrangler secret に登録
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
pnpm exec wrangler secret put ANNOUNCEMENTS_ADMIN_TOKEN
# → 対話プロンプトに上で生成した値を貼る

# 投稿（stdin から本文を渡す）
echo "詳細:
- 不具合内容を修正しました
- 適用済み" | ANNOUNCEMENTS_ADMIN_TOKEN=xxx \
  node scripts/announce.mjs \
    --api-url https://hiyori-schedule.com \
    --title "投票の重複バグを修正しました" \
    --category bug_fix

# 投稿（--body で直接指定）
ANNOUNCEMENTS_ADMIN_TOKEN=xxx node scripts/announce.mjs \
  --api-url https://hiyori-schedule.com \
  --title "新機能: XXX を追加しました" \
  --category new_feature \
  --body "XXX の使い方は..." \
  --yes

# dry-run（送信せずリクエスト JSON を確認）
ANNOUNCEMENTS_ADMIN_TOKEN=xxx node scripts/announce.mjs \
  --api-url https://hiyori-schedule.com \
  --title "test" --category notice --body "..." --dry-run

# アーカイブ（誤投稿を取り下げ）
ANNOUNCEMENTS_ADMIN_TOKEN=xxx node scripts/announce.mjs \
  --api-url https://hiyori-schedule.com --archive <id> --yes
```

- カテゴリは `bug_fix` / `new_feature` / `notice` の 3 種類（`bug_fix` = 橙・`new_feature` = 緑・`notice` = 灰でバッジ表示）
- 本文は 4000 字まで。プレーンテキスト＋改行のみ。クライアント側で `http://` / `https://` を自動リンク化（`javascript:` / `data:` 等は絶対にリンク化しない）
- `--published-at`（ISO 8601）で公開日時を明示できる（未来不可・過去 30 日以内）
- 未確認事項がある場合の運用ドキュメント（ローテ手順・PII 混入時の緊急対応・D1 Time Travel 注記）は [本ページの緊急対応手順](#pii-混入時の緊急対応誤って個人情報を投稿してしまった場合) を参照

[環境変数一覧](environment.md) · [README に戻る](../README.md)
