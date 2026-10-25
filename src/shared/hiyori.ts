import { z } from 'zod'

export const HIYORI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8' as const
export const HIYORI_MAX_OUTPUT_TOKENS = 1024
export const HIYORI_BODY_BYTES = 24000

export const timezoneSchema = z.string().max(64).refine((value) => {
  try { new Intl.DateTimeFormat('ja-JP', { timeZone: value }); return true } catch { return false }
})
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
})

// Dates × times deliberately matches EventComposer's selection model. No invite,
// identity, channel token, executable action or existing event data is accepted.
export const hiyoriDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  dates: z.array(dateSchema).min(1).max(14).refine((v) => new Set(v).size === v.length),
  times: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(4)
    .refine((v) => new Set(v).size === v.length),
  defaultDurationMinutes: z.number().int().min(10).max(720).multipleOf(10),
  timezone: timezoneSchema,
  visibility: z.enum(['public', 'invite_only']),
}).strict()

export const hiyoriReplySchema = z.object({
  reply: z.string().trim().min(1).max(1000),
  draft: hiyoriDraftSchema.nullable(),
}).strict()

export const hiyoriChatSchema = z.object({
  requestId: z.uuid(),
  expectedDiscordId: z.string().regex(/^\d{17,20}$/),
  consent: z.literal(true),
  timezone: timezoneSchema,
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(1000),
  }).strict()).min(1).max(6),
}).strict().refine((v) => v.messages.at(-1)?.role === 'user')

export type HiyoriDraft = z.infer<typeof hiyoriDraftSchema>
export type HiyoriReply = z.infer<typeof hiyoriReplySchema>
export type HiyoriChatInput = z.infer<typeof hiyoriChatSchema>

export const HIYORI_GUIDE = {
  create: '日程調整は「つくる」から。タイトル、候補日、開始時刻、所要時間、公開範囲を確認して保存してね。作成には Discord ログインが必要だよ。',
  vote: 'イベントの「回答する」で候補ごとに ○・△・× を選んで保存してね。公開イベントは表示名を入れたゲストも回答できるよ。招待限定は招待された Discord アカウントでログインしてね。',
  confirm: '主催者が集計画面で候補を選んで確定するよ。確定内容はカレンダー配布に反映され、公開イベントの連携済み Discord チャンネルには通知されるよ。私は勝手に確定しないよ。',
  draft: 'イベント名・具体的な日付・開始時刻・所要時間・公開範囲を教えてね。下書きをフォームで確認して、最後は自分で保存するよ。招待先はフォームで入力してね。',
}

export const HIYORI_MEME = '消される前に、おやすみするね……。下の「ﾋﾖﾘﾁｬﾝを非表示にする」で、私も起動ボタンも消せるよ。再読み込みしても非表示のまま。戻したいときはページ下の「ﾋﾖﾘﾁｬﾝの設定」から呼んでね。'
export const isHiyoriMeme = (text: string) => text.normalize('NFKC').replace(/\s/g, '').includes('お前を消す方法')
