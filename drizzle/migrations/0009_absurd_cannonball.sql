-- Issue #25: calendar_subscriptions.token を SHA-256 hash 保存 (tokenHash) に変更する。
-- 既存行の token は平文であり、SQL からは SHA-256 化できないため、MVP では強制再発行とする:
-- 既存 subscription を全件削除して invalidate する（ユーザーは購読 URL の再発行が必要）。
-- 平文 token を tokenHash 列にそのまま残すと「漏洩すると使える値」が DB に残り続けるため、削除が安全側。
DELETE FROM `calendar_subscriptions`;--> statement-breakpoint
ALTER TABLE `calendar_subscriptions` RENAME COLUMN "token" TO "tokenHash";
