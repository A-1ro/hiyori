import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import { assistantCommand } from './assistant.js'

const ask = vi.fn()
const history = vi.fn()
const resolve = vi.fn()
const clear = vi.fn()
const authed = vi.fn()
const fail = vi.fn()
vi.mock('./_shared.js', async importOriginal => ({ ...await importOriginal<typeof import('./_shared.js')>(), requireAuthedApi: (...args: unknown[]) => authed(...args) }))
vi.mock('../output.js', () => ({ fail: (...args: unknown[]) => fail(...args), printJson: vi.fn() }))

const ACTION = '6c4ce329-4d3b-4ec8-b011-36788f1c45c8'
const EVENT = '194288ae-ddac-4e4b-917a-a410c57dc487'
const ID = '9a219ddc-e9e3-4aae-9c5f-4cda9bba928a'
const state = { messages: [], busy: false, pending: { id: ACTION, label: 'イベントを削除', arguments: { eventId: EVENT } } }
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
function program() { return new Command().option('--json').option('--api-url <url>').addCommand(assistantCommand()) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  ask.mockResolvedValue(response(state))
  history.mockImplementation(async () => response(state))
  resolve.mockImplementation(async () => response({ messages: [], pending: null, busy: false }))
  clear.mockImplementation(async () => response({ messages: [], pending: null, busy: false }))
  authed.mockResolvedValue({ api: { api: { assistant: { chat: { $post: ask }, history: { $get: history, $delete: clear }, actions: { ':id': { $post: resolve } } } } } })
})
afterEach(() => vi.restoreAllMocks())

describe('assistant CLI interface parity', () => {
  it('passes the real ask flags to the API and never auto-approves a proposal', async () => {
    await program().parseAsync(['--json', 'assistant', 'ask', '予定を教えて', '--event', EVENT, '--request-id', ID], { from: 'user' })
    expect(ask).toHaveBeenCalledWith({ json: { message: '予定を教えて', eventId: EVENT, requestId: ID } })
    expect(resolve).not.toHaveBeenCalled()
  })
  it('requires --yes in noninteractive approval and sends only the saved action ID', async () => {
    await program().parseAsync(['--json', 'assistant', 'approve', ACTION], { from: 'user' })
    expect(fail).toHaveBeenCalledWith(expect.stringContaining('--yes'))
    expect(resolve).not.toHaveBeenCalled()
    await program().parseAsync(['--json', 'assistant', 'approve', ACTION, '--yes'], { from: 'user' })
    expect(resolve).toHaveBeenCalledWith({ param: { id: ACTION }, json: { decision: 'approve' } })
  })
  it('exposes history, cancellation, clear, and their help', async () => {
    await program().parseAsync(['assistant', 'history'], { from: 'user' })
    await program().parseAsync(['assistant', 'cancel', ACTION], { from: 'user' })
    expect(resolve).toHaveBeenCalledWith({ param: { id: ACTION }, json: { decision: 'cancel' } })
    await program().parseAsync(['assistant', 'clear', '--yes'], { from: 'user' })
    expect(clear).toHaveBeenCalledTimes(1)
    expect(assistantCommand().helpInformation()).toContain('approve')
  })
})
