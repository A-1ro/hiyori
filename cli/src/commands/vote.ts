import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { unwrap, HiyoriApiError, resolveParent, requireAuthedApi } from './_shared.js'
import { printJson, fail } from '../output.js'

interface Candidate {
  id: string
  startAt: string
  endAt: string
}

interface EventResponse {
  event: { id: string; title: string; status: string }
  candidates: Candidate[]
}

interface Participant {
  id: string
  displayName: string
}

interface Vote {
  candidateId: string
  choice: 'yes' | 'maybe' | 'no'
  comment?: string
}

interface VotesMeResponse {
  participant: Participant | null
  votes: Vote[]
}

interface VotesResponse {
  votes: Vote[]
}

function collectVoteArg(val: string, acc: string[]): string[] {
  acc.push(val)
  return acc
}

export function voteCommand(): Command {
  return new Command('vote')
    .description('Vote on event candidates')
    .argument('<id>', 'Event ID')
    .option('--name <name>', 'Display name (required if not registered)')
    .option('--vote <candidateId=choice>', 'Vote (repeat for multiple, e.g. --vote cand-id=yes)', collectVoteArg, [] as string[])
    .action(async (id: string, opts: { name?: string; vote: string[] }, cmd: Command) => {
      const parentOpts = resolveParent(cmd)
      const authed = await requireAuthedApi(parentOpts)
      if (!authed) return

      const { api } = authed

      // Step 1: Get event with candidates
      let eventData: EventResponse
      try {
        eventData = await unwrap<EventResponse>(await api.api.events[':id'].$get({ param: { id } }))
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`イベントが見つかりません: ${id}`)
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      const candidates = eventData.candidates

      // Step 2: Get current votes/participant
      let votesMeData: VotesMeResponse
      try {
        votesMeData = await unwrap<VotesMeResponse>(await api.api.events[':id'].votes.me.$get({ param: { id } }))
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 403) {
          fail('投票できません（締切超過または非公開イベント）')
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      let participant = votesMeData.participant
      const currentVotes = votesMeData.votes

      // Step 3: Register as participant if not already
      if (!participant) {
        let displayName = opts.name

        if (!displayName) {
          if (!process.stdout.isTTY) {
            fail('未登録の参加者です。--name で表示名を指定してください')
            return
          }

          const nameResult = await clack.text({
            message: '表示名（Discord 表示名）',
            validate: (v) => (v.trim() ? undefined : '表示名は必須です'),
          })
          if (clack.isCancel(nameResult)) {
            clack.cancel('キャンセルされました')
            fail('キャンセルされました')
            return
          }
          displayName = nameResult as string
        }

        try {
          const regRes = await unwrap<{ participant: Participant }>(
            await api.api.events[':id'].participants.$post({
              param: { id },
              json: { kind: 'discord', displayName },
            }),
          )
          participant = regRes.participant
        } catch (err) {
          if (err instanceof HiyoriApiError && err.status === 403) {
            fail('参加登録できません（締切超過）')
            return
          }
          fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
          return
        }
      }

      // Step 4: Collect votes
      const currentVoteMap = new Map<string, Vote>()
      for (const v of currentVotes) {
        currentVoteMap.set(v.candidateId, v)
      }

      const votes: Vote[] = []

      const nonInteractive = opts.vote.length > 0
      if (nonInteractive) {
        for (const voteStr of opts.vote) {
          const eqIdx = voteStr.indexOf('=')
          if (eqIdx < 0) {
            fail(`無効な --vote 形式: ${voteStr}（candidateId=yes|maybe|no の形式で指定してください）`)
            return
          }
          const candidateId = voteStr.slice(0, eqIdx)
          const choice = voteStr.slice(eqIdx + 1)
          if (choice !== 'yes' && choice !== 'maybe' && choice !== 'no') {
            fail(`無効な選択: ${choice}（yes / maybe / no のいずれかを指定してください）`)
            return
          }
          const existing = currentVoteMap.get(candidateId)
          const vote: Vote = { candidateId, choice }
          if (existing?.comment) vote.comment = existing.comment
          votes.push(vote)
        }
      } else {
        if (!process.stdout.isTTY) {
          fail('対話モードには TTY が必要です。--vote フラグを指定してください')
          return
        }

        const choiceOptions = [
          { value: 'yes', label: '○ yes' },
          { value: 'maybe', label: '△ maybe' },
          { value: 'no', label: '× no' },
        ]

        for (const cand of candidates) {
          const existing = currentVoteMap.get(cand.id)
          const defaultChoice = existing?.choice ?? 'no'

          const choiceResult = await clack.select({
            message: `${cand.startAt} (${cand.id.slice(0, 8)})`,
            options: choiceOptions,
            initialValue: defaultChoice,
          })
          if (clack.isCancel(choiceResult)) {
            clack.cancel('キャンセルされました')
            fail('キャンセルされました')
            return
          }

          const vote: Vote = {
            candidateId: cand.id,
            choice: choiceResult as 'yes' | 'maybe' | 'no',
          }

          const commentResult = await clack.text({
            message: 'コメント（任意）',
            initialValue: existing?.comment ?? '',
          })
          if (clack.isCancel(commentResult)) {
            clack.cancel('キャンセルされました')
            fail('キャンセルされました')
            return
          }
          const commentVal = (commentResult as string).trim()
          if (commentVal) vote.comment = commentVal

          votes.push(vote)
        }
      }

      // Step 5: PUT votes
      let data: VotesResponse
      try {
        data = await unwrap<VotesResponse>(
          await api.api.events[':id'].votes.$put({ param: { id }, json: { votes } }),
        )
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 403) {
          fail('投票できません（締切超過または非公開イベント）')
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

      console.log(`投票しました（${data.votes.length} 候補）`)
    })
}
