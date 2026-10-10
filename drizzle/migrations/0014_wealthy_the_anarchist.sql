-- Rebuild to make discordUserId nullable while preserving every existing record.
CREATE TABLE `__new_event_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`eventId` text NOT NULL,
	`discordUserId` text,
	`discordUsername` text,
	`claimedAt` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_event_invites`("id", "eventId", "discordUserId", "discordUsername", "claimedAt", "createdAt") SELECT "id", "eventId", "discordUserId", NULL, NULL, "createdAt" FROM `event_invites`;--> statement-breakpoint
DROP TABLE `event_invites`;--> statement-breakpoint
ALTER TABLE `__new_event_invites` RENAME TO `event_invites`;--> statement-breakpoint
-- NULL usernames preserve existing numeric invitation rows, including their record IDs.
CREATE UNIQUE INDEX `event_invites_event_username_unique` ON `event_invites` (`eventId`, `discordUsername`);
--> statement-breakpoint
CREATE INDEX `event_invites_event_discord_idx` ON `event_invites` (`eventId`, `discordUserId`);
--> statement-breakpoint
CREATE INDEX `event_invites_pending_username_idx` ON `event_invites` (`discordUsername`) WHERE `discordUserId` IS NULL;
