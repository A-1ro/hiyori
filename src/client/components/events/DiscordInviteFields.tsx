import { isDiscordUsername, normalizeDiscordUsername } from '../../../shared/discord-invites'
import { DiscordInviteInputs, useDiscordInviteRows } from './DiscordInviteInputs'

interface ExistingInvite {
  discordUserId: string | null
  discordUsername?: string | null
}

export function useDiscordInviteDraft() {
  const usernameRows = useDiscordInviteRows()
  return { usernameRows }
}

export function validateDiscordInviteNames(values: string[], existing: ExistingInvite[] = []) {
  const usernames = [...new Set(values.filter((value) => value.trim()).map(normalizeDiscordUsername))]
  const existingNames = new Set(existing.map((invite) => invite.discordUsername).filter(Boolean))
  const count = existing.length + usernames.filter((name) => !existingNames.has(name)).length
  const error = usernames.some((username) => !isDiscordUsername(username))
    ? 'Discord ユーザー名は、半角英小文字・数字・_・. の 2〜32 文字で入力してください。連続する .. は使えません。表示名やサーバー内の名前は指定できません。'
    : count > 500 ? '招待できるのは 500 人までです。' : undefined
  return { usernames, error }
}

export function validateDiscordInviteDraft(draft: ReturnType<typeof useDiscordInviteDraft>, existing: ExistingInvite[] = []) {
  return validateDiscordInviteNames(draft.usernameRows.rows.map((row) => row.value), existing)
}

export function DiscordInviteFields({ draft, id, describedBy, disabled, optional = false }: {
  draft: ReturnType<typeof useDiscordInviteDraft>
  id: string
  describedBy: string
  disabled?: boolean
  optional?: boolean
}) {
  const label = `招待する Discord ユーザー名${optional ? '（任意）' : ''}`
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-fg2)', marginBottom: 7 }}>{label}</label>
      <DiscordInviteInputs id={id} state={draft.usernameRows} label={label} describedBy={describedBy} disabled={disabled} />
      <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.6, color: 'var(--color-fg3)' }}>
        Discord のユーザー名を指定してください。表示名やサーバー内のニックネームではありません。
      </p>
    </div>
  )
}
