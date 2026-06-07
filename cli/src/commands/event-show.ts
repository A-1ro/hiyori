import { Command } from 'commander'
import { createCliApi, unwrap, HiyoriApiError } from '../api.js'
import { resolveApiUrl, resolveToken } from '../config.js'
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
  deadline?: string
  timezone: string
  defaultDurationMinutes: number
}

interface EventResponse {
  event: EventDetail
  candidates: Candidate[]
}

interface PermissionsResponse {
  isOrganizer: boolean
}

export function eventShowCommand(): Command {
  return new Command('show')
    .description('Show event details')
    .argument('<id>', 'Event ID')
    .action(async (id: string, _opts, cmd: Command) => {
      const parentCmdOpts = cmd.parent?.parent?.opts<{ apiUrl?: string; json?: boolean }>() ?? {}
      const apiUrl = await resolveApiUrl({ flag: parentCmdOpts.apiUrl })
      const token = await resolveToken({ apiUrl })

      const api = createCliApi(apiUrl, token ?? undefined)

      let eventData: EventResponse
      let permsData: PermissionsResponse

      try {
        eventData = await unwrap<EventResponse>(
          await api.api.events[':id'].$get({ param: { id } }),
        )
      } catch (err) {
        if (err instanceof HiyoriApiError && err.status === 404) {
          fail(`イベントが見つかりません: ${id}`)
          return
        }
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      try {
        permsData = await unwrap<PermissionsResponse>(
          await api.api.events[':id'].permissions.$get({ param: { id } }),
        )
      } catch {
        permsData = { isOrganizer: false }
      }

      const combined = { ...eventData, isOrganizer: permsData.isOrganizer }

      if (parentCmdOpts.json) {
        printJson(combined)
        return
      }

      const e = eventData.event
      console.log(`ID:           ${e.id}`)
      console.log(`Title:        ${e.title}`)
      if (e.description) console.log(`Description:  ${e.description}`)
      console.log(`Status:       ${e.status}`)
      console.log(`Timezone:     ${e.timezone}`)
      console.log(`Duration:     ${e.defaultDurationMinutes}min`)
      if (e.deadline) console.log(`Deadline:     ${e.deadline}`)
      console.log(`isOrganizer:  ${permsData.isOrganizer}`)
      console.log('')
      console.log('Candidates:')
      for (const c of eventData.candidates) {
        console.log(`  ${c.startAt} - ${c.endAt}  (${c.id.slice(0, 8)})`)
      }
    })
}
