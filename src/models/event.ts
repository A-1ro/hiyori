import { t } from '@nanokajs/core'

export const eventTableName = 'events'
export const eventFields = {
  id: t.uuid().primary().readOnly(),
  organizerDiscordId: t.string().min(1),
  title: t.string().min(1).max(200),
  description: t.string().optional(),
  defaultDurationMinutes: t.integer().min(1).max(60 * 24),
  status: t.string().default('open'),
  deadline: t.timestamp().optional(),
  timezone: t.string().default('UTC'),
  discordChannelId: t.string().optional(),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
}
