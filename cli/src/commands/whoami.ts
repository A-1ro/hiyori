import { Command } from 'commander'
import { createCliApi, unwrap } from '../api.js'
import { resolveApiUrl, resolveToken } from '../config.js'
import { printJson, fail } from '../output.js'

interface MeResponse {
  user: {
    userId: string
    discordUserId: string
    username: string
    globalName: string | null
    avatar: string | null
    displayName: string
  } | null
}

export function whoamiCommand(): Command {
  return new Command('whoami')
    .description('Show current logged-in user')
    .action(async (_opts, cmd: Command) => {
      const parentOpts = cmd.parent?.opts<{ apiUrl?: string; json?: boolean }>() ?? {}
      const apiUrl = await resolveApiUrl({ flag: parentOpts.apiUrl })
      const token = await resolveToken({ apiUrl })

      const api = createCliApi(apiUrl, token ?? undefined)

      let data: MeResponse
      try {
        data = await unwrap<MeResponse>(await api.api.auth.me.$get())
      } catch (err) {
        fail(`エラー: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      if (!data.user) {
        fail('未ログイン')
        return
      }

      if (parentOpts.json) {
        printJson(data.user)
        return
      }

      const u = data.user
      console.log(`displayName: ${u.displayName}`)
      console.log(`username:    ${u.username}`)
      console.log(`discordId:   ${u.discordUserId}`)
    })
}
