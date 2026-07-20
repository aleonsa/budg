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
  const normalized = input.replace(/[^0-9.-]/g, '')
  const negative = normalized.startsWith('-')
  const unsigned = negative ? normalized.slice(1) : normalized

  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(unsigned)) return 0

  const [whole = '0', fraction = ''] = unsigned.split('.')
  const wholeCents = Number(whole || '0') * 100
  const fractionCents = Number(fraction.slice(0, 2).padEnd(2, '0'))
  const roundedCents = wholeCents + fractionCents + (Number(fraction[2] ?? '0') >= 5 ? 1 : 0)

  if (!Number.isSafeInteger(roundedCents)) return 0
  return negative ? -roundedCents : roundedCents
}

/**
 * Convert cents to a plain decimal string (for form inputs).
 * @example centsToInput(1999) → "19.99"
 */
export function centsToInput(cents: Cents): string {
  return (cents / 100).toFixed(2)
}
