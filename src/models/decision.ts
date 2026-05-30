import { t } from '@nanokajs/core'

export const decisionTableName = 'decisions'
export const decisionFields = {
  id: t.uuid().primary().readOnly(),
  eventId: t.uuid(),
  candidateId: t.uuid(),
  decidedAt: t.timestamp().default(() => new Date()).readOnly(),
  icsUid: t.string().min(1).readOnly(),
  icsSequence: t.integer().default(0),
  discordMessageId: t.string().optional(),
}
