import { defineConfig } from '@nanokajs/core/config'
import { auditLogFields, auditLogTableName } from './src/models/auditLog'
import { calendarSubscriptionFields, calendarSubscriptionTableName } from './src/models/calendarSubscription'
import { candidateFields, candidateTableName } from './src/models/candidate'
import { decisionFields, decisionTableName } from './src/models/decision'
import { eventFields, eventTableName } from './src/models/event'
import { participantFields, participantTableName } from './src/models/participant'
import { voteFields, voteTableName } from './src/models/vote'

export default defineConfig({
  models: [
    { name: eventTableName, fields: eventFields },
    { name: candidateTableName, fields: candidateFields },
    { name: participantTableName, fields: participantFields },
    { name: voteTableName, fields: voteFields },
    { name: decisionTableName, fields: decisionFields },
    { name: calendarSubscriptionTableName, fields: calendarSubscriptionFields },
    { name: auditLogTableName, fields: auditLogFields },
  ],
  output: './drizzle/schema.ts',
})
