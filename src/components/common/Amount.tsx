import type { Cents, CurrencyCode } from '@/types'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AmountProps {
  value: Cents
  currency?: CurrencyCode
  /** Show with explicit sign (+/-) — used for income/expenses lists. */
  signed?: boolean
  /** Style hint: large (hero numbers), default, or muted. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeClasses = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl',
  xl: 'text-3xl',
} as const

/**
 * Displays a monetary value with proper formatting and color.
 * Income (positive when signed) → green, expense (negative when signed) → red.
 */
export function Amount({
  value,
  currency = 'MXN',
  signed = false,
  size = 'md',
  className,
}: AmountProps) {
  const isNegative = value < 0
  const display = formatMoney(Math.abs(value), currency)
  const sign = signed ? (isNegative ? '−' : '+') : ''

  return (
    <span
      className={cn(
        'font-semibold tabular-nums tracking-tight',
        sizeClasses[size],
        signed && isNegative && 'text-[hsl(var(--color-red))]',
        signed && !isNegative && 'text-[hsl(var(--color-green))]',
        className,
      )}
    >
      {sign}
      {display}
    </span>
  )
}
