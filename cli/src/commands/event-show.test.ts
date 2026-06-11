import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-evshow-test-'))
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
const mockEventData = {
  event: {
    id: eventId,
    title: 'Test Event',
    description: 'A test event',
    status: 'open',
    deadline: '2030-01-01T00:00:00.000Z',
    timezone: 'Asia/Tokyo',
    defaultDurationMinutes: 60,
  },
  candidates: [
    { id: 'cand-1', startAt: '2030-01-15T10:00:00.000Z', endAt: '2030-01-15T11:00:00.000Z' },
  ],
}

describe('event show コマンド', () => {
  it('詳細+isOrganizer を表示する', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/permissions`)) {
        return new Response(JSON.stringify({ isOrganizer: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}`)) {
        return new Response(JSON.stringify(mockEventData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { eventShowCommand } = await import('./event-show.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventShowCommand())
    await program.parseAsync(['event', 'show', eventId], { from: 'user' })

    expect(output.some((l) => l.includes('Test Event'))).toBe(true)
    expect(output.some((l) => l.includes('true'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('--json: event + permissions を合成して JSON 出力', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/permissions`)) {
        return new Response(JSON.stringify({ isOrganizer: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}`)) {
        return new Response(JSON.stringify(mockEventData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { eventShowCommand } = await import('./event-show.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.option('--json')
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventShowCommand())
    await program.parseAsync(['--json', 'event', 'show', eventId], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('event')
    expect(parsed).toHaveProperty('isOrganizer', false)
    vi.restoreAllMocks()
  })

  it('404: メッセージを表示して非0終了', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { eventShowCommand } = await import('./event-show.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventShowCommand())
    await program.parseAsync(['event', 'show', 'nonexistent-id'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    consoleSpy.mockRestore()
  })
})
