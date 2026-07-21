// ガイドページ（/help/mcp・/help/cli）共通のレスポンシブ表・コードブロック用スタイル。
// 方針: デスクトップは 2 カラムの表。狭い幅（<= 600px）では行を縦積み（カード風）にして
// 説明が画面外に切れないようにする。コードブロックは狭い幅で折り返して全文を表示する。
// media query は base rule の後（source order 末尾）に置く（base に負けないため）。
export function GuideStyles() {
  return (
    <style>{`
.hy-table-wrap { overflow-x: auto; }
.hy-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.hy-table thead th {
  text-align: left; font-weight: 600; padding: 8px 10px;
  border-bottom: 1px solid var(--separator); color: var(--color-fg3);
  white-space: nowrap;
}
.hy-table td {
  padding: 8px 10px; border-bottom: 1px solid var(--separator); vertical-align: top;
}
.hy-table .hy-cmd { white-space: nowrap; }
.hy-table .hy-cmd code, .hy-table .hy-name code {
  font-family: monospace; font-size: 13px; color: var(--color-fg1);
}
.hy-table .hy-scope { white-space: nowrap; }
.hy-table .hy-use { color: var(--color-fg2); line-height: 1.6; }
.hy-rowlabel { display: none; }

.hy-codeblock {
  margin: 8px 0 0; padding: 12px 14px; border-radius: var(--radius-md);
  background: var(--color-fg1); color: var(--color-bg, #fff);
  font-family: monospace; font-size: 13.5px; line-height: 1.7; overflow-x: auto;
  white-space: pre;
}
.hy-codeblock .hy-prompt { opacity: .5; user-select: none; }

@media (max-width: 600px) {
  .hy-table, .hy-table tbody, .hy-table tr, .hy-table td { display: block; width: 100%; }
  .hy-table thead { display: none; }
  .hy-table tr { padding: 10px 0; border-bottom: 1px solid var(--separator); }
  .hy-table tr:first-child { padding-top: 0; }
  .hy-table td { border-bottom: none; padding: 2px 0; }
  .hy-table .hy-cmd, .hy-table .hy-name { white-space: normal; }
  .hy-table .hy-cmd code, .hy-table .hy-name code { word-break: break-word; white-space: normal; }
  .hy-codeblock { white-space: pre-wrap; word-break: break-word; }
}
`}</style>
  )
}
