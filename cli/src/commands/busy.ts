import { Command } from 'commander'
import { createCliApi, unwrap } from '../api.js'
import { resolveApiUrl, resolveToken } from '../config.js'
import { printJson, fail } from '../output.js'

interface BusyResponse {
  startAts: string[]
}

export function busyCommand(): Command {
  return new Command('busy')
    .description('Show busy times')
    .action(async (_opts, cmd: Command) => {
      const parentOpts = cmd.parent?.opts<{ apiUrl?: string; json?: boolean }>() ?? {}
      const apiUrl = await resolveApiUrl({ flag: parentOpts.apiUrl })
      const token = await resolveToken({ apiUrl })

      if (!token) {
        fail('hiyori login を実行してください')
        return
      }

      const api = createCliApi(apiUrl, token)

      let data: BusyResponse
      try {
        data = await unwrap<BusyResponse>(await api.api.me.busy.$get())
      } catch (err) {
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (parentOpts.json) {
        printJson(data)
        return
      }

      if (data.startAts.length === 0) {
        console.log('確定済みの予定はありません')
        return
      }

      console.log('確定済みの予定:')
      for (const s of data.startAts) {
        console.log(`  ${new Date(s).toLocaleString('ja-JP')}`)
      }
    })
}
