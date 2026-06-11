import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { unwrap, HiyoriApiError, resolveParent, requireAuthedApi, expectNoContent } from './_shared.js'
import { printJson, fail } from '../output.js'

interface Candidate {
  id: string
  startAt: string
  endAt: string
}

interface AddCandidateResponse {
  candidate: Candidate
}

function candidateAddCommand(): Command {
  return new Command('add')
    .description('Add a candidate time slot to an event')
    .argument('<id>', 'Event ID')
    .option('--start <iso>', 'Start time (ISO 8601, required)')
    .option('--end <iso>', 'End time (ISO 8601, optional)')
    .action(async (id: string, opts: { start?: string; end?: string }, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      let startAt = opts.start
      let endAt = opts.end

      if (!startAt) {
        if (!process.stdout.isTTY) {
          fail('開始時刻は必須です。--start フラグを指定してください')
          return
        }

        clack.intro('候補日時追加')

        const startResult = await clack.text({
          message: '開始時刻 (ISO 8601)',
          validate: (v) => (v.trim() ? undefined : '開始時刻は必須です'),
        })
        if (clack.isCancel(startResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        startAt = startResult as string

        const endResult = await clack.text({
          message: '終了時刻 (ISO 8601, 任意)',
        })
        if (clack.isCancel(endResult)) {
          clack.cancel('キャンセルされました')
          fail('キャンセルされました')
          return
        }
        endAt = (endResult as string) || undefined
      }

      const body: { startAt: string; endAt?: string } = { startAt }
      if (endAt) body.endAt = endAt

      let data: AddCandidateResponse
      try {
        data = await unwrap<AddCandidateResponse>(
          await api.api.events[':id'].candidates.$post({ param: { id }, json: body }),
        )
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`イベントが見つかりません: ${id}`)
          return
        }
        if (err instanceof HiyoriApiError && err.status === 403) {
          fail('権限がありません（主催者のみ候補を追加できます）')
          return
        }
        if (err instanceof HiyoriApiError && err.status === 400) {
          fail(`入力エラー: ${err.message}`)
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentOpts.json) {
        printJson(data)
        return
      }

      console.log(`候補を追加しました`)
      console.log(`ID:      ${data.candidate.id}`)
      console.log(`開始:    ${data.candidate.startAt}`)
      console.log(`終了:    ${data.candidate.endAt}`)
    })
}

function candidateRmCommand(): Command {
  return new Command('rm')
    .description('Remove a candidate time slot from an event')
    .argument('<id>', 'Event ID')
    .argument('<candidateId>', 'Candidate ID')
    .option('--yes', 'Skip confirmation')
    .action(async (id: string, candidateId: string, opts: { yes?: boolean }, cmd: Command) => {
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
          message: `候補 ${candidateId} を削除しますか？`,
        })
        if (clack.isCancel(confirmed) || !confirmed) {
          console.log('キャンセルされました')
          return
        }
      }

      try {
        const res = await api.api.events[':id'].candidates[':candidateId'].$delete({
          param: { id, candidateId },
        })
        const ok = await expectNoContent(res)
        if (!ok) return
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`候補またはイベントが見つかりません`)
          return
        }
        if (err instanceof HiyoriApiError && err.status === 403) {
          fail('権限がありません（主催者のみ候補を削除できます）')
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      console.log(`候補 ${candidateId} を削除しました`)
    })
}

export function candidateCommand(): Command {
  const cmd = new Command('candidate').description('Manage event candidates')
  cmd.addCommand(candidateAddCommand())
  cmd.addCommand(candidateRmCommand())
  return cmd
}
