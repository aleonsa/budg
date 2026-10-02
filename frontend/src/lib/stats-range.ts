import type { ISODate } from '@/types'

/**
 * Date-range model for the stats view.
 *
 * Ranges are plain {start, end} ISO date pairs resolved from a preset so the
 * page can compute metrics over any window and diff it against the
 * immediately preceding window of the same length.
 */

export type RangePreset = 'month' | '3m' | '6m' | '12m' | 'ytd' | 'custom'

export interface DateRange {
  start: ISODate
  end: ISODate
}

const DAY_MS = 86_400_000

function toLocalISO(date: Date): ISODate {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseISO(iso: ISODate): Date {
  return new Date(`${iso}T00:00:00`)
}

export function isRangePreset(value: string): value is RangePreset {
  return ['month', '3m', '6m', '12m', 'ytd', 'custom'].includes(value)
}

/**
 * Resolve a preset into a concrete range.
 *
 * - month: calendar month containing `anchor` (used with month navigation)
 * - 3m/6m/12m: `anchor` back N whole months, inclusive
 * - ytd: Jan 1 of the anchor's year through `anchor`
 */
export function resolveRange(
  preset: RangePreset,
  options: { anchor?: ISODate; monthKey?: string; custom?: DateRange } = {},
): DateRange {
  const anchor = options.anchor ?? ''
  if (anchor === '') throw new Error('resolveRange requires an anchor date')

  switch (preset) {
    case 'month': {
      const monthKey = options.monthKey ?? anchor.slice(0, 7)
      const [year, month] = monthKey.split('-').map(Number)
      const start = toLocalISO(new Date(year, month - 1, 1))
      const lastDay = new Date(year, month, 0).getDate()
      const end = `${monthKey}-${String(lastDay).padStart(2, '0')}`
      return { start, end }
    }
    case '3m':
    case '6m':
    case '12m': {
      const months = Number(preset.replace('m', ''))
      const anchorDate = parseISO(anchor)
      const start = toLocalISO(
        new Date(anchorDate.getFullYear(), anchorDate.getMonth() - (months - 1), 1),
      )
      return { start, end: anchor }
    }
    case 'ytd': {
      const anchorDate = parseISO(anchor)
      return { start: toLocalISO(new Date(anchorDate.getFullYear(), 0, 1)), end: anchor }
    }
    case 'custom': {
      const custom = options.custom
      if (!custom || custom.start === '' || custom.end === '' || custom.start > custom.end) {
        throw new Error('custom preset requires a valid custom range')
      }
      return { start: custom.start, end: custom.end }
    }
  }
}

/** The range immediately before `range`, same length in days. */
export function previousRange(range: DateRange): DateRange {
  const start = parseISO(range.start)
  const end = parseISO(range.end)
  const lengthDays = Math.round((end.getTime() - start.getTime()) / DAY_MS)
  const prevEnd = new Date(start.getTime() - DAY_MS)
  const prevStart = toLocalISO(new Date(prevEnd.getTime() - lengthDays * DAY_MS))
  return { start: prevStart, end: toLocalISO(prevEnd) }
}

/** Whole days covered by a range, inclusive. */
export function rangeDays(range: DateRange): number {
  return Math.round((parseISO(range.end).getTime() - parseISO(range.start).getTime()) / DAY_MS) + 1
}

/** Month keys ("YYYY-MM") fully or partially covered by a range, ascending. */
export function rangeMonthKeys(range: DateRange): string[] {
  const keys: string[] = []
  const [year, month] = range.start.split('-').map(Number)
  let cursor = new Date(year, month - 1, 1)
  const end = parseISO(range.end)
  while (cursor <= end) {
    keys.push(toLocalISO(cursor).slice(0, 7))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }
  return keys
}

/** Month-end snapshots inside a range, clamped to the range end, ascending. */
export function monthEndDates(range: DateRange): ISODate[] {
  const dates = rangeMonthKeys(range).map((key) => {
    const [year, month] = key.split('-').map(Number)
    return toLocalISO(new Date(year, month, 0))
  })
  if (dates.length > 0 && dates[dates.length - 1] > range.end) {
    dates[dates.length - 1] = range.end
  }
  return dates.filter((date, index) => index === 0 || date !== dates[index - 1])
}

/**
 * Snapshot dates for charts: weekly granularity for short ranges (≤ 10 weeks),
 * month ends otherwise. Always starts at range.start.
 */
export function snapshotDates(range: DateRange): ISODate[] {
  const days = rangeDays(range)
  if (days > 70) return monthEndDates(range)

  const dates: ISODate[] = [range.start]
  let cursor = parseISO(range.start)
  const end = parseISO(range.end)
  while (true) {
    const next = new Date(cursor.getTime() + 7 * DAY_MS)
    if (next >= end) break
    dates.push(toLocalISO(next))
    cursor = next
  }
  dates.push(range.end)
  return dates.filter((date, index) => index === 0 || date !== dates[index - 1])
}
