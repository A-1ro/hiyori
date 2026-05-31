import type { Env } from '../index'

export class DiscordApiError extends Error {
  status: number
  code?: number

  constructor(message: string, status: number, code?: number) {
    super(message)
    this.name = 'DiscordApiError'
    this.status = status
    this.code = code
  }
}

export async function postDecisionMessage(
  env: Env,
  args: { channelId: string; embed: object; components: object[] },
): Promise<{ messageId: string }> {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${args.channelId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [args.embed],
        components: args.components,
        allowed_mentions: { parse: [] },
      }),
    },
  )

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { code?: number; message?: string }
    throw new DiscordApiError(body.message ?? 'Discord API error', res.status, body.code)
  }

  const data = await res.json() as { id: string }
  return { messageId: data.id }
}

export async function editDecisionMessage(
  env: Env,
  args: { channelId: string; messageId: string; embed: object; components: object[] },
): Promise<void> {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${args.channelId}/messages/${args.messageId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [args.embed],
        components: args.components,
        allowed_mentions: { parse: [] },
      }),
    },
  )

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { code?: number; message?: string }
    throw new DiscordApiError(body.message ?? 'Discord API error', res.status, body.code)
  }
}

