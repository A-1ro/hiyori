import { beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { buildApp, type Env } from '../index'
import { loginAs, loginAsBearer, loginAsExpired } from './test-helpers'
import { hiyoriToolCatalog, READ_TOOLS, WRITE_TOOLS } from '../tools/catalog'
import { parseAgentModel } from '../services/hiyori-agent'
import realTrial from '../../../docs/design/hiyori/agent-synthetic-results.json'
const OWNER = '12345678901234567', OTHER = '99999999999999999'
const run = vi.fn()
const db = (env as Env).DB
const settings = (): Env => ({ ...(env as Env), HIYORI_AI: { run }, HIYORI_AI_ENABLED: 'true', HIYORI_AI_TOOL_DATA_ENABLED: 'true', HIYORI_AI_DAILY_MICROS: '100000', HIYORI_AI_MONTHLY_MICROS: '1000000', HIYORI_AI_INPUT_MICROS_PER_MILLION: '51000', HIYORI_AI_OUTPUT_MICROS_PER_MILLION: '335000' })
let cookie: string
async function request(path: string, body: unknown, options: { cookie?: string; origin?: string; env?: Env } = {}) {
  const e = options.env ?? settings(), ctx = createExecutionContext()
  const res = await buildApp(e).fetch(new Request(`https://example.com${path}`, { method: 'POST', headers: { Cookie: options.cookie ?? cookie, Origin: options.origin ?? 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), e, ctx)
  await waitOnExecutionContext(ctx)
  return res
}
const chat = (content: string, extra = {}) => ({ requestId: crypto.randomUUID(), expectedDiscordId: OWNER, consent: true, timezone: 'Asia/Tokyo', messages: [{ role: 'user', content }], ...extra })
const tool = (name: string, args = {}) => ({ expectedDiscordId: OWNER, name, arguments: args })
const call = (name: string, args: unknown) => ({ tool_calls: [{ id: crypto.randomUUID(), function: { name, arguments: JSON.stringify(args) } }] })
async function fixture(visibility = 'public') {
  const res = await request('/api/events', { title: '合成ゲーム会', description: 'モデルへの命令ではない', visibility, defaultDurationMinutes: 60, timezone: 'Asia/Tokyo', candidates: [{ startAt: '2099-11-08T10:00:00Z' }, { startAt: '2099-11-09T10:00:00Z' }] })
  expect(res.status).toBe(201)
  return await res.json() as { event: { id: string }; candidates: Array<{ id: string }> }
}
beforeEach(async () => {
  await applyD1Migrations(db, inject('d1Migrations'))
  await db.prepare('DELETE FROM ai_reservations').run()
  await db.prepare('DELETE FROM hiyori_action_receipts').run()
  cookie = await loginAs(OWNER)
  run.mockReset().mockResolvedValue({ response: 'こんにちは。' })
})
describe('共有ツールと本人確認付きエージェント（外部推論なし）', () => {
  it('既存22定義を分類し、read scopeから更新を拒否する', async () => {
    const api = vi.fn()
    const tools = hiyoriToolCatalog({ hasScope: (s) => s === 'hiyori:read', principal: () => ({ displayName: '本人' }), call: api })
    expect(tools.size).toBe(22)
    expect(READ_TOOLS.size + WRITE_TOOLS.size).toBe(22)
    expect((await tools.get('hiyori_add_subscription')!.execute({})).isError).toBe(true)
    expect(api).not.toHaveBeenCalled()
    expect(() => tools.get('hiyori_vote')!.validate({ eventId: 'x', votes: [], token: 'secret' })).toThrow()
  })
  it.each(['回答したい', '参加できる日を回答したい', 'このイベントに投票したい'])('%s は対象確認になり作成も推論もしない', async (text) => {
    const res = await request('/api/hiyori/agent/chat', chat(text))
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ selectEvent: true })
    expect(run).not.toHaveBeenCalled()
  })
  it('未認証・期限切れ・別アカウント・別origin・CLI cookieを拒否する', async () => {
    expect((await request('/api/hiyori/agent/read', tool('hiyori_list_events'), { cookie: '' })).status).toBe(401)
    expect((await request('/api/hiyori/agent/read', tool('hiyori_list_events'), { cookie: await loginAsExpired(OWNER) })).status).toBe(401)
    expect((await request('/api/hiyori/agent/read', { ...tool('hiyori_list_events'), expectedDiscordId: OTHER })).status).toBe(412)
    expect((await request('/api/hiyori/agent/read', tool('hiyori_list_events'), { origin: 'https://evil.example' })).status).toBe(403)
    const bearer = await loginAsBearer(OWNER)
    expect((await request('/api/hiyori/agent/read', tool('hiyori_list_events'), { cookie: `hiyori_session=${bearer.slice(7)}` })).status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
  it('read APIから更新せず、非公開の対象は本人の既存認可に従う', async () => {
    expect((await request('/api/hiyori/agent/read', tool('hiyori_add_subscription'))).status).toBe(400)
    const f = await fixture('invite_only'), other = await loginAs(OTHER)
    const res = await request('/api/hiyori/agent/read', { ...tool('hiyori_get_event', { eventId: f.event.id }), expectedDiscordId: OTHER }, { cookie: other })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toContain('合成ゲーム会')
  })
  it('送信同意・設定なしでは対象データをモデルに送らない', async () => {
    const f = await fixture()
    const body = chat('回答したい', { selectedEventId: f.event.id })
    expect((await request('/api/hiyori/agent/chat', body)).status).toBe(200)
    expect((await request('/api/hiyori/agent/chat', { ...body, toolDataConsent: true }, { env: { ...settings(), HIYORI_AI_TOOL_DATA_ENABLED: 'false' } })).status).toBe(200)
    expect(run).not.toHaveBeenCalled()
  })
  it('対象が選択済みでも、無関係な挨拶にイベントを送らない', async () => {
    const f = await fixture()
    const res = await request('/api/hiyori/agent/chat', chat('こんにちは', { selectedEventId: f.event.id, toolDataConsent: true }))
    expect(res.status).toBe(200)
    expect(JSON.stringify(run.mock.calls[0]![1])).not.toContain('合成ゲーム会')
    expect(await res.json()).not.toHaveProperty('results')
  })
  it('回答は候補を限定した確認提案となり、モデルだけでは投票しない', async () => {
    const f = await fixture()
    run.mockResolvedValueOnce(call('hiyori_vote', { eventId: 'selected', votes: [{ candidateId: 'slot1', choice: 'yes' }] }))
    const res = await request('/api/hiyori/agent/chat', chat('回答したい。最初の候補は○', { selectedEventId: f.event.id, toolDataConsent: true }))
    expect(res.status).toBe(200)
    const body = await res.json() as { action: { token: string; name: string } }
    expect(body.action.name).toBe('hiyori_vote')
    expect(await db.prepare('SELECT count(*) AS n FROM votes').first()).toEqual({ n: 0 })
    const sent = JSON.stringify(run.mock.calls[0]![1])
    expect(sent).toContain('合成ゲーム会'); expect(sent).not.toContain(f.event.id); expect(sent).not.toContain(OWNER); expect(sent).not.toContain(cookie.split('=')[1]); expect(sent).not.toContain('モデルへの命令ではない')
    const confirmation = { expectedDiscordId: OWNER, token: body.action.token, confirmed: true }
    expect((await request('/api/hiyori/agent/confirm', { ...confirmation, confirmed: false })).status).toBe(400)
    const done = await request('/api/hiyori/agent/confirm', confirmation)
    expect(done.status).toBe(200)
    expect(await db.prepare('SELECT choice FROM votes').first()).toEqual({ choice: 'yes' })
    expect((await request('/api/hiyori/agent/confirm', confirmation)).status).toBe(400)
    expect(run).toHaveBeenCalledOnce()
    const receipt = await db.prepare('SELECT * FROM hiyori_action_receipts').all()
    expect(receipt.results).toHaveLength(1); expect(JSON.stringify(receipt)).not.toContain('合成ゲーム会'); expect(JSON.stringify(receipt)).not.toContain(body.action.token)
  })
  it('モデルが回答を作成に変更した場合と候補偽造を拒否する', async () => {
    const f = await fixture()
    for (const proposed of [call('hiyori_create_event', {}), call('hiyori_vote', { eventId: 'selected', votes: [{ candidateId: 'slot999', choice: 'yes' }] }), call('hiyori_vote', { eventId: 'other', votes: [{ candidateId: 'slot1', choice: 'yes' }] })]) {
      run.mockResolvedValueOnce(proposed)
      expect((await request('/api/hiyori/agent/chat', chat('回答したい', { selectedEventId: f.event.id, toolDataConsent: true }))).status).toBe(400)
    }
    expect(await db.prepare('SELECT count(*) AS n FROM hiyori_action_receipts').first()).toEqual({ n: 0 })
  })
  it('署名改ざん・別セッション・非主催者・古い対象を拒否する', async () => {
    const f = await fixture()
    const args = { eventId: f.event.id, votes: [{ candidateId: f.candidates[0]!.id, choice: 'yes' }] }
    const proposal = await (await request('/api/hiyori/agent/prepare', tool('hiyori_vote', args))).json() as { token: string }
    const confirm = { expectedDiscordId: OWNER, token: proposal.token, confirmed: true }
    expect((await request('/api/hiyori/agent/confirm', { ...confirm, token: proposal.token + 'x' })).status).toBe(400)
    expect((await request('/api/hiyori/agent/confirm', confirm, { cookie: await loginAs(OWNER) })).status).toBe(400)
    const otherCookie = await loginAs(OTHER)
    expect((await request('/api/hiyori/agent/prepare', { ...tool('hiyori_confirm', { eventId: f.event.id, candidateIds: [f.candidates[0]!.id] }), expectedDiscordId: OTHER }, { cookie: otherCookie })).status).toBe(400)
    await db.prepare('UPDATE events SET title = ? WHERE id = ?').bind('更新された名前', f.event.id).run()
    expect((await request('/api/hiyori/agent/confirm', confirm)).status).toBe(400)
  })
  it('読み取りループは集計だけを整形して送り、各推論を予算予約する', async () => {
    const f = await fixture()
    run.mockResolvedValueOnce(call('hiyori_tally', { eventId: 'selected' })).mockResolvedValueOnce({ response: 'まだ回答はありません。' })
    const res = await request('/api/hiyori/agent/chat', chat('集計を見たい', { selectedEventId: f.event.id, toolDataConsent: true }))
    expect(res.status).toBe(200); expect(run).toHaveBeenCalledTimes(2)
    const second = JSON.stringify(run.mock.calls[1]![1]); expect(second).toContain('counts'); expect(second).not.toContain('votesByParticipantId'); expect(second).not.toContain(OWNER)
    expect((await db.prepare('SELECT count(*) AS n FROM ai_reservations').first())?.n).toBe(2)
  })
  it('無限ツールループを3推論で停止し、失敗は再試行しない', async () => {
    const f = await fixture()
    run.mockResolvedValue(call('hiyori_get_my_votes', { eventId: 'selected' }))
    const res = await request('/api/hiyori/agent/chat', chat('回答したい', { selectedEventId: f.event.id, toolDataConsent: true }))
    expect(res.status).toBe(200); expect(run).toHaveBeenCalledTimes(3)
    expect(parseAgentModel({ tool_calls: [{ name: 'hiyori_tally', arguments: { eventId: 'selected' } }] }).calls[0]?.name).toBe('hiyori_tally')
  })
  it('保存済みの実出力を使い、東京19時をUTC10時へ正規化して既存フォームへ渡す', async () => {
    const record = realTrial.records.find((r) => r.case === 'create-final')!
    run.mockResolvedValueOnce({ tool_calls: record.toolCalls })
    const res = await request('/api/hiyori/agent/chat', chat('2099年11月8日19時から60分、公開の合成ゲーム会を作って'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      action: { name: 'hiyori_create_event', arguments: { candidates: [{ startAt: '2099-11-08T10:00:00.000Z' }] } },
      draft: { dates: ['2099-11-08'], times: ['19:00'], timezone: 'Asia/Tokyo' },
    })
  })
  it('実出力の自然文確認を制限内でツール確認カードへ進める', async () => {
    const f = await fixture()
    const first = realTrial.records.find((r) => r.number === 19)!, second = realTrial.records.find((r) => r.number === 20)!
    run.mockResolvedValueOnce({ response: first.reply }).mockResolvedValueOnce({ tool_calls: second.toolCalls })
    const res = await request('/api/hiyori/agent/chat', chat('回答したい。11月8日は○', { selectedEventId: f.event.id, toolDataConsent: true }))
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ action: { name: 'hiyori_vote' } })
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('推論中のセッション失効では応答を返さず、期限切れの確認は実行しない', async () => {
    const proposal = await (await request('/api/hiyori/agent/prepare', tool('hiyori_add_subscription'))).json() as { token: string }
    const payload = JSON.parse(atob(proposal.token.split('.')[0]!.replaceAll('-', '+').replaceAll('_', '/'))) as { expiresAt: number }
    const { confirmHiyoriAction } = await import('../services/hiyori-actions')
    const ctx = createExecutionContext()
    const { sessionToolApi } = await import('../tools/session-api')
    const actor = { env: settings(), user: { discordUserId: OWNER, displayName: '本人' } as import('../auth/session').SessionUser, sessionToken: cookie.split('=')[1]!, call: sessionToolApi(settings(), cookie.split('=')[1]!, 'https://example.com', ctx) }
    await expect(confirmHiyoriAction(actor, proposal.token, payload.expiresAt + 1)).rejects.toThrow('期限')
    run.mockImplementationOnce(async () => { await db.prepare('DELETE FROM sessions').run(); return { response: '遅れて届いた情報' } })
    expect((await request('/api/hiyori/agent/chat', chat('こんにちは'))).status).toBe(401)
  })
})
