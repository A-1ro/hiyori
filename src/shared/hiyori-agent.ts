import { z } from 'zod'
import { hiyoriChatSchema, hiyoriDraftSchema } from './hiyori'

export const hiyoriAgentChatSchema = hiyoriChatSchema.safeExtend({
  selectedEventId: z.string().min(1).max(100).optional(),
  toolDataConsent: z.boolean().optional(),
})
export type HiyoriAgentChatInput = z.infer<typeof hiyoriAgentChatSchema>

export const hiyoriToolRequestSchema = z.object({
  expectedDiscordId: z.string().regex(/^\d{17,20}$/),
  name: z.string().min(1).max(80),
  arguments: z.record(z.string(), z.unknown()),
}).strict()
export const hiyoriConfirmSchema = z.object({
  expectedDiscordId: z.string().regex(/^\d{17,20}$/),
  token: z.string().min(1).max(250000),
  confirmed: z.literal(true),
}).strict()
export const hiyoriActionSchema = z.object({
  token: z.string(), name: z.string(), label: z.string(),
  eventTitle: z.string().optional(), subject: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()),
  expiresAt: z.number(),
}).strict()
export type HiyoriAction = z.infer<typeof hiyoriActionSchema>
export const hiyoriAgentReplySchema = z.object({
  reply: z.string().max(1000),
  draft: hiyoriDraftSchema.nullable().optional(),
  action: hiyoriActionSchema.optional(),
  selectEvent: z.boolean().optional(),
  results: z.array(z.object({ name: z.string(), data: z.unknown() }).strict()).max(8).optional(),
}).strict()
export type HiyoriAgentReply = z.infer<typeof hiyoriAgentReplySchema>

export const HIYORI_ACTION_LABELS: Record<string, string> = {
  hiyori_create_event: 'イベントを作成', hiyori_edit_event: 'イベントを変更',
  hiyori_vote: '回答を送信', hiyori_confirm: '日程を確定', hiyori_unconfirm: '確定を取り消し',
  hiyori_delete_event: 'イベントを削除', hiyori_add_candidate: '候補を追加', hiyori_remove_candidate: '候補を削除',
  hiyori_add_invite: '招待を追加', hiyori_revoke_invite: '招待を取り消し',
  hiyori_add_subscription: '購読を作成', hiyori_remove_subscription: '購読を削除', hiyori_regen_subscription: '購読URLを再生成',
}

// Existing form represents dates × times. Offer that handoff only when it is
// lossless; irregular slots and invitations stay in the complete review card.
export function draftFromCreation(args: Record<string, unknown>, timezone: string) {
  if (Array.isArray(args.invitedDiscordUsernames) && args.invitedDiscordUsernames.length) return null
  const slots = z.array(z.object({ startAt: z.string().datetime(), endAt: z.string().datetime().optional() })).safeParse(args.candidates)
  if (!slots.success || args.deadline) return null
  const local = (value: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
    const p = (type: string) => parts.find((p) => p.type === type)!.value
    return { date: `${p('year')}-${p('month')}-${p('day')}`, time: `${p('hour')}:${p('minute')}` }
  }
  const values = slots.data.map((s) => local(s.startAt))
  const dates = [...new Set(values.map((v) => v.date))], times = [...new Set(values.map((v) => v.time))]
  if (new Set(values.map((v) => `${v.date}T${v.time}`)).size !== dates.length * times.length || values.length !== dates.length * times.length) return null
  if (slots.data.some((s) => s.endAt && (Date.parse(s.endAt) - Date.parse(s.startAt)) / 60000 !== args.defaultDurationMinutes)) return null
  const parsed = hiyoriDraftSchema.safeParse({ title: args.title, description: args.description ?? '', dates, times, defaultDurationMinutes: args.defaultDurationMinutes, timezone, visibility: args.visibility ?? 'public' })
  return parsed.success ? parsed.data : null
}
