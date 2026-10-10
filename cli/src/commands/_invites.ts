import { InvalidArgumentError, Option } from 'commander'
import { isDiscordUsername, normalizeDiscordUsername } from '../../../src/shared/discord-invites.js'

export type EventVisibility = 'public' | 'invite_only'

export function visibilityOption(): Option {
  return new Option('--visibility <visibility>', 'Event visibility (default on create: public)')
    .choices(['public', 'invite_only'])
}

export function parseInviteUsername(value: string): string {
  const normalized = normalizeDiscordUsername(value)
  if (value.length > 128 || !isDiscordUsername(normalized)) {
    throw new InvalidArgumentError('Discord ユーザー名を指定してください（2〜32 文字の英数字・_・.、連続する . は不可。先頭の @ は任意）')
  }
  return normalized
}

export function collectInviteUsername(value: string, previous: string[]): string[] {
  if (previous.length >= 500) {
    throw new InvalidArgumentError('招待は最大 500 件です')
  }
  return [...previous, parseInviteUsername(value)]
}

export function parseInviteId(value: string): string {
  // Accept stable record UUIDs, never the legacy numeric Discord-user-ID
  // deletion route as a new CLI input surface.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new InvalidArgumentError('invite list に表示される招待 ID（UUID）を指定してください')
  }
  return value.toLowerCase()
}
