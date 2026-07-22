-- お知らせ公開 GET (`WHERE status='published' ORDER BY publishedAt DESC, createdAt DESC`)
-- が index なしで full scan + sort になるのを避ける（Codex CLI レビュー指摘 #2 対応）。
-- MVP 想定件数（月 5〜10 件）では顕在化しないが、bot / 分散 IP からの公開 GET を叩かれた際に
-- Workers CPU / D1 予算への影響を第一防御として塞ぐ意味合い。
CREATE INDEX `announcement_public_order_idx`
ON `announcement` (`status`, `publishedAt` DESC, `createdAt` DESC);
