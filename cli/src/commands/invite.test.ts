import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'
import { inviteCommand } from './invite.js'

vi.mock('@clack/prompts', () => ({ confirm: vi.fn(), isCancel: vi.fn(() => false) }))

let tmpDir: string
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
const eventId = 'event-123'
const inviteId = 'abfd055c-2861-4b94-919f-bff22161646d'
const discordUserId = '123456789012345678'
const pending = { id: inviteId, eventId, discordUsername: 'alice', discordUserId: null, claimedAt: null, createdAt: '2030-01-01T00:00:00.000Z' }

function program(): Command {
  const root = new Command().option('--json').option('--api-url <url>').exitOverride()
    .configureOutput({ writeErr: () => {} }).addCommand(inviteCommand())
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

function mockApi(data: unknown = { invite: pending }, status = 200) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
    status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } },
  ))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-invite-test-'))
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

describe('invite list', () => {
  it('lists full stable IDs, pending/claimed state and legacy numeric invitations read-only', async () => {
    const claimedId = 'abfd055c-2861-4b94-919f-bff22161646e'
    const legacyId = 'abfd055c-2861-4b94-919f-bff22161646f'
    const fetch = mockApi({ invites: [pending,
      { ...pending, id: claimedId, discordUsername: 'bob', discordUserId: '223456789012345678', claimedAt: '2030-01-02T00:00:00.000Z' },
      { ...pending, id: legacyId, discordUsername: null, discordUserId },
    ] })
    await program().parseAsync(['invite', 'list', eventId], { from: 'user' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]![0])).toBe(`https://test.example.com/api/events/${eventId}/invites`)
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer test-token')
    const output = vi.mocked(console.log).mock.calls.map(([line]) => line).join('\n')
    for (const value of [inviteId, claimedId, legacyId, '@alice', '@bob', '未確定', '確定済み', `Discord ID: ${discordUserId}`]) expect(output).toContain(value)
    expect(output).not.toContain('223456789012345678')
  })

  it('prints the original invitation response as JSON, including pending null IDs', async () => {
    const data = { invites: [pending] }
    mockApi(data)
    await program().parseAsync(['--json', 'invite', 'list', eventId], { from: 'user' })
    expect(console.log).toHaveBeenCalledOnce()
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0])).toEqual(data)
  })

  it('handles an empty invitation list', async () => {
    mockApi({ invites: [] })
    await program().parseAsync(['invite', 'list', eventId], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith('招待はありません')
  })
})

describe('invite add', () => {
  it.each([[' @Alice.Name ', 'alice.name'], [discordUserId, discordUserId]])('posts only the normalized username %j without lookup requests', async (input, username) => {
    const fetch = mockApi()
    await program().parseAsync(['--json', 'invite', 'add', eventId, '--username', input], { from: 'user' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]![0])).toBe(`https://test.example.com/api/events/${eventId}/invites`)
    expect(fetch.mock.calls[0]![1]?.method).toBe('POST')
    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string)).toEqual({ discordUsername: username })
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0])).toEqual({ invite: pending })
  })

  it('shows the pending record ID for later revocation', async () => {
    mockApi()
    await program().parseAsync(['invite', 'add', eventId, '--username', 'alice'], { from: 'user' })
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(inviteId)
  })

  it.each([[], ['--username', ''], ['--username', 'a..b'], ['--username', 'display name'], ['--user-id', discordUserId]].map((flags) => ({ flags })))('rejects missing/invalid/ID input without requests ($flags)', async ({ flags }) => {
    const fetch = mockApi()
    await expect(program().parseAsync(['invite', 'add', eventId, ...flags], { from: 'user' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([400, 401, 403, 404, 409, 500])('reports API status %s without success output', async (status) => {
    mockApi({ error: status === 409 ? 'At most 500 invitations are allowed' : 'Request failed' }, status)
    await program().parseAsync(['invite', 'add', eventId, '--username', 'alice'], { from: 'user' })
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledOnce()
    expect(console.log).not.toHaveBeenCalled()
  })
})

describe('invite revoke', () => {
  it('uses the stable invitation UUID for DELETE and emits JSON success', async () => {
    const fetch = mockApi(null, 204)
    await program().parseAsync(['--json', 'invite', 'revoke', eventId, inviteId, '--yes'], { from: 'user' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]![0])).toBe(`https://test.example.com/api/events/${eventId}/invites/${inviteId}`)
    expect(fetch.mock.calls[0]![1]?.method).toBe('DELETE')
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0])).toEqual({ revoked: true, eventId, inviteId })
    expect(clack.confirm).not.toHaveBeenCalled()
  })

  it.each([discordUserId, '@alice', 'alice', 'abfd055c'])('rejects non-invitation UUID %j without requests', async (id) => {
    const fetch = mockApi(null, 204)
    await expect(program().parseAsync(['invite', 'revoke', eventId, id, '--yes'], { from: 'user' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([false, true])('requires --yes without TTY or in JSON mode (TTY=%s)', async (tty) => {
    const fetch = mockApi(null, 204)
    setTty(tty)
    await program().parseAsync([...(tty ? ['--json'] : []), 'invite', 'revoke', eventId, inviteId], { from: 'user' })
    expect(process.exitCode).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(clack.confirm).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  it('does not revoke when interactive confirmation is declined', async () => {
    const fetch = mockApi(null, 204)
    setTty(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    await program().parseAsync(['invite', 'revoke', eventId, inviteId], { from: 'user' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('revokes after interactive confirmation', async () => {
    const fetch = mockApi(null, 204)
    setTty(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    await program().parseAsync(['invite', 'revoke', eventId, inviteId], { from: 'user' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('取り消しました'))
  })

  it.each([401, 404, 500])('does not report success for DELETE status %s', async (status) => {
    mockApi({ error: 'Not Found' }, status)
    await program().parseAsync(['--json', 'invite', 'revoke', eventId, inviteId, '--yes'], { from: 'user' })
    expect(process.exitCode).toBe(1)
    expect(console.log).not.toHaveBeenCalled()
  })
})

describe('invite authentication', () => {
  it.each([['list', eventId], ['add', eventId, '--username', 'alice'], ['revoke', eventId, inviteId, '--yes']].map((args) => ({ args })))('requires login without anonymous requests ($args)', async ({ args }) => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    const fetch = mockApi()
    await program().parseAsync(['invite', ...args], { from: 'user' })
    expect(fetch).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('hiyori login'))
  })
})
