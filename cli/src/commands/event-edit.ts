import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { unwrap, HiyoriApiError, resolveParent, requireAuthedApi } from './_shared.js'
import { printJson, fail } from '../output.js'

interface EventDetail {
  id: string
  title: string
  description?: string
  status: string
  timezone: string
  defaultDurationMinutes: number
  deadline?: string
}

interface EventResponse {
  event: EventDetail
}

export function eventEditCommand(): Command {
  return new Command('edit')
    .description('Edit an event')
    .argument('<id>', 'Event ID')
    .option('--title <title>', 'New title')
    .option('--description <desc>', 'New description')
    .option('--deadline <iso|->', 'New deadline (use "-" to clear)')
    .option('--clear-deadline', 'Clear the deadline')
    .option('--duration <min>', 'New default duration in minutes', (v) => parseInt(v, 10))
    .option('--timezone <tz>', 'New timezone')
    .action(async (id: string, opts: { title?: string; description?: string; deadline?: string; clearDeadline?: boolean; duration?: number; timezone?: string }, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      const hasAnyFlag = opts.title !== undefined || opts.description !== undefined || opts.deadline !== undefined || opts.clearDeadline || opts.duration !== undefined || opts.timezone !== undefined

      const body: {
        title?: string
        description?: string
        deadline?: string | null
        defaultDurationMinutes?: number
        timezone?: string
      } = {}

      if (hasAnyFlag) {
        if (opts.title !== undefined) body.title = opts.title
        if (opts.description !== undefined) body.description = opts.description
        if (opts.clearDeadline || opts.deadline === '-') {
          body.deadline = null
        } else if (opts.deadline !== undefined) {
          body.deadline = opts.deadline
        }
        if (opts.duration !== undefined) body.defaultDurationMinutes = opts.duration
        if (opts.timezone !== undefined) body.timezone = opts.timezone
      } else {
        // 対話モード: 現状を取得してデフォルト表示
        let current: EventDetail
        try {
          const res = await unwrap<EventResponse>(await api.api.events[':id'].$get({ param: { id } }))
          current = res.event
        } catch (err) {
          if (err instanceof HiyoriApiError && err.status === 404) {
            fail(`イベントが見つかりません: ${id}`)
            return
          }
          fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
          return
        }

        if (!process.stdout.isTTY) {
          fail('対話モードには TTY が必要です。--title 等のフラグを指定してください')
          return
        }

        clack.intro('イベント編集')

        const titleResult = await clack.text({
          message: 'タイトル',
          initialValue: current.title,
        })
        if (clack.isCancel(titleResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        if ((titleResult as string) !== current.title) body.title = titleResult as string

        const descResult = await clack.text({
          message: '説明（空白でクリア）',
          initialValue: current.description ?? '',
        })
        if (clack.isCancel(descResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        if ((descResult as string) !== (current.description ?? '')) {
          body.description = (descResult as string) || undefined
        }

        const durResult = await clack.text({
          message: 'デフォルト所要時間（分）',
          initialValue: String(current.defaultDurationMinutes),
          validate: (v) => {
            const n = parseInt(v ?? '', 10)
            if (Number.isNaN(n) || n < 1 || n > 1440) return '1〜1440 の数値を入力してください'
            return undefined
          },
        })
        if (clack.isCancel(durResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        const newDur = parseInt(durResult as string, 10)
        if (newDur !== current.defaultDurationMinutes) body.defaultDurationMinutes = newDur

        const dlResult = await clack.text({
          message: '締切日時（ISO 8601, 空白でクリア, "-" でクリア）',
          initialValue: current.deadline ?? '',
        })
        if (clack.isCancel(dlResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        const dlVal = (dlResult as string).trim()
        if (dlVal === '' || dlVal === '-') {
          if (current.deadline) body.deadline = null
        } else if (dlVal !== current.deadline) {
          body.deadline = dlVal
        }

        const tzResult = await clack.text({
          message: 'タイムゾーン',
          initialValue: current.timezone,
        })
        if (clack.isCancel(tzResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        if ((tzResult as string) !== current.timezone) body.timezone = tzResult as string
      }

      if (Object.keys(body).length === 0) {
        console.log('変更なし')
        return
      }

      let data: EventResponse
      try {
        data = await unwrap<EventResponse>(await api.api.events[':id'].$patch({ param: { id }, json: body }))
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`イベントが見つかりません: ${id}`)
          return
        }
        if (err instanceof HiyoriApiError && err.status === 403) {
          fail('権限がありません（主催者のみ編集可能です）')
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentOpts.json) {
        printJson(data)
        return
      }

      console.log(`イベントを更新しました`)
      console.log(`ID:       ${data.event.id}`)
      console.log(`タイトル: ${data.event.title}`)
    })
}
