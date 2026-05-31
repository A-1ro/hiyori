// Discord embed の description/title/field.value はマークダウンとして解釈されるため、
// ユーザー入力に含まれる `[text](url)` 等の masked link や `*`/`_`/`~` 等の装飾を
// バックスラッシュでエスケープして無効化する。
export function escapeMarkdown(s: string): string {
  return s.replace(/([\\`*_~|>[\]()])/g, '\\$1')
}
