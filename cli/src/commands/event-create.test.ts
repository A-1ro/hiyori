import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-evcreate-test-'))
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

const mockCreatedEvent = {
  event: {
    id: 'new-event-uuid-123',
    title: 'My Event',
    status: 'open',
    timezone: 'UTC',
    defaultDurationMinutes: 60,
  },
  candidates: [
    { id: 'cand-1', startAt: '2030-01-15T10:00:00.000Z', endAt: '2030-01-15T11:00:00.000Z' },
  ],
}

describe('event create コマンド', () => {
  it('フラグのみで非対話作成成功 + イベント ID 出力 + チャンネル未連携注記', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    let capturedBody: unknown
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/events') && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string)
        return new Response(JSON.stringify(mockCreatedEvent), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { eventCreateCommand } = await import('./event-create.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventCreateCommand())
    await program.parseAsync(
      ['event', 'create', '--title', 'My Event', '--duration', '60', '--candidate', '2030-01-15T10:00:00.000Z', '--yes'],
      { from: 'user' },
    )

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('new-event-uuid-123'))).toBe(true)
    expect(output.some((l) => l.includes('Discord'))).toBe(true)
    expect(capturedBody).not.toHaveProperty('discordChannelToken')

    vi.restoreAllMocks()
  })

  it('--json: {event, candidates} を JSON 出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/events') && init?.method === 'POST') {
        return new Response(JSON.stringify(mockCreatedEvent), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { eventCreateCommand } = await import('./event-create.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.option('--json')
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventCreateCommand())
    await program.parseAsync(
      ['--json', 'event', 'create', '--title', 'My Event', '--duration', '60', '--candidate', '2030-01-15T10:00:00.000Z', '--yes'],
      { from: 'user' },
    )

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('event')
    expect(parsed).toHaveProperty('candidates')
    vi.restoreAllMocks()
  })

  it('400 エラーで fail して非0終了', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/events') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'Bad Request' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventCreateCommand } = await import('./event-create.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventCreateCommand())
    await program.parseAsync(
      ['event', 'create', '--title', 'My Event', '--duration', '60', '--candidate', '2030-01-15T10:00:00.000Z', '--yes'],
      { from: 'user' },
    )

    expect(process.exitCode).toBe(1)
    vi.restoreAllMocks()
  })

  it('未ログインで「hiyori login を実行してください」+ 非0終了', async () => {
    // credentials なし
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventCreateCommand } = await import('./event-create.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventCreateCommand())
    await program.parseAsync(
      ['event', 'create', '--title', 'My Event', '--duration', '60', '--candidate', '2030-01-15T10:00:00.000Z', '--yes'],
      { from: 'user' },
    )

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('hiyori login'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('discordChannelToken が body に含まれないこと', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/events') && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
        return new Response(JSON.stringify(mockCreatedEvent), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventCreateCommand } = await import('./event-create.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventCreateCommand())
    await program.parseAsync(
      ['event', 'create', '--title', 'My Event', '--duration', '60', '--candidate', '2030-01-15T10:00:00.000Z', '--yes'],
      { from: 'user' },
    )

    expect(capturedBody).not.toHaveProperty('discordChannelToken')
    vi.restoreAllMocks()
  })
})
