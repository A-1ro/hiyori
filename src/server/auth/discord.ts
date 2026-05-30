import type { Env } from '../index'

const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize'
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token'
const DISCORD_ME_URL = 'https://discord.com/api/v10/users/@me'

export function buildAuthorizeUrl(env: Env, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.DISCORD_CLIENT_ID!,
    scope: 'identify',
    state,
    redirect_uri: redirectUri,
    prompt: 'consent',
  })
  return `${DISCORD_AUTHORIZE_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(env: Env, code: string, redirectUri: string): Promise<{ access_token: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: env.DISCORD_CLIENT_ID!,
    client_secret: env.DISCORD_CLIENT_SECRET!,
  })
  const res = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
  return (await res.json()) as { access_token: string }
}

export type DiscordMe = {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
}

export async function fetchDiscordMe(accessToken: string): Promise<DiscordMe> {
  const res = await fetch(DISCORD_ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`fetchDiscordMe failed: ${res.status}`)
  return (await res.json()) as DiscordMe
}
