import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

vi.mock('@clack/prompts', () => ({
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}))

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-evrm-test-'))
  process.env.XDG_CONFIG_HOME = tmpDir
  process.env.HIYORI_API_URL = 'https://test.example.com'
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  process.exitCode = undefined
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const eventId = 'event-uuid-123'

describe('event rm コマンド', () => {
  it('--yes で即削除成功', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}`) && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { eventRmCommand } = await import('./event-rm.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventRmCommand())
    await program.parseAsync(['event', 'rm', eventId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('削除しました'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('204 応答で非0終了しない', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}`) && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventRmCommand } = await import('./event-rm.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventRmCommand())
    await program.parseAsync(['event', 'rm', eventId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('403 で fail して非0終了', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}`) && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventRmCommand } = await import('./event-rm.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventRmCommand())
    await program.parseAsync(['event', 'rm', eventId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    vi.restoreAllMocks()
  })

  it('未ログインで「hiyori login を実行してください」+ 非0終了', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventRmCommand } = await import('./event-rm.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventRmCommand())
    await program.parseAsync(['event', 'rm', eventId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('hiyori login'))).toBe(true)
    vi.restoreAllMocks()
  })
})
