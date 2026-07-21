CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`category` text,
	`pageUrl` text,
	`eventId` text,
	`userAgent` text,
	`submitter` text,
	`ipHash` text,
	`status` text DEFAULT 'new' NOT NULL,
	`createdAt` integer NOT NULL
);
