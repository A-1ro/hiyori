import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { unwrap, HiyoriApiError, resolveParent, requireAuthedApi } from './_shared.js'
import { printJson, fail } from '../output.js'

interface Candidate {
  id: string
  startAt: string
  endAt: string
}

interface EventDetail {
  id: string
  title: string
  description?: string
  status: string
  timezone: string
  defaultDurationMinutes: number
  deadline?: string
}

interface CreateEventResponse {
  event: EventDetail
  candidates: Candidate[]
}

function collectCandidate(val: string, acc: string[]): string[] {
  acc.push(val)
  return acc
}

export function eventCreateCommand(): Command {
  return new Command('create')
    .description('Create a new event')
    .option('--title <title>', 'Event title')
    .option('--description <desc>', 'Event description')
    .option('--duration <min>', 'Default duration in minutes', (v) => parseInt(v, 10))
    .option('--deadline <iso>', 'Deadline (ISO 8601)')
    .option('--timezone <tz>', 'Timezone (default: UTC)')
    .option('--candidate <iso>', 'Candidate start time (repeat for multiple)', collectCandidate, [] as string[])
    .option('--yes', 'Skip interactive prompts')
    .action(async (opts: { title?: string; description?: string; duration?: number; deadline?: string; timezone?: string; candidate: string[]; yes?: boolean }, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      const hasRequiredFlags = opts.title && opts.duration && opts.candidate.length > 0
      const nonInteractive = opts.yes || hasRequiredFlags

      let title = opts.title ?? ''
      let description = opts.description
      let duration = opts.duration ?? 0
      let deadline = opts.deadline
      let timezone = opts.timezone ?? 'UTC'
      let candidateStarts = opts.candidate

      if (!nonInteractive) {
        if (!process.stdout.isTTY) {
          fail('対話モードには TTY が必要です。--title 等のフラグを指定してください')
          return
        }

        clack.intro('イベント作成')

        const titleResult = await clack.text({
          message: 'イベントタイトル',
          initialValue: title,
          validate: (v) => (v?.trim() ? undefined : 'タイトルは必須です'),
        })
        if (clack.isCancel(titleResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        title = titleResult as string

        const descResult = await clack.text({
          message: '説明（任意）',
          initialValue: description ?? '',
        })
        if (clack.isCancel(descResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        description = (descResult as string) || undefined

        const durResult = await clack.text({
          message: 'デフォルト所要時間（分）',
          initialValue: String(duration || 60),
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
        duration = parseInt(durResult as string, 10)

        const candidateInputs: string[] = []
        let addMore = true
        while (addMore) {
          const startResult = await clack.text({
            message: `候補日時 ${candidateInputs.length + 1} の開始時刻 (ISO 8601, 空白で終了)`,
          })
          if (clack.isCancel(startResult)) {
            clack.cancel('キャンセルされました')
            fail('キャンセルされました')
            return
          }
          const startVal = (startResult as string).trim()
          if (!startVal) {
            if (candidateInputs.length === 0) {
              fail('少なくとも 1 つの候補日時が必要です')
              return
            }
            addMore = false
          } else {
            candidateInputs.push(startVal)
          }
        }
        candidateStarts = candidateInputs

        const dlResult = await clack.text({
          message: '締切日時（ISO 8601, 任意）',
          initialValue: deadline ?? '',
        })
        if (clack.isCancel(dlResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        deadline = (dlResult as string) || undefined

        const tzResult = await clack.text({
          message: 'タイムゾーン',
          initialValue: timezone,
        })
        if (clack.isCancel(tzResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        timezone = (tzResult as string) || 'UTC'
      }

      if (!title) {
        fail('タイトルは必須です')
        return
      }
      if (!duration || duration < 1) {
        fail('所要時間は必須です（1〜1440 分）')
        return
      }
      if (candidateStarts.length === 0) {
        fail('少なくとも 1 つの候補日時が必要です')
        return
      }

      const candidates = candidateStarts.map((startAt) => ({ startAt }))

      const body: {
        title: string
        defaultDurationMinutes: number
        candidates: { startAt: string }[]
        description?: string
        deadline?: string
        timezone?: string
      } = {
        title,
        defaultDurationMinutes: duration,
        candidates,
      }
      if (description) body.description = description
      if (deadline) body.deadline = deadline
      if (timezone && timezone !== 'UTC') body.timezone = timezone

      let data: CreateEventResponse
      try {
        data = await unwrap<CreateEventResponse>(await api.api.events.$post({ json: body }))
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 400) {
          fail(`入力エラー: ${err.message}`)
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

      console.log(`イベントを作成しました`)
      console.log(`ID:       ${data.event.id}`)
      console.log(`タイトル: ${data.event.title}`)
      console.log(`候補数:   ${data.candidates.length}`)
      console.log('')
      console.log('注意: このイベントは Discord チャンネルに連携されていません（連携するには /hiyori new から作成してください）')
    })
}
