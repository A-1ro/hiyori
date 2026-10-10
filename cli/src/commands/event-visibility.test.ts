import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'
import { eventCreateCommand } from './event-create.js'
import { eventEditCommand } from './event-edit.js'

vi.mock('@clack/prompts', () => ({
  text: vi.fn(), select: vi.fn(), intro: vi.fn(), cancel: vi.fn(), isCancel: vi.fn(() => false),
}))

let tmpDir: string
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
const event = { id: 'event-123', title: 'Meeting', defaultDurationMinutes: 60, timezone: 'UTC', status: 'open', visibility: 'invite_only' }
const response = { event, candidates: [] }
const createArgs = ['event', 'create', '--title', 'Meeting', '--duration', '60', '--candidate', '2030-01-15T10:00:00.000Z']

function program(): Command {
  const root = new Command().option('--json').option('--api-url <url>').exitOverride()
    .configureOutput({ writeErr: () => {} })
  const command = new Command('event')
  command.addCommand(eventCreateCommand()).addCommand(eventEditCommand())
  root.addCommand(command)
  function configure(cmd: Command) {
    cmd.exitOverride().configureOutput({ writeErr: () => {} })
    cmd.commands.forEach(configure)
  }
  configure(root)
  return root
}

function setTty(value: boolean) {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value })
}

function mockApi(data: unknown = response) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-visibility-test-'))
  process.env.XDG_CONFIG_HOME = tmpDir
  process.env.HIYORI_API_URL = 'https://test.example.com'
  await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  setTty(false)
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  if (ttyDescriptor) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor)
  else Reflect.deleteProperty(process.stdout, 'isTTY')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  process.exitCode = undefined
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function body(fetch: ReturnType<typeof mockApi>) {
  return JSON.parse(fetch.mock.calls[0]![1]?.body as string)
}

describe('event create visibility and username invitations', () => {
  it('preserves omitted public defaults and does not send invitation or ID fields', async () => {
    const fetch = mockApi()
    await program().parseAsync(createArgs, { from: 'user' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(body(fetch)).toEqual({ title: 'Meeting', defaultDurationMinutes: 60, candidates: [{ startAt: '2030-01-15T10:00:00.000Z' }] })
  })

  it('normalizes and deduplicates repeated usernames, including numeric-only names, in one atomic create', async () => {
    const fetch = mockApi()
    await program().parseAsync(['--json', ...createArgs, '--visibility', 'invite_only',
      '--invite-username', ' @Alice.Name ', '--invite-username', 'alice.name', '--invite-username', '123456789012345678'], { from: 'user' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(body(fetch)).toMatchObject({ visibility: 'invite_only', invitedDiscordUsernames: ['alice.name', '123456789012345678'] })
    expect(body(fetch)).not.toHaveProperty('invitedDiscordUserIds')
    expect(body(fetch)).not.toHaveProperty('discordChannelToken')
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0])).toEqual(response)
    expect(clack.text).not.toHaveBeenCalled()
  })

  it.each([{ flags: [] }, { flags: ['--visibility', 'public'] }])('rejects initial invites without invite_only before a request ($flags)', async ({ flags }) => {
    const fetch = mockApi()
    await program().parseAsync([...createArgs, ...flags, '--invite-username', 'alice'], { from: 'user' })
    expect(process.exitCode).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--visibility invite_only'))
  })

  it.each(['private', '', 'PUBLIC'])('rejects invalid visibility %j without requests', async (visibility) => {
    const fetch = mockApi()
    await expect(program().parseAsync([...createArgs, '--visibility', visibility], { from: 'user' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['', ' ', '@', 'a', 'Alice Name', 'alice#1234', 'a..b', '@@alice', 'a'.repeat(33), `${' '.repeat(129)}alice`])('rejects invalid username %j without requests', async (username) => {
    const fetch = mockApi()
    await expect(program().parseAsync([...createArgs, '--visibility', 'invite_only', '--invite-username', username], { from: 'user' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects more than 500 repeated username flags without requests', async () => {
    const fetch = mockApi()
    const inviteFlags = Array.from({ length: 501 }, (_, i) => ['--invite-username', `user${i}`]).flat()
    await expect(program().parseAsync([...createArgs, '--visibility', 'invite_only', ...inviteFlags], { from: 'user' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects the numeric ID input flag before requests', async () => {
    const fetch = mockApi()
    await expect(program().parseAsync([...createArgs, '--invite-user-id', '123456789012345678'], { from: 'user' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never prompts in --json mode, even with a TTY and missing required flags', async () => {
    const fetch = mockApi()
    setTty(true)
    await program().parseAsync(['--json', 'event', 'create', '--visibility', 'invite_only'], { from: 'user' })
    expect(process.exitCode).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(clack.text).not.toHaveBeenCalled()
    expect(clack.select).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  it('collects individual usernames in interactive invite-only creation', async () => {
    const fetch = mockApi()
    setTty(true)
    for (const value of ['Meeting', '', '60', '2030-01-15T10:00:00.000Z', '', '', 'UTC', '@Alice', '123456789012345678', '']) {
      vi.mocked(clack.text).mockResolvedValueOnce(value)
    }
    vi.mocked(clack.select).mockResolvedValueOnce('invite_only')
    await program().parseAsync(['event', 'create'], { from: 'user' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(body(fetch)).toMatchObject({ visibility: 'invite_only', invitedDiscordUsernames: ['alice', '123456789012345678'] })
  })

  it('cancels interactive visibility without creating an event', async () => {
    const fetch = mockApi()
    setTty(true)
    for (const value of ['Meeting', '', '60', '2030-01-15T10:00:00.000Z', '', '', 'UTC']) {
      vi.mocked(clack.text).mockResolvedValueOnce(value)
    }
    const cancelled = Symbol('cancelled')
    vi.mocked(clack.select).mockResolvedValueOnce(cancelled)
    vi.mocked(clack.isCancel).mockImplementation((value) => value === cancelled)
    await program().parseAsync(['event', 'create'], { from: 'user' })
    expect(fetch).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('event edit visibility', () => {
  it.each(['public', 'invite_only'])('sends only explicit visibility=%s and preserves JSON output', async (visibility) => {
    const fetch = mockApi({ event: { ...event, visibility } })
    await program().parseAsync(['--json', 'event', 'edit', event.id, '--visibility', visibility], { from: 'user' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(body(fetch)).toEqual({ visibility })
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0])).toEqual({ event: { ...event, visibility } })
    expect(clack.text).not.toHaveBeenCalled()
  })

  it('leaves visibility unchanged on unrelated partial updates', async () => {
    const fetch = mockApi()
    await program().parseAsync(['event', 'edit', event.id, '--title', 'New'], { from: 'user' })
    expect(body(fetch)).toEqual({ title: 'New' })
  })

  it('rejects invalid visibility without GET/PATCH requests', async () => {
    const fetch = mockApi()
    await expect(program().parseAsync(['event', 'edit', event.id, '--visibility', 'private'], { from: 'user' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not fetch or prompt with missing flags in JSON/headless mode (TTY=%s)', async (tty) => {
    const fetch = mockApi()
    setTty(tty)
    await program().parseAsync([...(tty ? ['--json'] : []), 'event', 'edit', event.id], { from: 'user' })
    expect(process.exitCode).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(clack.text).not.toHaveBeenCalled()
    expect(clack.select).not.toHaveBeenCalled()
  })

  it('can change visibility interactively while retaining unchanged fields', async () => {
    const fetch = mockApi({ event: { ...event, visibility: 'public' } })
    setTty(true)
    for (const value of ['Meeting', '', '60', '', 'UTC']) vi.mocked(clack.text).mockResolvedValueOnce(value)
    vi.mocked(clack.select).mockResolvedValueOnce('invite_only')
    await program().parseAsync(['event', 'edit', event.id], { from: 'user' })
    expect(fetch).toHaveBeenCalledTimes(2)
    const request = fetch.mock.calls[1]![1]!
    expect(JSON.parse(request.body as string)).toEqual({ visibility: 'invite_only' })
  })
})
