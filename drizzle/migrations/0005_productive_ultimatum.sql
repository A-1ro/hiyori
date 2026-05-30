CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastUsedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`discordUserId` text NOT NULL,
	`username` text NOT NULL,
	`globalName` text,
	`avatar` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS `decisions_event_unique`;