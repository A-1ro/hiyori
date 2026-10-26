import { t } from '@nanokajs/core'

export const assistantConversationTableName = 'assistant_conversations'
export const assistantConversationFields = {
  // The authenticated user's UUID; never accepted from request input.
  id: t.uuid().primary().readOnly(),
  history: t.string().default('[]').serverOnly(),
  pending: t.string().optional().serverOnly(),
  leaseId: t.string().optional().serverOnly(),
  leaseUntil: t.integer().default(0).serverOnly(),
  lastRequestId: t.string().optional().serverOnly(),
  updatedAt: t.timestamp().default(() => new Date()).readOnly(),
}
