# 運用マニュアル

Hiyori の運用手順集。管理者トークンの取り扱いと定期的なローテーション、緊急対応（PII 混入時の物理削除）を含む。

## お知らせ機能

### 概要

- 実装は `plans/2026-07-22-hiyori-announcements.md`（企画書 v3）に準拠。
- 公開 GET `/api/announcements` は認証不要・`Cache-Control: no-store`・IP 単位 rate limit 付き。
- 書き込み `POST /api/announcements` と `PATCH /api/announcements/:id` は Bearer `ANNOUNCEMENTS_ADMIN_TOKEN` 保護。
- 投稿 CLI: `scripts/announce.mjs`（Node 22 標準依存ゼロ）。詳細は README を参照。

### `ANNOUNCEMENTS_ADMIN_TOKEN` の取り扱いルール

- Cloudflare Secret として保存し、リポジトリにコミットしない。`wrangler secret put ANNOUNCEMENTS_ADMIN_TOKEN` で設定する。
- PR 説明・コミットメッセージ・Issue 本文・CI ログ・GitHub Actions ログ・スクリーンショットにトークン値を書かない。
- CLI 実行時は shell 履歴に残るリスクがあるので、`.env` 相当のファイルから export するか、`read -s` で対話入力する運用にする。
- **未設定なら書き込み API は常に 403** で応答する（safe-by-default）。

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
3. 反映を確実にするためデプロイ（Secret 単体でも即時反映されるが、キャッシュ状態に依らず切替を確認するため）:
   ```
   pnpm deploy
   ```
4. 旧トークンで叩いて 403 が返ることを確認:
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

コストは 0 円（Secret 更新と再デプロイのみ）。

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

#### D1 Time Travel（30 日ロールバック）注記

Cloudflare D1 は Time Travel 機能で **DB 全体を 30 日間ロールバック可能**な仕様。物理 DELETE 後も **30 日間は復元可能状態にある**。

- テーブル / レコード単位のロールバックはできない（DB 全体が過去時点に戻る）
- Time Travel を発動すると、削除以外の書き込みも同時に巻き戻る
- **物理削除後 30 日以内の rollback 発動は運営内で判断・巻き戻る他データへの影響を評価してから**実施すること（原則、削除した内容が本当に PII だった場合は復元しない）
- 30 日以上経過すれば復元経路も消える

### 投稿頻度モニタリング

- 想定投稿頻度: 週 0〜2 件（月 3〜8 件）
- 頻度が想定より高い場合（月 30 件超・週 10 件超が続く場合）は、投稿導線が壊れていないか（自動投稿の暴走・スクリプトの誤呼び出し等）を確認する
- Cloudflare Analytics で `/api/announcements` の POST リクエスト数を月次で確認する
- 何らかの理由で高頻度投稿が必要になった場合は、rate limit の緩和ではなく設計の見直し（Discord 通知連動・別チャネルへの移行）を検討する

### 撤退ライン

3 ヶ月運用しても投稿数がゼロ / 月なら、機能を archive して README 告知に一本化する。判断は運営内で行う。
