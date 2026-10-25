import { t } from '@nanokajs/core'

// One-shot confirmation receipts only: no conversation, tool arguments or tokens.
export const hiyoriActionReceiptTableName = 'hiyori_action_receipts'
export const hiyoriActionReceiptFields = {
  id: t.uuid().primary().readOnly(),
  ownerDiscordId: t.string().serverOnly(),
  actionHash: t.string().serverOnly(),
  status: t.string().serverOnly(),
  createdAt: t.timestamp().readOnly(),
}
