import { z } from 'zod'
import type { Env } from '../index'
import type { SessionUser } from '../auth/session'
import type { InternalResponse } from '../mcp/internal'
import { hiyoriToolCatalog, WRITE_TOOLS, READ_TOOLS, toolData } from '../tools/catalog'
import { HIYORI_ACTION_LABELS, type HiyoriAction } from '../../shared/hiyori-agent'

export interface HiyoriActor {
  env: Env; user: SessionUser; sessionToken: string
  call(method: string, path: string, body?: unknown): Promise<InternalResponse>
}
export function actorTools(actor: HiyoriActor) {
  return hiyoriToolCatalog({ hasScope: () => true, principal: () => actor.user, call: actor.call })
}
const proposalSchema = z.object({
  id: z.uuid(), owner: z.string(), name: z.string(),
  arguments: z.record(z.string(), z.unknown()), expiresAt: z.number().int(), snapshot: z.string(),
}).strict()
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
function decode(text: string) { return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)) }
async function key(token: string) { return crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) }
async function digest(value: string) { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))) }

async function contextSnapshot(actor: HiyoriActor, name: string, args: Record<string, unknown>) {
  const tools = actorTools(actor)
  if (typeof args.subscriptionId === 'string') {
    const data = z.object({ subscriptions: z.array(z.object({ id: z.string(), createdAt: z.string() }).passthrough()) }).parse(toolData(await tools.get('hiyori_list_subscriptions')!.execute({})))
    const item = data.subscriptions.find((s) => s.id === args.subscriptionId)
    if (!item) throw new Error('この購読は操作できません。最新の一覧を確認してください。')
    return { hash: await digest(JSON.stringify(item)), title: undefined, subject: `購読（作成 ${item.createdAt}、識別末尾 ${item.id.slice(-6)}）`, candidates: [] as Array<{ id: string }> }
  }
  if (typeof args.eventId !== 'string') return { hash: '', title: undefined, subject: undefined, candidates: [] as Array<{ id: string }> }
  const detail = toolData(await tools.get('hiyori_get_event')!.execute({ eventId: args.eventId }))
  const parsed = z.object({ event: z.object({ title: z.string() }).passthrough(), candidates: z.array(z.object({ id: z.string() }).passthrough()), isOrganizer: z.boolean() }).parse(detail)
  if (name !== 'hiyori_vote' && !parsed.isOrganizer) throw new Error('この操作は主催者だけが行えます。')
  const candidateIds = new Set(parsed.candidates.map((c) => c.id))
  const votes = z.array(z.object({ candidateId: z.string() }).passthrough()).optional().parse(args.votes)
  const ids = [...(votes?.map((v) => v.candidateId) ?? []), ...(Array.isArray(args.candidateIds) ? args.candidateIds : []), ...(typeof args.candidateId === 'string' ? [args.candidateId] : [])]
  if (new Set(ids).size !== ids.length) throw new Error('候補を重複して指定できません。')
  if (ids.some((id) => typeof id !== 'string' || !candidateIds.has(id))) throw new Error('現在のイベントにない候補です。候補を選び直してください。')
  let current: unknown = null
  if (name === 'hiyori_vote') current = toolData(await tools.get('hiyori_get_my_votes')!.execute({ eventId: args.eventId }))
  if (name === 'hiyori_confirm' || name === 'hiyori_unconfirm') current = toolData(await tools.get('hiyori_tally')!.execute({ eventId: args.eventId }))
  let subject: string | undefined
  if (name === 'hiyori_revoke_invite') {
    const data = z.object({ invites: z.array(z.object({ id: z.string(), discordUsername: z.string().nullable().optional(), discordUserId: z.string().nullable().optional() }).passthrough()) }).parse(toolData(await tools.get('hiyori_list_invites')!.execute({ eventId: args.eventId })))
    const invite = data.invites.find((i) => i.id === args.inviteId)
    if (!invite) throw new Error('この招待は操作できません。最新の一覧を確認してください。')
    current = invite
    subject = invite.discordUsername ?? `旧形式 ID: ${invite.discordUserId ?? '不明'}`
  }
  return { hash: await digest(JSON.stringify({ event: parsed.event, candidates: [...parsed.candidates].sort((a, b) => a.id.localeCompare(b.id)), current })), title: parsed.event.title, subject, candidates: parsed.candidates }
}

export async function readHiyoriTool(actor: HiyoriActor, name: string, args: unknown) {
  if (!READ_TOOLS.has(name)) throw new Error('読み取り操作ではありません。更新には内容確認が必要です。')
  const tool = actorTools(actor).get(name)
  if (!tool) throw new Error('未対応のツールです。')
  return { name, data: toolData(await tool.execute(args)) }
}

export async function prepareHiyoriAction(actor: HiyoriActor, name: string, input: unknown, now = Date.now()): Promise<HiyoriAction> {
  if (!WRITE_TOOLS.has(name)) throw new Error('確認できない操作です。')
  const tool = actorTools(actor).get(name)!
  const args = tool.validate(input)
  const snapshot = await contextSnapshot(actor, name, args)
  const proposal = { id: crypto.randomUUID(), owner: actor.user.discordUserId, name, arguments: args, expiresAt: now + 300000, snapshot: snapshot.hash }
  const payload = encode(new TextEncoder().encode(JSON.stringify(proposal)))
  const signature = encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(actor.sessionToken), new TextEncoder().encode(payload))))
  return { name, arguments: args, token: `${payload}.${signature}`, label: HIYORI_ACTION_LABELS[name] ?? '内容を確認', expiresAt: proposal.expiresAt, ...(snapshot.title ? { eventTitle: snapshot.title } : {}), ...(snapshot.subject ? { subject: snapshot.subject } : {}) }
}

export async function confirmHiyoriAction(actor: HiyoriActor, token: string, now = Date.now()) {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra || !await crypto.subtle.verify('HMAC', await key(actor.sessionToken), decode(signature), new TextEncoder().encode(payload))) throw new Error('確認情報が無効です。内容を再確認してください。')
  const proposal = proposalSchema.parse(JSON.parse(new TextDecoder().decode(decode(payload))))
  if (proposal.owner !== actor.user.discordUserId || proposal.expiresAt <= now || proposal.expiresAt > now + 300000 || !WRITE_TOOLS.has(proposal.name)) throw new Error('確認の期限切れか、アカウントが変わりました。')
  const tool = actorTools(actor).get(proposal.name)!
  const args = tool.validate(proposal.arguments)
  const snapshot = await contextSnapshot(actor, proposal.name, args)
  if (snapshot.hash !== proposal.snapshot) throw new Error('確認後にイベントや回答が変わりました。最新の内容を確認し直してください。')
  const hash = await digest(payload)
  // Consume atomically before invoking any mutation. An uncertain result never
  // retries; old receipts can be removed only after their signed token expired.
  await actor.env.DB.prepare('DELETE FROM hiyori_action_receipts WHERE createdAt < ?').bind(now - 86400000).run()
  const consumed = await actor.env.DB.prepare('INSERT INTO hiyori_action_receipts (id, ownerDiscordId, actionHash, status, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(proposal.id, actor.user.discordUserId, hash, 'processing', now).run()
  if (consumed.meta.changes !== 1) throw new Error('この確認は送信済みです。再送せず、現在の状態を確認してください。')
  let status = 'uncertain'
  try {
    const result = await tool.execute(args)
    status = result.isError ? 'failed' : 'completed'
    return { name: proposal.name, data: toolData(result) }
  } finally {
    await actor.env.DB.prepare('UPDATE hiyori_action_receipts SET status = ? WHERE id = ?').bind(status, proposal.id).run()
  }
}
