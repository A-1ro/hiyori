import { vi } from 'vitest'

// jsdom は window.matchMedia を実装しないため、レスポンシブ判定を使う
// コンポーネント（AppHeader 等）向けに最小スタブを入れる。
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}
