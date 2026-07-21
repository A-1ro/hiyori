import { defineConfig } from '@nanokajs/core/config'
import { auditLogFields, auditLogTableName } from './src/models/auditLog'
import { calendarSubscriptionFields, calendarSubscriptionTableName } from './src/models/calendarSubscription'
import { candidateFields, candidateTableName } from './src/models/candidate'
import { cliAuthRequestFields, cliAuthRequestTableName } from './src/models/cliAuthRequest'
import { decisionFields, decisionTableName } from './src/models/decision'
import { eventFields, eventTableName } from './src/models/event'
import { feedbackFields, feedbackTableName } from './src/models/feedback'
import { participantFields, participantTableName } from './src/models/participant'
import { sessionFields, sessionTableName } from './src/models/session'
import { userFields, userTableName } from './src/models/user'
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
    { name: userTableName, fields: userFields },
    { name: sessionTableName, fields: sessionFields },
    { name: cliAuthRequestTableName, fields: cliAuthRequestFields },
    { name: feedbackTableName, fields: feedbackFields },
  ],
  output: './drizzle/schema.ts',
})
