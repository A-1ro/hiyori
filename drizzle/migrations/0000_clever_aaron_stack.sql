CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actorDiscordId` text,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerDiscordId` text NOT NULL,
	`token` text NOT NULL,
	`scope` text DEFAULT 'user-all' NOT NULL,
	`createdAt` integer NOT NULL,
	`lastAccessedAt` integer
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`eventId` text NOT NULL,
	`startAt` integer NOT NULL,
	`endAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`eventId` text NOT NULL,
	`candidateId` text NOT NULL,
	`decidedAt` integer NOT NULL,
	`icsUid` text NOT NULL,
	`icsSequence` integer DEFAULT 0 NOT NULL,
	`discordMessageId` text
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`organizerDiscordId` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`defaultDurationMinutes` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`deadline` integer,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`discordChannelId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`eventId` text NOT NULL,
	`kind` text NOT NULL,
	`discordUserId` text,
	`displayName` text NOT NULL,
	`guestToken` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`candidateId` text NOT NULL,
	`participantId` text NOT NULL,
	`choice` text NOT NULL,
	`comment` text,
	`updatedAt` integer NOT NULL
);
