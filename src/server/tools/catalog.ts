import { z } from 'zod'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { HiyoriTools, type HiyoriToolContext, type HiyoriToolRegistrar } from './hiyori-tools'

// Annotations describe UX; this explicit list enforces the execution boundary.
export const READ_TOOLS = new Set(['hiyori_whoami', 'hiyori_list_events', 'hiyori_get_event', 'hiyori_tally', 'hiyori_get_my_votes', 'hiyori_get_ics', 'hiyori_list_invites', 'hiyori_my_busy', 'hiyori_list_subscriptions'])
export const WRITE_TOOLS = new Set(['hiyori_create_event', 'hiyori_edit_event', 'hiyori_vote', 'hiyori_confirm', 'hiyori_unconfirm', 'hiyori_delete_event', 'hiyori_add_candidate', 'hiyori_remove_candidate', 'hiyori_add_invite', 'hiyori_revoke_invite', 'hiyori_add_subscription', 'hiyori_remove_subscription', 'hiyori_regen_subscription'])
export type HiyoriTool = { name: string; description: string; annotations: ToolAnnotations; parameters: z.core.JSONSchema.JSONSchema; validate(input: unknown): Record<string, unknown>; execute(input: unknown): Promise<CallToolResult> }

export function hiyoriToolCatalog(context: HiyoriToolContext): Map<string, HiyoriTool> {
  const tools = new Map<string, HiyoriTool>()
  const registrar: HiyoriToolRegistrar = {
    registerTool(name, config, handler) {
      if (!READ_TOOLS.has(name) && !WRITE_TOOLS.has(name)) throw new Error('Unclassified tool')
      const schema = z.object(config.inputSchema).strict()
      tools.set(name, {
        name, description: config.description, annotations: config.annotations,
        parameters: z.toJSONSchema(schema),
        validate: (input) => schema.parse(input),
        execute: (input) => handler(schema.parse(input)),
      })
    },
  }
  new HiyoriTools(registrar, context).registerAll()
  return tools
}

export function toolData(result: CallToolResult): unknown {
  if (result.isError) throw new Error('操作を完了できませんでした。権限・入力・現在の状態を確認してください。')
  const text = result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  if (text.length > 2_000_000) throw new Error('結果が大きすぎます。対象を絞ってください。')
  try { return JSON.parse(text) } catch { return text }
}
