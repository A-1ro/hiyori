CREATE TABLE `assistant_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`history` text DEFAULT '[]' NOT NULL,
	`pending` text,
	`leaseId` text,
	`leaseUntil` integer DEFAULT 0 NOT NULL,
	`lastRequestId` text,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assistant_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL
);
