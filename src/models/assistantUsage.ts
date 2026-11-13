import { t } from '@nanokajs/core'

export const assistantUsageTableName = 'assistant_usage'
export const assistantUsageFields = {
  id: t.string().primary().readOnly(),
  day: t.string().serverOnly(),
  calls: t.integer().default(0).serverOnly(),
}
