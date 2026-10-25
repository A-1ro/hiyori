CREATE TABLE `hiyori_action_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerDiscordId` text NOT NULL,
	`actionHash` text NOT NULL,
	`status` text NOT NULL,
	`createdAt` integer NOT NULL
);
