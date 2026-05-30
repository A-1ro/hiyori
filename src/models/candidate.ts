import { t } from '@nanokajs/core'

export const candidateTableName = 'candidates'
export const candidateFields = {
  id: t.uuid().primary().readOnly(),
  eventId: t.uuid(),
  startAt: t.timestamp(),
  endAt: t.timestamp(),
}
