CREATE UNIQUE INDEX `participants_event_discord_unique`
  ON `participants` (`eventId`, `discordUserId`)
  WHERE `discordUserId` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_event_guest_unique`
  ON `participants` (`eventId`, `guestTokenHash`)
  WHERE `guestTokenHash` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_candidate_participant_unique`
  ON `votes` (`candidateId`, `participantId`);
