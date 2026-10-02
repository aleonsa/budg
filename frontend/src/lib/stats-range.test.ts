import { describe, expect, it } from 'vitest'
import {
  monthEndDates,
  previousRange,
  rangeDays,
  rangeMonthKeys,
  resolveRange,
  snapshotDates,
} from './stats-range'

const ANCHOR = '2026-07-20'

describe('resolveRange', () => {
  it('resolves the calendar month of the anchor by default', () => {
    expect(resolveRange('month', { anchor: ANCHOR })).toEqual({
      start: '2026-07-01',
      end: '2026-07-31',
    })
  })

  it('respects an explicit monthKey for month navigation', () => {
    expect(resolveRange('month', { anchor: ANCHOR, monthKey: '2026-02' })).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    })
  })

  it('resolves rolling windows starting on the first day of the window', () => {
    expect(resolveRange('3m', { anchor: ANCHOR })).toEqual({
      start: '2026-05-01',
      end: '2026-07-20',
    })
    expect(resolveRange('6m', { anchor: ANCHOR })).toEqual({
      start: '2026-02-01',
      end: '2026-07-20',
    })
    expect(resolveRange('12m', { anchor: '2026-07-01' })).toEqual({
      start: '2025-08-01',
      end: '2026-07-01',
    })
  })

  it('handles windows that cross a year boundary', () => {
    expect(resolveRange('3m', { anchor: '2026-02-15' })).toEqual({
      start: '2025-12-01',
      end: '2026-02-15',
    })
  })

  it('resolves ytd from January 1st', () => {
    expect(resolveRange('ytd', { anchor: ANCHOR })).toEqual({
      start: '2026-01-01',
      end: '2026-07-20',
    })
  })

  it('resolves custom ranges verbatim', () => {
    expect(
      resolveRange('custom', {
        anchor: ANCHOR,
        custom: { start: '2026-03-05', end: '2026-04-10' },
      }),
    ).toEqual({ start: '2026-03-05', end: '2026-04-10' })
  })

  it('rejects invalid custom ranges', () => {
    expect(() =>
      resolveRange('custom', {
        anchor: ANCHOR,
        custom: { start: '2026-05-01', end: '2026-04-01' },
      }),
    ).toThrow()
    expect(() => resolveRange('custom', { anchor: ANCHOR })).toThrow()
  })
})

describe('previousRange', () => {
  it('returns the same-length window immediately before', () => {
    expect(previousRange({ start: '2026-07-01', end: '2026-07-20' })).toEqual({
      start: '2026-06-11',
      end: '2026-06-30',
    })
  })

  it('handles single-day ranges', () => {
    expect(previousRange({ start: '2026-07-20', end: '2026-07-20' })).toEqual({
      start: '2026-07-19',
      end: '2026-07-19',
    })
  })
})

describe('rangeDays', () => {
  it('counts inclusive days', () => {
    expect(rangeDays({ start: '2026-07-01', end: '2026-07-31' })).toBe(31)
    expect(rangeDays({ start: '2026-07-20', end: '2026-07-20' })).toBe(1)
  })
})

describe('rangeMonthKeys', () => {
  it('lists every touched month ascending, including partials', () => {
    expect(rangeMonthKeys({ start: '2025-12-15', end: '2026-02-02' })).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })
})

describe('monthEndDates', () => {
  it('snapshots month ends and appends the range end if newer', () => {
    expect(monthEndDates({ start: '2026-05-01', end: '2026-07-20' })).toEqual([
      '2026-05-31',
      '2026-06-30',
      '2026-07-20',
    ])
  })

  it('does not duplicate the final month end', () => {
    expect(monthEndDates({ start: '2026-05-01', end: '2026-06-30' })).toEqual([
      '2026-05-31',
      '2026-06-30',
    ])
  })
})

describe('snapshotDates', () => {
  it('uses weekly steps for short ranges', () => {
    expect(snapshotDates({ start: '2026-07-01', end: '2026-07-20' })).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
      '2026-07-20',
    ])
  })

  it('returns start and end for a very short range', () => {
    expect(snapshotDates({ start: '2026-07-01', end: '2026-07-03' })).toEqual([
      '2026-07-01',
      '2026-07-03',
    ])
  })

  it('falls back to month ends for long ranges', () => {
    expect(snapshotDates({ start: '2026-01-01', end: '2026-12-31' })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ])
  })
})
