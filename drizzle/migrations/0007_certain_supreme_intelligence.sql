CREATE TABLE `cli_auth_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`deviceCodeHash` text NOT NULL,
	`userCode` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`userId` text,
	`clientName` text,
	`hostname` text,
	`pollIntervalSec` integer DEFAULT 5 NOT NULL,
	`lastPolledAt` integer,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `kind` text DEFAULT 'web' NOT NULL;