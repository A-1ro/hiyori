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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-sub-test-'))
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

const subId = 'sub-uuid-123'
const mockSubscription = {
  id: subId,
  scope: 'user-all',
  createdAt: '2030-01-01T00:00:00.000Z',
  lastAccessedAt: null,
  webcalUrl: 'webcal://test.example.com/cal/token123',
}
const mockSubscriptionsResponse = {
  subscriptions: [mockSubscription],
}
const mockSubWithUrl = {
  subscription: {
    id: subId,
    scope: 'user-all',
    createdAt: '2030-01-01T00:00:00.000Z',
    lastAccessedAt: null,
  },
  webcalUrl: 'webcal://test.example.com/cal/token123',
}
const mockRegenResponse = {
  subscription: {
    id: subId,
    scope: 'user-all',
    createdAt: '2030-01-01T00:00:00.000Z',
    lastAccessedAt: null,
  },
  webcalUrl: 'webcal://test.example.com/cal/newtoken456',
}

describe('sub list コマンド', () => {
  it('テーブル表示', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/me/subscriptions')) {
        return new Response(JSON.stringify(mockSubscriptionsResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'list'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('webcal://'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('--json: {subscriptions} を JSON 出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/me/subscriptions')) {
        return new Response(JSON.stringify(mockSubscriptionsResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.option('--json')
    program.addCommand(subCommand())
    await program.parseAsync(['--json', 'sub', 'list'], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('subscriptions')
    vi.restoreAllMocks()
  })

  it('未ログインで「hiyori login を実行してください」+ 非0終了', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'list'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('hiyori login'))).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('sub add コマンド', () => {
  it('追加成功 + webcalUrl 表示', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/subscriptions') && !url.includes('/regenerate') && init?.method === 'POST') {
        return new Response(JSON.stringify(mockSubWithUrl), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'add'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('webcal://'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('--json: {subscription, webcalUrl} を JSON 出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/subscriptions') && !url.includes('/regenerate') && init?.method === 'POST') {
        return new Response(JSON.stringify(mockSubWithUrl), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.option('--json')
    program.addCommand(subCommand())
    await program.parseAsync(['--json', 'sub', 'add'], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('subscription')
    expect(parsed).toHaveProperty('webcalUrl')
    vi.restoreAllMocks()
  })

  it('status 200（既存サブスクリプション, webcalUrl: null）でも成功', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    // サーバーは tokenHash のみ保存するため、既存購読の POST は webcalUrl: null を返す（#25）
    const existingSub = { ...mockSubWithUrl, webcalUrl: null }
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/subscriptions') && !url.includes('/regenerate') && init?.method === 'POST') {
        return new Response(JSON.stringify(existingSub), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'add'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('すでに購読済み'))).toBe(true)
    expect(output.some((l) => l.includes('webcal://'))).toBe(false)
    vi.restoreAllMocks()
  })
})

describe('sub rm コマンド', () => {
  it('--yes で削除成功', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/subscriptions/${subId}`) && !url.includes('/regenerate') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'rm', subId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('削除しました'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('204 応答で非0終了しない', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/subscriptions/${subId}`) && !url.includes('/regenerate') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'rm', subId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('404 で fail して非0終了', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/subscriptions/${subId}`) && !url.includes('/regenerate') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'rm', subId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    vi.restoreAllMocks()
  })
})

describe('sub regen コマンド', () => {
  it('再生成成功 + 新 URL 表示 + 旧 URL 無効注記', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/subscriptions/${subId}/regenerate`) && init?.method === 'POST') {
        return new Response(JSON.stringify(mockRegenResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'regen', subId], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('newtoken456'))).toBe(true)
    expect(output.some((l) => l.includes('旧 URL は無効'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('--json: {subscription, webcalUrl} を JSON 出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/subscriptions/${subId}/regenerate`) && init?.method === 'POST') {
        return new Response(JSON.stringify(mockRegenResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.option('--json')
    program.addCommand(subCommand())
    await program.parseAsync(['--json', 'sub', 'regen', subId], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('subscription')
    expect(parsed).toHaveProperty('webcalUrl')
    vi.restoreAllMocks()
  })

  it('404 で fail して非0終了', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/subscriptions/${subId}/regenerate`) && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'regen', subId], { from: 'user' })

    expect(process.exitCode).toBe(1)
    vi.restoreAllMocks()
  })

  it('未ログインで「hiyori login を実行してください」+ 非0終了', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { subCommand } = await import('./sub.js')
    const program = new Command()
    program.addCommand(subCommand())
    await program.parseAsync(['sub', 'regen', subId], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('hiyori login'))).toBe(true)
    vi.restoreAllMocks()
  })
})
