import { t } from '@nanokajs/core'

export const participantTableName = 'participants'
export const participantFields = {
  id: t.uuid().primary().readOnly(),
  eventId: t.uuid(),
  kind: t.string(),
  discordUserId: t.string().optional(),
  displayName: t.string().min(1).max(80),
  guestToken: t.string().serverOnly().optional(),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
}
