import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let systemPrefersDark = false
let useTheme: typeof import('./theme').useTheme

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: systemPrefersDark })),
  })
  ;({ useTheme } = await import('./theme'))
})

afterAll(() => vi.unstubAllGlobals())

describe('theme store', () => {
  beforeEach(() => {
    systemPrefersDark = false
    useTheme.setState({ theme: 'system' })
    useTheme.persist.clearStorage()
    document.documentElement.classList.remove('dark')
  })

  it('applies explicit light and dark choices regardless of system preference', () => {
    systemPrefersDark = true
    useTheme.getState().setTheme('light')
    expect(document.documentElement).not.toHaveClass('dark')

    systemPrefersDark = false
    useTheme.getState().setTheme('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(useTheme.getState().theme).toBe('dark')
  })

  it('resolves system choice from the current media preference', () => {
    systemPrefersDark = true
    useTheme.getState().setTheme('system')
    expect(document.documentElement).toHaveClass('dark')

    systemPrefersDark = false
    useTheme.getState().setTheme('system')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('rehydrates both persisted choice and its document effect', async () => {
    useTheme.getState().setTheme('dark')
    const persistedTheme = localStorage.getItem('budg.mock.theme')
    expect(persistedTheme).not.toBeNull()

    useTheme.setState({ theme: 'light' })
    document.documentElement.classList.remove('dark')
    localStorage.setItem('budg.mock.theme', persistedTheme!)
    await useTheme.persist.rehydrate()

    expect(useTheme.getState().theme).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('keeps the active theme when persisted data is corrupt', async () => {
    useTheme.getState().setTheme('light')
    localStorage.setItem('budg.mock.theme', '{invalid json')

    await useTheme.persist.rehydrate()

    expect(useTheme.getState().theme).toBe('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('can update state during server rendering without touching the document', () => {
    vi.stubGlobal('document', undefined)

    useTheme.getState().setTheme('dark')

    expect(useTheme.getState().theme).toBe('dark')
    vi.unstubAllGlobals()
  })
})
