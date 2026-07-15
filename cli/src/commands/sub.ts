import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { unwrap, HiyoriApiError, resolveParent, requireAuthedApi, expectNoContent } from './_shared.js'
import { printJson, printTable, fail } from '../output.js'

interface Subscription {
  id: string
  scope: string
  createdAt: string
  lastAccessedAt: string | null
}

interface SubscriptionsResponse {
  // 一覧 API は URL を復元できない（サーバーは tokenHash のみ保存）ため常に null
  subscriptions: (Subscription & { webcalUrl: string | null })[]
}

interface SubscriptionWithUrl {
  subscription: Subscription
  // 新規発行 (201) / 再生成では生 URL、既に購読済み (200) の add では null
  webcalUrl: string | null
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function subListCommand(): Command {
  return new Command('list')
    .description('List calendar subscriptions')
    .action(async (_opts, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      let data: SubscriptionsResponse
      try {
        data = await unwrap<SubscriptionsResponse>(await api.api.me.subscriptions.$get())
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 401) {
          fail('認証エラー: hiyori login を再実行してください')
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentOpts.json) {
        printJson(data)
        return
      }

      if (data.subscriptions.length === 0) {
        console.log('(サブスクリプションなし)')
        return
      }

      printTable(
        ['ID', 'Scope', 'WebcalURL', 'LastAccessedAt'],
        data.subscriptions.map((s) => [
          shortId(s.id),
          s.scope,
          s.webcalUrl ?? '(発行時のみ表示)',
          s.lastAccessedAt ?? '-',
        ]),
      )
    })
}

function subAddCommand(): Command {
  return new Command('add')
    .description('Add a calendar subscription')
    .action(async (_opts, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      let data: SubscriptionWithUrl
      try {
        data = await unwrap<SubscriptionWithUrl>(await api.api.subscriptions.$post({ json: {} }))
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 401) {
          fail('認証エラー: hiyori login を再実行してください')
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentOpts.json) {
        printJson(data)
        return
      }

      if (data.webcalUrl) {
        console.log(`カレンダーサブスクリプションを追加しました`)
        console.log(`WebcalURL: ${data.webcalUrl}`)
        console.log(`ID:        ${data.subscription.id}`)
      } else {
        console.log('すでに購読済みです。URL を取り直すには hiyori sub regen を実行してください')
        console.log(`ID:        ${data.subscription.id}`)
      }
    })
}

function subRmCommand(): Command {
  return new Command('rm')
    .description('Remove a calendar subscription')
    .argument('<id>', 'Subscription ID')
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
          message: `サブスクリプション ${id} を削除しますか？`,
        })
        if (clack.isCancel(confirmed) || !confirmed) {
          console.log('キャンセルされました')
          return
        }
      }

      try {
        const res = await api.api.subscriptions[':id'].$delete({ param: { id } })
        const ok = await expectNoContent(res)
        if (!ok) return
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`サブスクリプションが見つかりません: ${id}`)
          return
        }
        if (err instanceof HiyoriApiError && err.status === 401) {
          fail('認証エラー: hiyori login を再実行してください')
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      console.log(`サブスクリプション ${id} を削除しました`)
    })
}

function subRegenCommand(): Command {
  return new Command('regen')
    .description('Regenerate a calendar subscription token')
    .argument('<id>', 'Subscription ID')
    .action(async (id: string, _opts, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      let data: SubscriptionWithUrl
      try {
        data = await unwrap<SubscriptionWithUrl>(
          await api.api.subscriptions[':id'].regenerate.$post({ param: { id } }),
        )
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`サブスクリプションが見つかりません: ${id}`)
          return
        }
        if (err instanceof HiyoriApiError && err.status === 401) {
          fail('認証エラー: hiyori login を再実行してください')
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentOpts.json) {
        printJson(data)
        return
      }

      console.log(`新しい WebcalURL: ${data.webcalUrl}`)
      console.log('注意: 旧 URL は無効になりました')
    })
}

export function subCommand(): Command {
  const cmd = new Command('sub').description('Manage calendar subscriptions')
  cmd.addCommand(subListCommand())
  cmd.addCommand(subAddCommand())
  cmd.addCommand(subRmCommand())
  cmd.addCommand(subRegenCommand())
  return cmd
}
