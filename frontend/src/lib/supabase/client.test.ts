import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests, getSupabase, isSupabaseConfigured } from './client'

describe('supabase client', () => {
  beforeEach(() => {
    __setSupabaseForTests(null)
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.unstubAllEnvs()
  })

  it('reports unconfigured when env vars are missing', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(isSupabaseConfigured()).toBe(false)
    expect(getSupabase()).toBeNull()
  })

  it('builds a singleton when env vars are present and reuses it', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    expect(isSupabaseConfigured()).toBe(true)
    const first = getSupabase()
    const second = getSupabase()
    expect(first).not.toBeNull()
    expect(second).toBe(first)
  })

  it('treats whitespace-only env values as missing', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '   ')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '   ')
    expect(isSupabaseConfigured()).toBe(false)
    expect(getSupabase()).toBeNull()
  })
})
