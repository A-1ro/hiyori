/** Discord's unique modern username, never a display name or a legacy name#tag. */
export function normalizeDiscordUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase()
}

/** The caller normalizes first. Numeric-only usernames remain valid usernames. */
export function isDiscordUsername(value: string): boolean {
  return /^[a-z0-9_.]{2,32}$/.test(value) && !value.includes('..')
}
