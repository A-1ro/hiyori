import { Command } from 'commander'
import * as clack from '@clack/prompts'
import { unwrap, resolveParent, requireAuthedApi } from './_shared.js'
import { fail, printJson } from '../output.js'
import type { AssistantState } from '../../../src/shared/assistant.js'

function display(state: AssistantState, json?: boolean) {
  if (json) { printJson(state); return }
  for (const message of state.messages) console.log(`${message.role === 'user' ? 'あなた' : 'ﾋﾖﾘﾁｬﾝ'}: ${message.content}`)
  if (state.pending) {
    console.log(`確認待ち: ${state.pending.label}\n操作ID: ${state.pending.id}`)
    console.log(JSON.stringify({ arguments: state.pending.arguments, context: state.pending.context }, null, 2))
    console.log(`実行: hiyori assistant approve ${state.pending.id}\n取消: hiyori assistant cancel ${state.pending.id}`)
  }
  if (state.busy) console.log('処理中です')
  if (state.result !== undefined) printJson(state.result)
}

async function confirm(message: string, yes?: boolean): Promise<boolean> {
  if (yes) return true
  if (!process.stdout.isTTY) { fail('非対話実行には --yes を指定してください'); return false }
  const answer = await clack.confirm({ message })
  return !clack.isCancel(answer) && answer === true
}

export function assistantCommand(): Command {
  const group = new Command('assistant').description('ﾋﾖﾘﾁｬﾝ: Workers AIで相談（変更はapproveまで実行しません）')
  group.addCommand(new Command('ask').description('日本語で相談。AI利用枠を消費します')
    .argument('<message>', '相談内容（4000文字まで）')
    .option('--event <id>', '相談するイベントID')
    .option('--request-id <uuid>', '送信ID。通信失敗後の再試行では同じIDを指定')
    .action(async (message: string, opts: { event?: string; requestId?: string }, cmd: Command) => {
      const parent = resolveParent(cmd)
      const authed = await requireAuthedApi(parent)
      if (!authed) return
      const requestId = opts.requestId ?? crypto.randomUUID()
      try {
        const response = await authed.api.api.assistant.chat.$post({ json: { message, requestId, ...(opts.event ? { eventId: opts.event } : {}) } })
        display(await unwrap<AssistantState>(response), parent.json)
      } catch (error) { fail(`${error instanceof Error ? error.message : String(error)}\n再試行用 --request-id ${requestId}`) }
    }))
  group.addCommand(new Command('history').description('本人の会話と確認待ち操作を表示')
    .action(async (_opts, cmd: Command) => {
      const parent = resolveParent(cmd)
      const authed = await requireAuthedApi(parent)
      if (!authed) return
      try { display(await unwrap<AssistantState>(await authed.api.api.assistant.history.$get()), parent.json) }
      catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    }))
  for (const decision of ['approve', 'cancel'] as const) {
    group.addCommand(new Command(decision).description(decision === 'approve' ? '保存済みの操作を確認して実行' : '確認待ちの操作を取り消す')
      .argument('<actionId>', 'historyで確認した操作ID')
      .option('--yes', '保存済みの操作内容に同意して確認を省略（approveのみ）')
      .action(async (actionId: string, opts: { yes?: boolean }, cmd: Command) => {
        const parent = resolveParent(cmd)
        const authed = await requireAuthedApi(parent)
        if (!authed) return
        try {
          if (decision === 'approve') {
            const state = await unwrap<AssistantState>(await authed.api.api.assistant.history.$get())
            if (!state.pending || state.pending.id !== actionId) { fail('この確認待ち操作は存在しません'); return }
            if (!parent.json) console.log(JSON.stringify(state.pending, null, 2))
            if (!await confirm(`${state.pending.label}を実行しますか？`, opts.yes)) return
          }
          const response = await authed.api.api.assistant.actions[':id'].$post({ param: { id: actionId }, json: { decision: decision === 'approve' ? 'approve' : 'cancel' } })
          display(await unwrap<AssistantState>(response), parent.json)
        } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
      }))
  }
  group.addCommand(new Command('clear').description('会話と未実行の操作を削除')
    .option('--yes', '会話削除の確認を省略')
    .action(async (opts: { yes?: boolean }, cmd: Command) => {
      const parent = resolveParent(cmd)
      const authed = await requireAuthedApi(parent)
      if (!authed || !await confirm('会話と確認待ちの操作を削除しますか？', opts.yes)) return
      try { display(await unwrap<AssistantState>(await authed.api.api.assistant.history.$delete()), parent.json) }
      catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    }))
  return group
}
