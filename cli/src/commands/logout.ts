import { Command } from 'commander'
import { createCliApi } from '../api.js'
import { resolveApiUrl, resolveToken, clearCredentials } from '../config.js'

export function logoutCommand(): Command {
  return new Command('logout')
    .description('Log out from Hiyori')
    .action(async (_opts, cmd: Command) => {
      const parentOpts = cmd.parent?.opts<{ apiUrl?: string }>() ?? {}
      const apiUrl = await resolveApiUrl({ flag: parentOpts.apiUrl })
      const token = await resolveToken({ apiUrl })

      if (token) {
        const api = createCliApi(apiUrl, token)
        try {
          await api.api.auth.logout.$post()
        } catch {
          // ignore errors — still clear local credentials
        }
      }

      await clearCredentials()
      console.log('ログアウトしました')
    })
}
