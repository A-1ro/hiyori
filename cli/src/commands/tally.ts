import { Command } from 'commander'
import { createCliApi, unwrap, HiyoriApiError } from '../api.js'
import { resolveApiUrl, resolveToken } from '../config.js'
import { printJson, fail } from '../output.js'

interface Participant {
  id: string
  displayName: string
}

interface VoteEntry {
  choice: 'yes' | 'maybe' | 'no'
  comment: string | null
  updatedAt: string
}

interface TallyCandidate {
  id: string
  startAt: string
  endAt: string
  totalScore: number
  counts: { yes: number; maybe: number; no: number }
  votesByParticipantId: Record<string, VoteEntry>
}

interface TallyEvent {
  id: string
  title: string
  status: string
  deadline?: string
  timezone: string
  defaultDurationMinutes: number
}

interface TallyResponse {
  event: TallyEvent
  participants: Participant[]
  candidates: TallyCandidate[]
  decisions: { candidateId: string; decidedAt: string }[]
}

const CHOICE_MARK: Record<string, string> = {
  yes: '○',
  maybe: '△',
  no: '×',
}

function formatDate(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', { timeZone: timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export function tallyCommand(): Command {
  return new Command('tally')
    .description('Show tally matrix for an event')
    .argument('<id>', 'Event ID')
    .action(async (id: string, _opts, cmd: Command) => {
      const parentOpts = cmd.parent?.opts<{ apiUrl?: string; json?: boolean }>() ?? {}
      const apiUrl = await resolveApiUrl({ flag: parentOpts.apiUrl })
      const token = await resolveToken({ apiUrl })

      const api = createCliApi(apiUrl, token ?? undefined)

      let data: TallyResponse
      try {
        data = await unwrap<TallyResponse>(
          await api.api.events[':id'].tally.$get({ param: { id } }),
        )
      } catch (err) {
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

      const { event, participants, candidates, decisions } = data
      const decidedCandidateIds = new Set(decisions.map((d) => d.candidateId))

      console.log(`${event.title} (${event.status})`)
      console.log('')

      if (participants.length === 0) {
        console.log('参加者なし')
        return
      }

      const tz = event.timezone || 'UTC'

      // Header row: candidate dates
      const candidateLabels = candidates.map((c) => {
        const label = formatDate(c.startAt, tz)
        return decidedCandidateIds.has(c.id) ? `[${label}]` : label
      })

      // Compute column widths
      const nameWidth = Math.max(8, ...participants.map((p) => p.displayName.length))
      const colWidths = candidateLabels.map((l) => Math.max(l.length, 6))

      // Print header
      const headerCells = ['Participant'.padEnd(nameWidth), ...candidateLabels.map((l, i) => l.padEnd(colWidths[i] ?? 0))]
      console.log(headerCells.join('  '))
      console.log('-'.repeat(headerCells.join('  ').length))

      // Print rows
      for (const p of participants) {
        const cells = [p.displayName.padEnd(nameWidth)]
        for (let i = 0; i < candidates.length; i++) {
          const cand = candidates[i]!
          const vote = cand.votesByParticipantId[p.id]
          const mark = vote ? (CHOICE_MARK[vote.choice] ?? '?') : '·'
          cells.push(mark.padEnd(colWidths[i] ?? 0))
        }
        console.log(cells.join('  '))
      }

      console.log('')
      console.log('Score/Counts:')
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]!
        const label = candidateLabels[i] ?? ''
        console.log(`  ${label}: score=${c.totalScore} ○${c.counts.yes} △${c.counts.maybe} ×${c.counts.no}`)
      }
    })
}
