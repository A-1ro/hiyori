import { describe, it, expect } from 'vitest'
import { escapeMarkdown } from '../markdown'

describe('escapeMarkdown', () => {
  it('masked link はバックスラッシュで無効化される', () => {
    expect(escapeMarkdown('[label](https://attacker.example)')).toBe(
      '\\[label\\]\\(https://attacker.example\\)',
    )
  })

  it('装飾系メタ文字をエスケープする', () => {
    expect(escapeMarkdown('*bold* _italic_ ~strike~ `code`')).toBe(
      '\\*bold\\* \\_italic\\_ \\~strike\\~ \\`code\\`',
    )
  })

  it('引用符と縦棒もエスケープする', () => {
    expect(escapeMarkdown('>quote |spoiler')).toBe('\\>quote \\|spoiler')
  })

  it('バックスラッシュ自体もエスケープする', () => {
    expect(escapeMarkdown('a\\b')).toBe('a\\\\b')
  })

  it('通常のテキストには影響しない', () => {
    expect(escapeMarkdown('普通のテキスト hello world')).toBe('普通のテキスト hello world')
  })
})
