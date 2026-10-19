import { expect, it } from 'vitest'

it.each(['localStorage', 'sessionStorage'] as const)(
  '%s uses the jsdom browser Storage implementation',
  (name) => {
    const storage = window[name]
    expect(storage).toBeInstanceOf(window.Storage)
    expect(globalThis[name]).toBe(storage)

    storage.clear()
    try {
      storage.setItem('storage-environment', 'saved')
      expect(storage.getItem('storage-environment')).toBe('saved')
      expect(storage.length).toBe(1)
      storage.removeItem('storage-environment')
      expect(storage.getItem('storage-environment')).toBeNull()
    } finally {
      storage.clear()
    }
  },
)
