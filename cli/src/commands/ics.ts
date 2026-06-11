import * as fs from 'node:fs/promises'
import { Command } from 'commander'
import { resolveApiUrl, resolveToken } from '../config.js'
import { fail } from '../output.js'

export function icsCommand(): Command {
  return new Command('ics')
    .description('Download decision ICS for an event (--json is no-op; ICS is plain text)')
    .argument('<id>', 'Event ID')
    .option('-o, --output <file>', 'Write to file instead of stdout')
    .action(async (id: string, opts: { output?: string }, cmd: Command) => {
      const parentOpts = cmd.parent?.opts<{ apiUrl?: string }>() ?? {}
      const apiUrl = await resolveApiUrl({ flag: parentOpts.apiUrl })
      const token = await resolveToken({ apiUrl })

      const url = `${apiUrl.replace(/\/$/, '')}/api/events/${encodeURIComponent(id)}/decision.ics`
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(url, { headers })

      if (res.status === 404) {
        fail('確定がありません（decision.ics not found）')
        return
      }

      if (!res.ok) {
        fail(`エラー: HTTP ${res.status}`)
        return
      }

      const text = await res.text()

      if (opts.output) {
        await fs.writeFile(opts.output, text, 'utf-8')
        console.log(`${opts.output} に保存しました`)
      } else {
        process.stdout.write(text)
      }
    })
}
