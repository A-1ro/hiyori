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

export interface DecisionLike {
  id: string
  discordMessageId?: string | null
}

export interface CandidateTime {
  startAt: Date
  endAt: Date
}

export interface EventLike {
  id: string
  title: string
  description?: string | null
  discordChannelId?: string | null
}

/**
 * 複数件の確定／取消通知用の単一埋め込みを構築する。`slots` は確定枠ごとに 1 件、
 * `cancelled=true` のときは「【キャンセル】」プレフィックス＋取消色。
 */
export function buildDecisionEmbed(args: {
  event: { id: string; title: string; description?: string | null }
  slots: CandidateTime[]
  participants: Array<{ displayName: string }>
  workerHost: string
  cancelled: boolean
}): { embed: object; components: object[] } {
  const { event, slots, participants, workerHost, cancelled } = args
  const names = participants.map((p) => p.displayName).join(', ')

  const slotsLines = slots
    .map((s) => `- <t:${Math.floor(s.startAt.getTime() / 1000)}:F>`)
    .join('\n')

  const prefix = cancelled
    ? slots.length > 1
      ? `【キャンセル：${slots.length}件】`
      : '【キャンセル】'
    : slots.length > 1
      ? `【確定：${slots.length}件】`
      : '【確定】'

  const description = slots.length > 1
    ? `日時:\n${slotsLines}\n参加者: ${names}`
    : `日時: <t:${Math.floor((slots[0]?.startAt.getTime() ?? 0) / 1000)}:F>\n参加者: ${names}`

  const embed = {
    title: `${prefix}${event.title}`,
    color: cancelled ? 0xc0392b : 0x3498db,
    description,
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

/**
 * applyDecisions の結果を受けて、追加・取消があった場合にだけ Discord に通知する。
 * 戦略：
 * - 追加（新規 or 再活性化）された decision それぞれに新規メッセージを POST し、messageId を永続化
 * - 取消された decision のうち discordMessageId 持ちは PATCH で「キャンセル」化
 */
export async function notifyDecisionsChanged(
  ctx: NotifierContext,
  env: Env,
  args: {
    event: EventLike
    added: Array<{ decision: { id: string }; candidate: CandidateTime }>
    cancelled: Array<{ decision: { id: string; discordMessageId?: string | null }; candidate: CandidateTime }>
    participants: Array<{ displayName: string }>
  },
): Promise<void> {
  const { app, Decision, workerHost } = ctx
  const { event, added, cancelled, participants } = args
  const now = new Date()

  if (!event.discordChannelId) {
    if (added.length > 0 || cancelled.length > 0) {
      await app.db.insert(audit_logs).values({
        id: crypto.randomUUID(),
        actorDiscordId: null,
        action: 'discord.notify.skipped',
        payload: { reason: 'no_channel', added: added.length, cancelled: cancelled.length },
        createdAt: now,
      })
    }
    return
  }

  if (!env.DISCORD_BOT_TOKEN) {
    if (added.length > 0 || cancelled.length > 0) {
      await app.db.insert(audit_logs).values({
        id: crypto.randomUUID(),
        actorDiscordId: null,
        action: 'discord.notify.skipped',
        payload: { reason: 'no_token', added: added.length, cancelled: cancelled.length },
        createdAt: now,
      })
    }
    return
  }

  // 追加分: 単一メッセージで「N 件確定」として 1 投稿にまとめる
  if (added.length > 0) {
    const { embed, components } = buildDecisionEmbed({
      event,
      slots: added.map((a) => a.candidate),
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
      // 投稿は 1 件にまとめたので、added 全件に同じ messageId を紐付ける（取消時にまとめて patch しやすい）
      for (const a of added) {
        await Decision.update(a.decision.id, { discordMessageId: messageId })
      }
      await app.db.insert(audit_logs).values({
        id: crypto.randomUUID(),
        actorDiscordId: null,
        action: 'discord.notify.success',
        payload: { stage: 'post', count: added.length, messageId },
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

  // 取消分: 取消対象が共有していた messageId ごとに PATCH（同じメッセージは 1 回だけ）
  if (cancelled.length > 0) {
    const patchedMessageIds = new Set<string>()
    for (const c of cancelled) {
      const messageId = c.decision.discordMessageId
      if (!messageId) {
        await app.db.insert(audit_logs).values({
          id: crypto.randomUUID(),
          actorDiscordId: null,
          action: 'discord.notify.skipped',
          payload: { reason: 'no_message_id', decisionId: c.decision.id },
          createdAt: now,
        })
        continue
      }
      if (patchedMessageIds.has(messageId)) continue
      patchedMessageIds.add(messageId)

      // 同じ messageId に紐付く取消枠を集約して 1 回の PATCH に
      const slots = cancelled
        .filter((x) => x.decision.discordMessageId === messageId)
        .map((x) => x.candidate)

      const { embed, components } = buildDecisionEmbed({
        event,
        slots,
        participants,
        workerHost,
        cancelled: true,
      })

      try {
        await editDecisionMessage(env, {
          channelId: event.discordChannelId,
          messageId,
          embed,
          components,
        })
        await app.db.insert(audit_logs).values({
          id: crypto.randomUUID(),
          actorDiscordId: null,
          action: 'discord.notify.success',
          payload: { stage: 'patch', messageId, count: slots.length },
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
  }
}
