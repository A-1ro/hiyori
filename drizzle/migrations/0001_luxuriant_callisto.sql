ALTER TABLE `participants` ADD COLUMN `guestTokenHash` text;
--> statement-breakpoint
ALTER TABLE `participants` DROP COLUMN `guestToken`;
