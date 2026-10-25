import { t } from '@nanokajs/core'

// Spend reservations only; never store prompts, replies, drafts or API tokens.
// Kept conservatively even after failures/timeouts. No optimistic refunds.
export const aiReservationTableName = 'ai_reservations'
export const aiReservationFields = {
  id: t.uuid().primary().readOnly(),
  ownerDiscordId: t.string().serverOnly(),
  reservedMicros: t.integer().serverOnly(),
  createdAt: t.timestamp().readOnly(),
}
