import type { Cents, CurrencyCode } from '@/types'

const LOCALE = 'es-MX'

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  MXN: '$',
  USD: 'US$',
}

/**
 * Format cents as a currency string.
 * @example formatMoney(199990) → "$1,999.90"
 */
export function formatMoney(cents: Cents, currency: CurrencyCode = 'MXN'): string {
  const value = cents / 100
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `${CURRENCY_SYMBOLS[currency]}${formatted}`
}

/**
 * Format cents as compact currency (no decimals for large amounts).
 * @example formatMoneyCompact(199990) → "$2,000"
 */
export function formatMoneyCompact(cents: Cents, currency: CurrencyCode = 'MXN'): string {
  const value = Math.round(cents / 100)
  const formatted = new Intl.NumberFormat(LOCALE, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
  return `${CURRENCY_SYMBOLS[currency]}${formatted}`
}

/**
 * Convert a user-entered float string to cents.
 * @example toCents("19.99") → 1999
 */
export function toCents(input: string): Cents {
  const parsed = parseFloat(input.replace(/[^0-9.-]/g, ''))
  if (isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}

/**
 * Convert cents to a plain decimal string (for form inputs).
 * @example centsToInput(1999) → "19.99"
 */
export function centsToInput(cents: Cents): string {
  return (cents / 100).toFixed(2)
}
