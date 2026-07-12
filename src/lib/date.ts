import type { ISODate } from '@/types'

const LOCALE = 'es-MX'

/** Format an ISO date as "12 jul 2025". */
export function formatDate(iso: ISODate): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Format an ISO date as short weekday + day "sáb 12". */
export function formatDateShort(iso: ISODate): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: '2-digit',
  })
}

/** Get the month label "julio 2025". */
export function formatMonth(iso: ISODate): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(LOCALE, {
    month: 'long',
    year: 'numeric',
  })
}

/** Today's date as ISO string. */
export function today(): ISODate {
  return new Date().toISOString().slice(0, 10)
}

/** Compare two ISO dates (same string comparison works for YYYY-MM-DD). */
export function isSameDay(a: ISODate, b: ISODate): boolean {
  return a === b
}

/**
 * Group ISO dates by day key for list rendering.
 * Returns a map of "YYYY-MM-DD" → items, sorted descending.
 */
export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => ISODate,
): Array<{ date: ISODate; items: T[] }> {
  const groups = new Map<ISODate, T[]>()
  for (const item of items) {
    const date = getDate(item)
    const group = groups.get(date) ?? []
    group.push(item)
    groups.set(date, group)
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items }))
}
