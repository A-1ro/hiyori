import { t } from '@nanokajs/core'

export const userTableName = 'users'
export const userFields = {
  id: t.uuid().primary().readOnly(),
  discordUserId: t.string().min(1).max(20),
  username: t.string().min(1).max(80),
  globalName: t.string().max(80).optional(),
  avatar: t.string().max(200).optional(),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
  updatedAt: t.timestamp().default(() => new Date()),
}
