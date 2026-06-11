import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-evedit-test-'))
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
const mockUpdatedEvent = {
  event: {
    id: eventId,
    title: 'Updated Title',
    status: 'open',
    timezone: 'UTC',
    defaultDurationMinutes: 90,
  },
}

describe('event edit コマンド', () => {
  it('フラグで部分更新成功', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}`) && init?.method === 'PATCH') {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
        return new Response(JSON.stringify(mockUpdatedEvent), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { eventEditCommand } = await import('./event-edit.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventEditCommand())
    await program.parseAsync(['event', 'edit', eventId, '--title', 'Updated Title'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(capturedBody).toHaveProperty('title', 'Updated Title')
    expect(capturedBody).not.toHaveProperty('defaultDurationMinutes')
    expect(output.some((l) => l.includes('Updated Title'))).toBe(true)

    vi.restoreAllMocks()
  })

  it('--json: {event} を JSON 出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}`) && init?.method === 'PATCH') {
        return new Response(JSON.stringify(mockUpdatedEvent), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { eventEditCommand } = await import('./event-edit.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.option('--json')
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventEditCommand())
    await program.parseAsync(['--json', 'event', 'edit', eventId, '--title', 'Updated Title'], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('event')
    vi.restoreAllMocks()
  })

  it('403 で fail して非0終了', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}`) && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventEditCommand } = await import('./event-edit.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventEditCommand())
    await program.parseAsync(['event', 'edit', eventId, '--title', 'Updated Title'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    vi.restoreAllMocks()
  })

  it('404 で「イベントが見つかりません」を表示', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}`) && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventEditCommand } = await import('./event-edit.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventEditCommand())
    await program.parseAsync(['event', 'edit', eventId, '--title', 'Updated Title'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('イベントが見つかりません'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('未ログインで「hiyori login を実行してください」+ 非0終了', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventEditCommand } = await import('./event-edit.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventEditCommand())
    await program.parseAsync(['event', 'edit', eventId, '--title', 'Updated Title'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('hiyori login'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('未指定フィールドが body に含まれないこと', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}`) && init?.method === 'PATCH') {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
        return new Response(JSON.stringify(mockUpdatedEvent), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { eventEditCommand } = await import('./event-edit.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventEditCommand())
    await program.parseAsync(['event', 'edit', eventId, '--title', 'Updated Title'], { from: 'user' })

    expect(capturedBody).toHaveProperty('title')
    expect(capturedBody).not.toHaveProperty('description')
    expect(capturedBody).not.toHaveProperty('defaultDurationMinutes')
    expect(capturedBody).not.toHaveProperty('timezone')
    vi.restoreAllMocks()
  })
})
