CREATE TABLE `ai_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerDiscordId` text NOT NULL,
	`reservedMicros` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX ai_reservations_created_idx ON ai_reservations (createdAt);
--> statement-breakpoint
CREATE INDEX ai_reservations_owner_created_idx ON ai_reservations (ownerDiscordId, createdAt);
