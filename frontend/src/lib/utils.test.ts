import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('combines conditional classes while resolving conflicting utility groups', () => {
    expect(cn('px-2 text-sm', { hidden: false }, ['font-bold', { block: true }], 'px-4')).toBe(
      'text-sm font-bold block px-4',
    )
  })
})
