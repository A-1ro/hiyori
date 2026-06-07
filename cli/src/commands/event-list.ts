import { Command } from 'commander'
import { createCliApi, unwrap } from '../api.js'
import { resolveApiUrl, resolveToken } from '../config.js'
import { printJson, printTable, fail } from '../output.js'

interface EventSummary {
  id: string
  title: string
  status: string
  deadline?: string
}

interface EventsResponse {
  organized: EventSummary[]
  participating: EventSummary[]
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDeadline(deadline?: string): string {
  if (!deadline) return '-'
  return new Date(deadline).toLocaleDateString('ja-JP')
}

export function eventListCommand(): Command {
  return new Command('list')
    .description('List events')
    .action(async (_opts, cmd: Command) => {
      const parentCmdOpts = cmd.parent?.parent?.opts<{ apiUrl?: string; json?: boolean }>() ?? {}
      const apiUrl = await resolveApiUrl({ flag: parentCmdOpts.apiUrl })
      const token = await resolveToken({ apiUrl })

      if (!token) {
        fail('hiyori login を実行してください')
        return
      }

      const api = createCliApi(apiUrl, token)

      let data: EventsResponse
      try {
        data = await unwrap<EventsResponse>(await api.api.me.events.$get())
      } catch (err) {
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentCmdOpts.json) {
        printJson(data)
        return
      }

      console.log('=== Organized ===')
      if (data.organized.length === 0) {
        console.log('(なし)')
      } else {
        printTable(
          ['ID', 'Title', 'Status', 'Deadline'],
          data.organized.map((e) => [shortId(e.id), e.title, e.status, formatDeadline(e.deadline)]),
        )
      }

      console.log('')
      console.log('=== Participating ===')
      if (data.participating.length === 0) {
        console.log('(なし)')
      } else {
        printTable(
          ['ID', 'Title', 'Status', 'Deadline'],
          data.participating.map((e) => [shortId(e.id), e.title, e.status, formatDeadline(e.deadline)]),
        )
      }
    })
}
