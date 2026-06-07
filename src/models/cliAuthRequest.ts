import { t } from '@nanokajs/core'

export const cliAuthRequestTableName = 'cli_auth_requests'
export const cliAuthRequestFields = {
  id: t.uuid().primary().readOnly(),
  deviceCodeHash: t.string().serverOnly(),
  userCode: t.string(),
  status: t.string().default('pending'),
  userId: t.uuid().optional(),
  clientName: t.string().max(120).optional(),
  hostname: t.string().max(255).optional(),
  pollIntervalSec: t.integer().default(5),
  lastPolledAt: t.timestamp().optional(),
  expiresAt: t.timestamp(),
  createdAt: t.timestamp().default(() => new Date()).readOnly(),
}
