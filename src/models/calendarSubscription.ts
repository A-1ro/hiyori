import { t } from '@nanokajs/core'

export const calendarSubscriptionTableName = 'calendar_subscriptions'
export const calendarSubscriptionFields = {
  id: t.uuid().primary().readOnly(),
  ownerDiscordId: t.string().min(1),
  token: t.string().serverOnly(),
  scope: t.string().default('user-all'),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
  lastAccessedAt: t.timestamp().optional(),
}
