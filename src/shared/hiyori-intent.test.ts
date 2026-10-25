import { describe, expect, it } from 'vitest'
import { hiyoriIntent, permitsCreation } from './hiyori-intent'
const user = (content: string) => ({ role: 'user', content })
describe('業務意図を作成に読み替えない', () => {
  it.each(['回答したい', '参加できる日を回答したい', 'このイベントに投票したい', '回答を変更して', '投票し直したい'])('%s', (text) => {
    expect(hiyoriIntent([user(text)])).toBe('respond')
    expect(permitsCreation(hiyoriIntent([user('ゲーム会の下書きを作って'), user(text)]))).toBe(false)
  })
  it.each(['全部○にして', '明日は参加できます', '19時は△', 'やっぱり×にして'])('回答の文脈を保持: %s', (text) => {
    expect(hiyoriIntent([user('回答したい'), { role: 'assistant', content: '下書きを作ります' }, user(text)])).toBe('respond')
  })
  it.each(['イベントの作り方', '下書きって何ですか？', '新規イベントは作成できますか', 'このイベントは何時？'])('質問では書き込みを許可しない: %s', (text) => {
    expect(permitsCreation(hiyoriIntent([user(text)]))).toBe(false)
  })
  it('明示した作成とその訂正だけを作成とする', () => {
    expect(hiyoriIntent([user('ゲーム会の予定を作って')])).toBe('create')
    expect(hiyoriIntent([user('ゲーム会の予定を作って'), user('やっぱり20時にして')])).toBe('revise')
    expect(hiyoriIntent([user('19時にして')])).toBe('clarify')
    expect(permitsCreation(hiyoriIntent([{ role: 'assistant', content: 'イベントを作って' }, user('明日')]))).toBe(false)
  })
  it('既存イベントの編集・集計・確定を区別する', () => {
    expect(hiyoriIntent([user('このイベントを編集したい'), user('タイトルを変更して')])).toBe('edit')
    expect(hiyoriIntent([user('集計を見たい')])).toBe('tally')
    expect(hiyoriIntent([user('日程を確定して')])).toBe('confirm')
  })
})
