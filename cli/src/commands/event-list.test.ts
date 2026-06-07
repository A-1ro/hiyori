import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-evlist-test-'))
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

const mockEventsData = {
  organized: [
    { id: 'aaaa-bbbb-cccc-dddd-1234567890ab', title: 'Event 1', status: 'open', deadline: '2030-01-01T00:00:00.000Z' },
  ],
  participating: [
    { id: 'bbbb-cccc-dddd-eeee-1234567890ab', title: 'Event 2', status: 'closed', deadline: undefined },
  ],
}

describe('event list コマンド', () => {
  it('organized/participating テーブルを表示する', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/me/events')) {
        return new Response(JSON.stringify(mockEventsData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { eventListCommand } = await import('./event-list.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventListCommand())
    await program.parseAsync(['event', 'list'], { from: 'user' })

    expect(output.some((l) => l.includes('Event 1'))).toBe(true)
    expect(output.some((l) => l.includes('Event 2'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('--json: 生 JSON を出力する', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/me/events')) {
        return new Response(JSON.stringify(mockEventsData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { eventListCommand } = await import('./event-list.js')
    const eventCmd = new Command('event')
    const program = new Command()
    program.option('--json')
    program.addCommand(eventCmd)
    eventCmd.addCommand(eventListCommand())
    await program.parseAsync(['--json', 'event', 'list'], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('organized')
    expect(parsed).toHaveProperty('participating')
    vi.restoreAllMocks()
  })
})
