import { t } from '@nanokajs/core'

export const voteTableName = 'votes'
export const voteFields = {
  id: t.uuid().primary().readOnly(),
  candidateId: t.uuid(),
  participantId: t.uuid(),
  choice: t.string(),
  comment: t.string().max(500).optional(),
  updatedAt: t.timestamp().default(() => new Date()),
}
