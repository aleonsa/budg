import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupByDate, isSameDay, today } from './date'

afterEach(() => vi.useRealTimers())

describe('date helpers', () => {
  it('uses local calendar fields for today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 20, 23, 30))

    expect(today()).toBe('2026-07-20')
  })

  it('groups items by descending ISO date', () => {
    const items = [
      { id: 1, date: '2026-07-19' },
      { id: 2, date: '2026-07-20' },
      { id: 3, date: '2026-07-19' },
    ]

    expect(groupByDate(items, (item) => item.date)).toEqual([
      { date: '2026-07-20', items: [items[1]] },
      { date: '2026-07-19', items: [items[0], items[2]] },
    ])
  })

  it('compares ISO calendar dates', () => {
    expect(isSameDay('2026-07-20', '2026-07-20')).toBe(true)
    expect(isSameDay('2026-07-20', '2026-07-21')).toBe(false)
  })
})
