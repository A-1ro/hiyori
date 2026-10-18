import { t } from '@nanokajs/core'

export const eventInviteTableName = 'event_invites'
export const eventInviteFields = {
  id: t.uuid().primary().readOnly(),
  eventId: t.uuid(),
  // Discord snowflakes are numeric strings. The server validates the 17-20 digit shape.
  // Null for a username invitation until a fresh Discord OAuth callback claims it.
  discordUserId: t.string().min(17).max(20).optional(),
  // Original normalized username is retained after binding; never used by ACL checks.
  discordUsername: t.string().min(2).max(32).optional(),
  claimedAt: t.timestamp().optional().readOnly(),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
}
