import { t } from '@nanokajs/core'

export const auditLogTableName = 'audit_logs'
export const auditLogFields = {
  id: t.uuid().primary().readOnly(),
  actorDiscordId: t.string().optional(),
  action: t.string().min(1),
  payload: t.json(),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
}
