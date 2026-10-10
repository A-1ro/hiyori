CREATE TABLE `event_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`eventId` text NOT NULL,
	`discordUserId` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `visibility` text DEFAULT 'public' NOT NULL;