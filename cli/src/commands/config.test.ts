import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfig } from '../config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-config-cmd-test-'))
  process.env.XDG_CONFIG_HOME = tmpDir
  delete process.env.HIYORI_API_URL
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  vi.clearAllMocks()
  process.exitCode = undefined
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('config set api-url → config get api-url 往復', () => {
  it('有効な https URL を設定して get で取得できる', async () => {
    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { configCommand } = await import('./config.js')
    const program = new Command()
    program.exitOverride()
    program.addCommand(configCommand())

    await program.parseAsync(['config', 'set', 'api-url', 'https://my.example.com'], { from: 'user' })

    const config = await readConfig()
    expect(config.apiUrl).toBe('https://my.example.com')

    output.length = 0
    await program.parseAsync(['config', 'get', 'api-url'], { from: 'user' })
    expect(output).toEqual(['https://my.example.com  (source: config)'])

    vi.restoreAllMocks()
  })
})

describe('config set api-url バリデーション', () => {
  it('不正な URL は fail する', async () => {
    const errOutput: string[] = []
    vi.spyOn(console, 'error').mockImplementation((msg: string) => { errOutput.push(msg) })

    const { Command } = await import('commander')
    const { configCommand } = await import('./config.js')
    const program = new Command()
    program.exitOverride()
    program.addCommand(configCommand())

    await program.parseAsync(['config', 'set', 'api-url', 'not-a-url'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errOutput.some((l) => l.includes('無効な URL'))).toBe(true)

    vi.restoreAllMocks()
  })

  it('http(s) 以外のスキームは fail する', async () => {
    const errOutput: string[] = []
    vi.spyOn(console, 'error').mockImplementation((msg: string) => { errOutput.push(msg) })

    const { Command } = await import('commander')
    const { configCommand } = await import('./config.js')
    const program = new Command()
    program.exitOverride()
    program.addCommand(configCommand())

    await program.parseAsync(['config', 'set', 'api-url', 'ftp://example.com'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errOutput.some((l) => l.includes('HTTPS'))).toBe(true)

    vi.restoreAllMocks()
  })

  it.each(['http://example.com', 'http://printer.local', 'http://192.168.1.1'])(
    'does not save insecure URL %s', async (url) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { Command } = await import('commander')
      const { configCommand } = await import('./config.js')
      const program = new Command().addCommand(configCommand())
      await program.parseAsync(['config', 'set', 'api-url', url], { from: 'user' })
      expect(process.exitCode).toBe(1)
      expect((await readConfig()).apiUrl).toBeUndefined()
      vi.restoreAllMocks()
    },
  )

  it('saves localhost HTTP for development', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { configCommand } = await import('./config.js')
    const program = new Command().addCommand(configCommand())
    await program.parseAsync(['config', 'set', 'api-url', 'http://localhost:8787'], { from: 'user' })
    expect((await readConfig()).apiUrl).toBe('http://localhost:8787')
    vi.restoreAllMocks()
  })
})
