import { Command } from 'commander'
import { readConfig, writeConfig, DEFAULT_API_URL } from '../config.js'
import { fail } from '../output.js'

export function configCommand(): Command {
  const cmd = new Command('config').description('Manage configuration')

  const getCmd = new Command('get')
    .description('Get a configuration value')
    .argument('<key>', 'Configuration key (api-url)')
    .action(async (key: string, _opts, subCmd: Command) => {
      const parentOpts = subCmd.parent?.parent?.opts<{ apiUrl?: string }>() ?? {}

      if (key === 'api-url') {
        const flagVal = parentOpts.apiUrl
        const envVal = process.env.HIYORI_API_URL
        const config = await readConfig()
        const configVal = config.apiUrl

        let value: string
        let source: string

        if (flagVal) {
          value = flagVal
          source = 'flag'
        } else if (envVal) {
          value = envVal
          source = 'env'
        } else if (configVal) {
          value = configVal
          source = 'config'
        } else {
          value = DEFAULT_API_URL
          source = 'default'
        }

        console.log(`${value}  (source: ${source})`)
      } else {
        fail(`Unknown key: ${key}`)
      }
    })

  const setCmd = new Command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Configuration key (api-url)')
    .argument('<value>', 'Value to set')
    .action(async (key: string, value: string) => {
      if (key === 'api-url') {
        let u: URL
        try {
          u = new URL(value)
        } catch {
          fail(`無効な URL: ${value}`)
          return
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          fail(`http(s) URL のみ対応: ${value}`)
          return
        }
        const config = await readConfig()
        config.apiUrl = value
        await writeConfig(config)
        console.log(`api-url を ${value} に設定しました`)
      } else {
        fail(`Unknown key: ${key}`)
      }
    })

  cmd.addCommand(getCmd)
  cmd.addCommand(setCmd)

  return cmd
}
