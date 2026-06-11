import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { HiyoriApiError, resolveParent, requireAuthedApi, expectNoContent } from './_shared.js'
import { fail } from '../output.js'

export function eventRmCommand(): Command {
  return new Command('rm')
    .description('Delete an event')
    .argument('<id>', 'Event ID')
    .option('--yes', 'Skip confirmation')
    .action(async (id: string, opts: { yes?: boolean }, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      if (!opts.yes) {
        if (!process.stdout.isTTY) {
          fail('確認をスキップするには --yes を指定してください')
          return
        }

        const confirmed = await clack.confirm({
          message: `イベント ${id} を削除しますか？この操作は元に戻せません。`,
        })
        if (clack.isCancel(confirmed) || !confirmed) {
          console.log('キャンセルされました')
          return
        }
      }

      try {
        const res = await api.api.events[':id'].$delete({ param: { id } })
        const ok = await expectNoContent(res)
        if (!ok) return
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`イベントが見つかりません: ${id}`)
          return
        }
        if (err instanceof HiyoriApiError && err.status === 403) {
          fail('権限がありません（主催者のみ削除可能です）')
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      console.log(`イベント ${id} を削除しました`)
    })
}
