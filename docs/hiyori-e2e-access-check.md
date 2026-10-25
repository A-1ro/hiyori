# e2e 読み取りと設定 UI の確認（2026-10-25）

## HTTP403/error1010

13:10頃の匿名 GET `/assets/main-7UBmwPYM.js` は HTTP403、本文 `error code: 1010`、応答 Server は `envoy`。元の応答の Date/CF-Ray を保存していなかったため、そのヘッダーとの直接突合はできない。

既存 Cloudflare 接続から Security Events を読み取り、同じ host/path と既定 User-Agent `Python-urllib/3.12` に一致するイベントを13:09〜13:13 UTCの範囲に1件確認した。

- 日時: `2026-10-25T13:10:39Z`
- Ray: `a501766f298acccb`
- `source: bic` / `ruleId: bic` / `action: block`

Browser Integrity Check（BIC）は有効。通常の Bot Fight Mode は無効。対象に一致する Access アプリ、UA blocking rule、Page Rule、zone の custom/managed/configuration entrypoint と account root ruleset は確認されなかった。Managed ruleset がカタログに存在するだけで稼働ルールとみなさない。同じ Ray を絞った既存 Worker ログは0件で、Worker手前のBIC拒否と整合するが、ログ0件だけを根拠にはしない。旧 Firewall Rules API は410（廃止）だったので、現行 Rulesets API で確認した。観測権限不足はなかった。

[公式1010文書](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/)と[ BIC 文書](https://developers.cloudflare.com/waf/tools/browser-integrity-check/)は、非標準のライブラリ既定 User-Agent 等による拒否を説明している。今回のイベントは BIC を示し、アプリの認可403とは区別できる。Chrome の危険サイト判定、証明書信頼問題、侵害・漏えいとの因果関係は確認していない。

## 承認された1回の正規クライアント読み取り

同じ公開ファイルを、ブラウザーではなく検証ツール自身を示す User-Agent `HiyoriE2EReadCheck/1.0 (operator-authorized; read-only)` で1回だけ取得した。Cookie/認証情報なし、リダイレクト追従なし、既定のTLS検証を維持。BIC/WAF/Access/TLS/DNS設定や本番は変更していない。

- 開始 `2026-10-25T13:46:48.709080Z` / 応答 Date `Sun, 25 Oct 2026 13:46:49 GMT`
- HTTP200 / CF-Ray `a501ab685ed7012b-GRU` / Content-Type `text/javascript`
- 658,558 bytes、SHA-256 `aa8259e0eebd28fb832bc25d2a56406d9c498baaa2e49f02c5f5fd70f87d62e2`
- source `babbef48195e37491e12a85da409c76fc04d2860` のローカル成果物と一致

この1回で承認枠を使用済み。以後の配信版の公開GETや認証付き実経路を確認したものではない。現在のBICを全体で無効化する必要性は示されていない。追加の読み取り試験や限定例外設定が必要な場合は、対象とリスクを明示して別途確認する。実モデル呼出しはこの診断で追加していない。

## 設定ボタン

従来の独立設定ボタンには通常時にも枠・背景・強調色と異なる文字サイズがあった。通常時は周囲のフッターリンクと同じ13px・色・整列にし、44pxの操作領域を透明な余白で維持する。キーボードの `:focus-visible` は2pxの青いアウトラインで残す。独立設定をチャットへ移していない。

提供画像の全画面の灰色状態はローカルでは再現できず、原因を断定しない。閉鎖時には接続中の native dialog を先に close してから非表示/unmountし、モーダルが残らずフッターを実際にクリックできることをChromiumで確認した。本人の私的なスクリーンショットはこのリポジトリやLibraryへ保存し直していない。
