import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-ics-test-'))
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

const mockIcsContent = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
const eventId = 'ics-event-id'

describe('ics コマンド', () => {
  it('標準出力に ICS を書き出す', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision.ics`)) {
        return new Response(mockIcsContent, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const written: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array, ..._args: unknown[]) => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString())
      return true
    })

    const { Command } = await import('commander')
    const { icsCommand } = await import('./ics.js')
    const program = new Command()
    program.addCommand(icsCommand())
    await program.parseAsync(['ics', eventId], { from: 'user' })

    vi.restoreAllMocks()
    process.stdout.write = originalWrite
    expect(written.join('')).toContain('BEGIN:VCALENDAR')
    expect(process.exitCode).toBeFalsy()
  })

  it('-o ファイル: ファイルに書き込む', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision.ics`)) {
        return new Response(mockIcsContent, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const outFile = path.join(tmpDir, 'out.ics')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { icsCommand } = await import('./ics.js')
    const program = new Command()
    program.addCommand(icsCommand())
    await program.parseAsync(['ics', eventId, '-o', outFile], { from: 'user' })

    const content = await fs.readFile(outFile, 'utf-8')
    expect(content).toContain('BEGIN:VCALENDAR')
    consoleSpy.mockRestore()
  })

  it('404: 確定がありませんメッセージと非0終了', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { icsCommand } = await import('./ics.js')
    const program = new Command()
    program.addCommand(icsCommand())
    await program.parseAsync(['ics', 'nonexistent-id'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    consoleSpy.mockRestore()
  })
})
