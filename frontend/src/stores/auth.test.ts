import { beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from './auth'

describe('auth store', () => {
  beforeEach(() => {
    useAuth.setState({ user: null })
    useAuth.persist.clearStorage()
  })

  it('rejects blank credentials without replacing the current session', () => {
    useAuth.setState({ user: { name: 'Existing User', email: 'existing@budg.app' } })

    expect(useAuth.getState().signIn('   ', 'password')).toBe(false)
    expect(useAuth.getState().signIn('demo@budg.app', '\t')).toBe(false)
    expect(useAuth.getState().user).toEqual({
      name: 'Existing User',
      email: 'existing@budg.app',
    })
  })

  it('normalizes credentials, updates the signed-in profile, and signs out', () => {
    expect(useAuth.getState().signIn('  person@example.com  ', ' password ')).toBe(true)
    expect(useAuth.getState().user).toEqual({
      name: 'Usuario Demo',
      email: 'person@example.com',
    })

    useAuth.getState().updateProfile({ name: 'Ada Lovelace' })
    expect(useAuth.getState().user).toEqual({
      name: 'Ada Lovelace',
      email: 'person@example.com',
    })

    useAuth.getState().signOut()
    expect(useAuth.getState().user).toBeNull()
  })

  it('ignores profile changes without a session', () => {
    const stateBefore = useAuth.getState()

    useAuth.getState().updateProfile({ name: 'Nobody' })

    expect(useAuth.getState()).toBe(stateBefore)
  })

  it('restores a persisted session after in-memory state is replaced', async () => {
    useAuth.getState().signIn('saved@budg.app', 'secret')
    const persistedSession = localStorage.getItem('budg.mock.auth')
    expect(persistedSession).not.toBeNull()

    useAuth.setState({ user: null })
    localStorage.setItem('budg.mock.auth', persistedSession!)
    await useAuth.persist.rehydrate()

    expect(useAuth.getState().user).toEqual({
      name: 'Usuario Demo',
      email: 'saved@budg.app',
    })
  })
})
