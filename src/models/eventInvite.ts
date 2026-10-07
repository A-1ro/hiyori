import { t } from '@nanokajs/core'

export const eventInviteTableName = 'event_invites'
export const eventInviteFields = {
  id: t.uuid().primary().readOnly(),
  eventId: t.uuid(),
  // Discord snowflakes are numeric strings. The server validates the 17-20 digit shape.
  discordUserId: t.string().min(17).max(20),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
}
