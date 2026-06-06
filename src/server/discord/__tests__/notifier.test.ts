import { describe, it, expect } from 'vitest'
import { buildAnnouncementEmbed } from '../notifier'

const WORKER_HOST = 'hiyori.example.com'

type AnnouncementButton = { url: string; label: string }
type AnnouncementRow = { components: AnnouncementButton[] }

function firstButton(components: object[]): AnnouncementButton | undefined {
  return (components as AnnouncementRow[])[0]?.components[0]
}

describe('buildAnnouncementEmbed', () => {
  it('埋め込みタイトルのリンクと回答ボタンはどちらも回答ページ（/vote）を指す', () => {
    const { embed, components } = buildAnnouncementEmbed({
      event: { id: 'evt_123', title: '忘年会', description: null },
      workerHost: WORKER_HOST,
    })

    const expectedUrl = `https://${WORKER_HOST}/events/evt_123/vote`
    expect((embed as { url: string }).url).toBe(expectedUrl)

    const button = firstButton(components)
    expect(button?.url).toBe(expectedUrl)
    expect(button?.label).toBe('日程を回答する')
  })

  it('イベント詳細ページ（/vote なし）は告知リンクに使われない', () => {
    const { embed, components } = buildAnnouncementEmbed({
      event: { id: 'evt_456', title: 'テスト', description: '説明' },
      workerHost: WORKER_HOST,
    })

    const detailUrl = `https://${WORKER_HOST}/events/evt_456`
    expect((embed as { url: string }).url).not.toBe(detailUrl)
    expect(firstButton(components)?.url.endsWith('/vote')).toBe(true)
  })
})
