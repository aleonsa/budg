import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, formatDateShort, formatMonth, groupByDate, isSameDay, today } from './date'

afterEach(() => vi.useRealTimers())

describe('date helpers', () => {
  it('formats dates and months for Mexican Spanish users', () => {
    expect(formatDate('2025-07-12')).toBe('12 jul 2025')
    expect(formatDateShort('2025-07-12')).toBe('sáb 12')
    expect(formatMonth('2025-07-12')).toBe('julio de 2025')
  })

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

  it('returns no groups when there are no dated items', () => {
    expect(groupByDate([], (item: { date: string }) => item.date)).toEqual([])
  })

  it('compares ISO calendar dates', () => {
    expect(isSameDay('2026-07-20', '2026-07-20')).toBe(true)
    expect(isSameDay('2026-07-20', '2026-07-21')).toBe(false)
  })
})
