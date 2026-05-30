import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { NanokaModel } from '@nanokajs/core'
import type { decisionFields } from '../../models/decision'
import { audit_logs } from '../../../drizzle/schema'
import type { Env } from '../index'
import { postDecisionMessage, editDecisionMessage, DiscordApiError } from './client'

type DrizzleDb = BaseSQLiteDatabase<'async', any>

export interface NotifierContext {
  app: { db: DrizzleDb }
  Decision: NanokaModel<typeof decisionFields>
  workerHost: string
}

export function buildDecisionEmbed(args: {
  event: { id: string; title: string; description?: string | null }
  candidate: { startAt: Date; endAt: Date }
  participants: Array<{ displayName: string }>
  workerHost: string
  cancelled: boolean
}): { embed: object; components: object[] } {
  const { event, candidate, participants, workerHost, cancelled } = args
  const unix = Math.floor(candidate.startAt.getTime() / 1000)
  const names = participants.map((p) => p.displayName).join(', ')

  const embed = {
    title: cancelled ? `【キャンセル】${event.title}` : `【確定】${event.title}`,
    color: cancelled ? 0xc0392b : 0x3498db,
    description: `日時: <t:${unix}:F>\n参加者: ${names}`,
  }

  const components: object[] = cancelled
    ? []
    : [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'Apple Calendar に追加',
              url: `https://${workerHost}/api/events/${event.id}/decision.ics`,
            },
          ],
        },
      ]

  return { embed, components }
}

export async function notifyDecisionApplied(
  ctx: NotifierContext,
  env: Env,
  args: {
    decision: { id: string; discordMessageId?: string | null }
    event: { id: string; title: string; description?: string | null; discordChannelId?: string | null }
    candidate: { startAt: Date; endAt: Date }
    participants: Array<{ displayName: string }>
  },
): Promise<void> {
  const { app, Decision, workerHost } = ctx
  const { decision, event, candidate, participants } = args
  const now = new Date()

  if (!event.discordChannelId) {
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.skipped',
      payload: { reason: 'no_channel', decisionId: decision.id },
      createdAt: now,
    })
    return
  }

  if (!env.DISCORD_BOT_TOKEN) {
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.skipped',
      payload: { reason: 'no_token', decisionId: decision.id },
      createdAt: now,
    })
    return
  }

  const { embed, components } = buildDecisionEmbed({
    event,
    candidate,
    participants,
    workerHost,
    cancelled: false,
  })

  try {
    const { messageId } = await postDecisionMessage(env, {
      channelId: event.discordChannelId,
      embed,
      components,
    })
    await Decision.update(decision.id, { discordMessageId: messageId })
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.success',
      payload: { stage: 'post', decisionId: decision.id, messageId },
      createdAt: new Date(),
    })
  } catch (err) {
    const payload = err instanceof DiscordApiError
      ? { stage: 'post', status: err.status, code: err.code, message: err.message }
      : { stage: 'post', message: String(err) }
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.failure',
      payload,
      createdAt: new Date(),
    })
  }
}

export async function notifyDecisionCancelled(
  ctx: NotifierContext,
  env: Env,
  args: {
    decision: { id: string; discordMessageId?: string | null }
    event: { id: string; title: string; description?: string | null; discordChannelId?: string | null }
    candidate: { startAt: Date; endAt: Date }
    participants: Array<{ displayName: string }>
  },
): Promise<void> {
  const { app, workerHost } = ctx
  const { decision, event, candidate, participants } = args
  const now = new Date()

  if (!event.discordChannelId) {
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.skipped',
      payload: { reason: 'no_channel', decisionId: decision.id },
      createdAt: now,
    })
    return
  }

  if (!env.DISCORD_BOT_TOKEN) {
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.skipped',
      payload: { reason: 'no_token', decisionId: decision.id },
      createdAt: now,
    })
    return
  }

  if (!decision.discordMessageId) {
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.skipped',
      payload: { reason: 'no_message_id', decisionId: decision.id },
      createdAt: now,
    })
    return
  }

  const { embed, components } = buildDecisionEmbed({
    event,
    candidate,
    participants,
    workerHost,
    cancelled: true,
  })

  try {
    await editDecisionMessage(env, {
      channelId: event.discordChannelId,
      messageId: decision.discordMessageId,
      embed,
      components,
    })
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.success',
      payload: { stage: 'patch', decisionId: decision.id, messageId: decision.discordMessageId },
      createdAt: new Date(),
    })
  } catch (err) {
    const payload = err instanceof DiscordApiError
      ? { stage: 'patch', status: err.status, code: err.code, message: err.message }
      : { stage: 'patch', message: String(err) }
    await app.db.insert(audit_logs).values({
      id: crypto.randomUUID(),
      actorDiscordId: null,
      action: 'discord.notify.failure',
      payload,
      createdAt: new Date(),
    })
  }
}
