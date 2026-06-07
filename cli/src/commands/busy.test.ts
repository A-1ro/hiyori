import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-busy-test-'))
  process.env.XDG_CONFIG_HOME = tmpDir
  process.env.HIYORI_API_URL = 'https://test.example.com'
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('busy コマンド', () => {
  it('startAts の一覧を表示する', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/me/busy')) {
        return new Response(
          JSON.stringify({ startAts: ['2030-01-15T10:00:00.000Z', '2030-01-16T10:00:00.000Z'] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { busyCommand } = await import('./busy.js')
    const program = new Command()
    program.addCommand(busyCommand())
    await program.parseAsync(['busy'], { from: 'user' })

    const joined = output.join('\n')
    expect(joined).toContain('2030')
    vi.restoreAllMocks()
  })

  it('startAts 空: メッセージを表示する', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/me/busy')) {
        return new Response(JSON.stringify({ startAts: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { busyCommand } = await import('./busy.js')
    const program = new Command()
    program.addCommand(busyCommand())
    await program.parseAsync(['busy'], { from: 'user' })

    expect(output.some((l) => l.includes('ありません'))).toBe(true)
    vi.restoreAllMocks()
  })
})
