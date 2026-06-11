import * as os from 'node:os'
import { Command } from 'commander'
import * as clack from '@clack/prompts'
import open from 'open'
import { createCliApi, HiyoriApiError } from '../api.js'
import { resolveApiUrl, writeCredentials } from '../config.js'
import { fail } from '../output.js'

export function loginCommand(): Command {
  return new Command('login')
    .description('Log in to Hiyori')
    .action(async (_opts, cmd: Command) => {
      const parentOpts = cmd.parent?.opts<{ apiUrl?: string }>() ?? {}
      const apiUrl = await resolveApiUrl({ flag: parentOpts.apiUrl })
      const api = createCliApi(apiUrl)

      const startRes = await api.api.auth.cli.start.$post({
        json: { clientName: 'hiyori-cli', hostname: os.hostname() },
      })

      if (!startRes.ok) {
        const body = (await startRes.json()) as { error?: string }
        fail(`ログイン開始に失敗しました: ${body.error ?? startRes.status}`)
        return
      }

      const startData = (await startRes.json()) as {
        deviceCode: string
        userCode: string
        verificationUri: string
        verificationUriComplete: string
        interval: number
        expiresIn: number
      }

      const { deviceCode, userCode, verificationUri, verificationUriComplete, interval, expiresIn } = startData

      clack.intro('Hiyori ログイン')

      let browserOpened = false
      try {
        await open(verificationUriComplete)
        browserOpened = true
      } catch {
        // ignore
      }

      if (!browserOpened) {
        clack.note(
          `ブラウザを開いてください:\n${verificationUri}\nコード: ${userCode}`,
          'ブラウザで認証',
        )
      } else {
        clack.note(`コード: ${userCode}`, 'ブラウザで承認してください')
      }

      const spinner = clack.spinner()
      spinner.start('認証を待機中...')

      const deadline = Date.now() + expiresIn * 1000
      let currentInterval = interval

      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, currentInterval * 1000))

        let pollRes: Awaited<ReturnType<typeof api['api']['auth']['cli']['poll']['$post']>>
        try {
          pollRes = await api.api.auth.cli.poll.$post({
            json: { deviceCode },
          })
        } catch (err) {
          spinner.stop('ネットワークエラー')
          fail(`ポーリング中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`)
          return
        }

        if (pollRes.status === 429) {
          const body = (await pollRes.json()) as { status: string; interval?: number }
          if (body.interval) currentInterval = body.interval
          continue
        }

        if (!pollRes.ok) {
          spinner.stop('エラー')
          fail(`ポーリングに失敗しました: HTTP ${pollRes.status}`)
          return
        }

        const pollData = (await pollRes.json()) as {
          status: string
          token?: string
          expiresAt?: string
          interval?: number
        }

        if (pollData.status === 'pending') {
          continue
        }

        if (pollData.status === 'approved' && pollData.token && pollData.expiresAt) {
          spinner.stop('認証完了')
          await writeCredentials({ token: pollData.token, expiresAt: pollData.expiresAt, apiUrl })
          clack.outro('ログインしました')
          return
        }

        if (pollData.status === 'denied') {
          spinner.stop('拒否されました')
          fail('ログインが拒否されました')
          return
        }

        if (pollData.status === 'expired' || pollData.status === 'expired_or_used') {
          spinner.stop('期限切れ')
          fail('コードの有効期限が切れました。再度 hiyori login を実行してください')
          return
        }
      }

      spinner.stop('タイムアウト')
      fail('認証がタイムアウトしました。再度 hiyori login を実行してください')
    })
}

export { HiyoriApiError }
