import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { unwrap, HiyoriApiError, resolveParent, requireAuthedApi } from './_shared.js'
import { printJson, fail } from '../output.js'

interface Decision {
  id: string
  candidateId: string
}

interface EventSummary {
  id: string
  title: string
  status: string
}

interface DecisionResponse {
  decisions: Decision[]
  event: EventSummary
}

export function confirmCommand(): Command {
  return new Command('confirm')
    .description('Confirm event candidates (set decision)')
    .argument('<id>', 'Event ID')
    .argument('<candidateId...>', 'Candidate ID(s) to confirm')
    .action(async (id: string, candidateIds: string[], _opts, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      let data: DecisionResponse
      try {
        data = await unwrap<DecisionResponse>(
          await api.api.events[':id'].decision.$post({
            param: { id },
            json: { candidateIds },
          }),
        )
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 403) {
          fail('権限がありません（主催者のみ確定できます）')
          return
        }
        if (err instanceof HiyoriApiError && err.status === 401) {
          fail('認証エラー: hiyori login を再実行してください')
          return
        }
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`イベントが見つかりません: ${id}`)
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentOpts.json) {
        printJson(data)
        return
      }

      console.log(`イベントを確定しました`)
      console.log(`イベント: ${data.event.id} (${data.event.status})`)
      console.log(`確定数:   ${data.decisions.length}`)
    })
}

export function unconfirmCommand(): Command {
  return new Command('unconfirm')
    .description('Cancel event decision')
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
          message: `イベント ${id} の確定を解除しますか？`,
        })
        if (clack.isCancel(confirmed) || !confirmed) {
          console.log('キャンセルされました')
          return
        }
      }

      let data: DecisionResponse
      try {
        data = await unwrap<DecisionResponse>(
          await api.api.events[':id'].decision.$delete({ param: { id } }),
        )
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 403) {
          fail('権限がありません（主催者のみ解除できます）')
          return
        }
        if (err instanceof HiyoriApiError && err.status === 401) {
          fail('認証エラー: hiyori login を再実行してください')
          return
        }
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`イベントが見つかりません: ${id}`)
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentOpts.json) {
        printJson(data)
        return
      }

      console.log(`確定を解除しました`)
      console.log(`イベント: ${data.event.id} (${data.event.status})`)
    })
}
