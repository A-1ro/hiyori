import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { unwrap, HiyoriApiError, resolveParent, requireAuthedApi, expectNoContent } from './_shared.js'
import { parseInviteId, parseInviteUsername } from './_invites.js'
import { printJson, printTable, fail } from '../output.js'

interface EventInvite {
  id: string
  eventId: string
  discordUsername: string | null
  discordUserId: string | null
  claimedAt: string | null
  createdAt: string
}

function inviteLabel(invite: EventInvite): string {
  return invite.discordUsername ? `@${invite.discordUsername}` : `Discord ID: ${invite.discordUserId ?? '-'}`
}

function reportInviteError(err: unknown): void {
  if (err instanceof HiyoriApiError) {
    if (err.status === 401) {
      fail('認証エラー: hiyori login を再実行してください')
      return
    }
    if (err.status === 404 || err.status === 403) {
      fail('イベントまたは招待が見つからないか、主催者の権限がありません')
      return
    }
    if (err.status === 400 || err.status === 409) {
      fail(`入力エラー: ${err.message}`)
      return
    }
  }
  fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
}

function inviteListCommand(): Command {
  return new Command('list')
    .description('List invitations (event organizer only; includes stable invitation IDs)')
    .argument('<id>', 'Event ID')
    .action(async (id: string, _opts, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      try {
        const data = await unwrap<{ invites: EventInvite[] }>(
          await authed.api.api.events[':id'].invites.$get({ param: { id } }),
        )
        if (parentOpts.json) {
          printJson(data)
          return
        }
        if (data.invites.length === 0) {
          console.log('招待はありません')
          return
        }
        printTable(['招待 ID（取消用）', '招待先', '状態'], data.invites.map((invite) => [
          invite.id,
          inviteLabel(invite),
          invite.discordUserId ? '確定済み' : '未確定（アクセス時に現在のユーザー名を照合）',
        ]))
      } catch (err) {
        reportInviteError(err)
      }
    })
}

function inviteAddCommand(): Command {
  return new Command('add')
    .description('Invite a Discord username (event organizer only)')
    .argument('<id>', 'Event ID')
    .requiredOption('--username <username>', 'Discord username (optional leading @; not a display name or user ID)', parseInviteUsername)
    .action(async (id: string, opts: { username: string }, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      try {
        const data = await unwrap<{ invite: EventInvite }>(
          await authed.api.api.events[':id'].invites.$post({
            param: { id },
            json: { discordUsername: opts.username },
          }),
        )
        if (parentOpts.json) {
          printJson(data)
          return
        }
        console.log(`招待を登録しました: ${inviteLabel(data.invite)}`)
        console.log(`招待 ID: ${data.invite.id}`)
        console.log('招待の追加だけでは公開範囲は変わりません（制限するには event edit --visibility invite_only を使用してください）')
        if (!data.invite.discordUserId) {
          console.log('相手にイベント URL を共有してください。ログイン済みならそのままアクセスして招待を受け取れます。未ログインの場合は Discord ログインが必要です')
        }
      } catch (err) {
        reportInviteError(err)
      }
    })
}

function inviteRevokeCommand(): Command {
  return new Command('revoke')
    .description('Revoke an invitation by its stable invitation ID (event organizer only)')
    .argument('<id>', 'Event ID')
    .argument('<inviteId>', 'Invitation UUID from invite list (not a Discord user ID)', parseInviteId)
    .option('--yes', 'Skip confirmation (required with --json or without a TTY)')
    .action(async (id: string, inviteId: string, opts: { yes?: boolean }, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      if (!opts.yes && (parentOpts.json || !process.stdout.isTTY)) {
        fail('招待の取消を確認なしで実行するには --yes を指定してください')
        return
      }
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      if (!opts.yes) {
        const confirmed = await clack.confirm({
          message: `招待 ${inviteId} を取り消しますか？（確定済みの場合、同じアカウントの招待も取り消されます）`,
        })
        if (clack.isCancel(confirmed) || !confirmed) {
          console.log('キャンセルされました')
          return
        }
      }

      try {
        // REST retains the legacy parameter name. The CLI accepts only stable
        // invitation UUIDs, including for old numeric-ID invitation records.
        const response = await authed.api.api.events[':id'].invites[':discordUserId'].$delete({
          param: { id, discordUserId: inviteId },
        })
        if (!(await expectNoContent(response))) return
        if (parentOpts.json) {
          printJson({ revoked: true, eventId: id, inviteId })
          return
        }
        console.log(`招待 ${inviteId} を取り消しました`)
      } catch (err) {
        reportInviteError(err)
      }
    })
}

export function inviteCommand(): Command {
  const cmd = new Command('invite').description('Manage event invitations (organizer only)')
  cmd.addCommand(inviteListCommand())
  cmd.addCommand(inviteAddCommand())
  cmd.addCommand(inviteRevokeCommand())
  return cmd
}
