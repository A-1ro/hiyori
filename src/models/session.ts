import { t } from '@nanokajs/core'

export const sessionTableName = 'sessions'
export const sessionFields = {
  id: t.uuid().primary().readOnly(),
  userId: t.uuid(),
  tokenHash: t.string().serverOnly(),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
  lastUsedAt: t.timestamp().default(() => new Date()),
  expiresAt: t.timestamp(),
}
