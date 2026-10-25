export type HiyoriIntent = 'create' | 'revise' | 'respond' | 'tally' | 'confirm' | 'edit' | 'invite' | 'delete' | 'calendar' | 'view' | 'question' | 'chat' | 'clarify'
type Turn = { role: string; content: string }

// Conservative routing, not authorization. Only user turns establish creation
// intent; an assistant/event/tool message can never grant a write operation.
export function hiyoriIntent(messages: readonly Turn[]): HiyoriIntent {
  let creation = false
  let operation: HiyoriIntent | undefined
  let intent: HiyoriIntent = 'chat'
  for (const turn of messages) {
    if (turn.role !== 'user') continue
    const text = turn.content.normalize('NFKC').trim()
    const question = /(?:何(?:時|日|分|月|年|の)|いつ|どれ|どこ|どうやって|どうすれば|方法|やり方|しかた|作り方|作成できますか|作れる[?？]|ですか[?？]?$)/.test(text)
      || (/[?？]$/.test(text) && !/(?:作って|つくって|作成して|変更して|訂正して|修正して|にして|お願い)/.test(text))
    if (question) { intent = 'question'; continue }
    if (/(?:回答|投票)(?:を)?(?:したい|する|して|し直|変更|訂正|修正|でき|の仕方|の方法)|参加できる日.*回答|(?:回答|投票)(?:です|の方)?[。!！]?$/.test(text)) { intent = 'respond'; creation = false; operation = intent; continue }
    if (/(?:集計|結果|票数|参加人数)(?:を|が|の|は|確認|見|知)/.test(text)) { intent = 'tally'; creation = false; operation = intent; continue }
    if (/(?:確定|確定取消|確定を取消|開催日を決め)/.test(text)) { intent = 'confirm'; creation = false; operation = intent; continue }
    if (/(?:招待|招待取消)/.test(text) && !/(?:招待限定|招待制)/.test(text)) { intent = 'invite'; creation = false; operation = intent; continue }
    if (/(?:イベント|予定|日程).*(?:削除|消して|取り消)|(?:削除|消して).*(?:イベント|予定)/.test(text)) { intent = 'delete'; creation = false; operation = intent; continue }
    if (/(?:カレンダー|購読|webcal|ics|忙しい|重複)/i.test(text)) { intent = 'calendar'; creation = false; operation = intent; continue }
    if (/(?:作らない|作成しない|下書きはいらない|作成ではなく|新規ではなく)/.test(text)) { intent = 'clarify'; creation = false; operation = intent; continue }
    if (!creation && /(?:候補|日時|開始|締切).*(?:追加|削除|変更|編集|取り消)|(?:公開範囲|タイトル|説明|締切|タイムゾーン|所要時間).*(?:変えて|変更|編集|にして|解除)/.test(text)) { intent = 'edit'; creation = false; operation = intent; continue }
    if (/(?:既存|作成済|保存済|このイベント|そのイベント).*(?:編集|変更|訂正)|(?:イベント|予定)を編集/.test(text)) { intent = 'edit'; creation = false; operation = intent; continue }
    if (/(?:イベント|予定|一覧).*(?:見たい|見せて|開いて|探して)/.test(text)) { intent = 'view'; creation = false; operation = intent; continue }
    if (/下書き|(?:イベント|予定|日程|会|ミーティング).*(?:作って|つくって|作成して|作りたい|作成したい)/.test(text)) {
      intent = creation ? 'revise' : 'create'; creation = true; operation = 'create'; continue
    }
    if (/(?:変更|訂正|修正|にして|開始|所要時間|タイトル|説明|候補|公開|招待限定|\d{1,2}(?:月|日|時|分)|\d{1,2}:\d{2}|明日|明後日|やっぱり|参加|全部|全て|[○〇△×])/.test(text)) {
      intent = creation ? 'revise' : operation ?? 'clarify'; continue
    }
    if (operation && /^(?:はい|うん|お願い|その内容で|それで|確認したい)[。!！]?$/.test(text)) { intent = operation; continue }
    intent = 'chat'
  }
  return intent
}

export const permitsCreation = (intent: HiyoriIntent) => intent === 'create' || intent === 'revise'
