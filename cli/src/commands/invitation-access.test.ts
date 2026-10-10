import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCredentials, writeCredentials } from '../config.js'
import { eventShowCommand } from './event-show.js'
import { icsCommand } from './ics.js'
import { tallyCommand } from './tally.js'
import { voteCommand } from './vote.js'

let tmpDir: string
const apiUrl = 'https://test.example.com'
const credentials = { token: 'existing-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl }
const retryHint = 'ログインしたまま、少し待って同じコマンドを再実行してください。'
const commands = [
  { name: 'event show', make: () => new Command('event').addCommand(eventShowCommand()), args: ['event', 'show', 'event-id'] },
  { name: 'tally', make: tallyCommand, args: ['tally', 'event-id'] },
  { name: 'ics', make: icsCommand, args: ['ics', 'event-id'] },
  { name: 'vote', make: voteCommand, args: ['vote', 'event-id'] },
]

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-invitation-access-'))
  process.env.XDG_CONFIG_HOME = tmpDir
  process.env.HIYORI_API_URL = apiUrl
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.exitCode = undefined
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe.each(commands)('$name invitation access', ({ name, make, args }) => {
  async function run() {
    await new Command().option('--json').addCommand(make()).parseAsync(['--json', ...args], { from: 'user' })
  }

  it('keeps existing credentials and suggests retry without new login for generic 404', async () => {
    await writeCredentials(credentials)
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ error: 'Discord lookup temporarily unavailable: private invitation' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetch)

    await run()

    expect(process.exitCode).toBe(1)
    expect(console.log).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledOnce()
    const output = String(vi.mocked(console.error).mock.calls[0]![0])
    expect(output).toContain(retryHint)
    expect(output).not.toMatch(/hiyori login|OAuth|private invitation|Discord lookup/)
    expect(fetch).toHaveBeenCalledOnce()
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer existing-token')
    expect(String(fetch.mock.calls[0]![0])).toContain('/api/events/event-id')
    expect(await readCredentials()).toEqual(credentials)
  })

  it('gives the same guidance for missing events, denied access and lookup failure', async () => {
    await writeCredentials(credentials)
    const output: string[] = []
    for (const error of ['Not Found', 'Access denied', 'Discord lookup temporarily unavailable']) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })))
      await run()
      output.push(String(vi.mocked(console.error).mock.lastCall![0]))
    }
    expect(new Set(output).size).toBe(1)
  })

  it('uses normal login guidance when signed out', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await run()

    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('hiyori login'))
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(retryHint))
    expect(fetch).toHaveBeenCalledTimes(name === 'vote' ? 0 : 1)
    expect(await readCredentials()).toBeNull()
  })

  it('does not infer an invitation from a general server failure', async () => {
    await writeCredentials(credentials)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })))
    await run()
    expect(process.exitCode).toBe(1)
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(retryHint))
    expect(console.log).not.toHaveBeenCalled()
    expect(await readCredentials()).toEqual(credentials)
  })
})
