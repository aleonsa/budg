import type { AccentColor } from '@/types'

/**
 * Accent color system — maps color names to CSS variables.
 * Used by badges, icons, progress bars, and category tags.
 */

/** Full CSS color value (for inline styles, e.g. SVG fills). */
export const accentSolid: Record<AccentColor, string> = {
  blue: 'hsl(var(--color-blue))',
  green: 'hsl(var(--color-green))',
  red: 'hsl(var(--color-red))',
  purple: 'hsl(var(--color-purple))',
  yellow: 'hsl(var(--color-yellow))',
  orange: 'hsl(var(--color-orange))',
  cyan: 'hsl(var(--color-cyan))',
  pink: 'hsl(var(--color-pink))',
  gray: 'hsl(var(--muted-foreground))',
}

/** Soft background CSS value (for pill backgrounds, icon circles). */
export const accentSoft: Record<AccentColor, string> = {
  blue: 'hsl(var(--color-blue-soft))',
  green: 'hsl(var(--color-green-soft))',
  red: 'hsl(var(--color-red-soft))',
  purple: 'hsl(var(--color-purple-soft))',
  yellow: 'hsl(var(--color-yellow-soft))',
  orange: 'hsl(var(--color-orange-soft))',
  cyan: 'hsl(var(--color-cyan-soft))',
  pink: 'hsl(var(--color-pink-soft))',
  gray: 'hsl(var(--muted))',
}

/**
 * Tailwind class combos for accent-colored elements.
 * Returns solid text color + soft background for badges/pills.
 */
export function accentClasses(color: AccentColor): {
  text: string
  bg: string
  solid: string
} {
  const map: Record<AccentColor, { text: string; bg: string; solid: string }> = {
    blue: {
      text: 'text-[hsl(var(--color-blue))]',
      bg: 'bg-[hsl(var(--color-blue-soft))]',
      solid: 'bg-[hsl(var(--color-blue))]',
    },
    green: {
      text: 'text-[hsl(var(--color-green))]',
      bg: 'bg-[hsl(var(--color-green-soft))]',
      solid: 'bg-[hsl(var(--color-green))]',
    },
    red: {
      text: 'text-[hsl(var(--color-red))]',
      bg: 'bg-[hsl(var(--color-red-soft))]',
      solid: 'bg-[hsl(var(--color-red))]',
    },
    purple: {
      text: 'text-[hsl(var(--color-purple))]',
      bg: 'bg-[hsl(var(--color-purple-soft))]',
      solid: 'bg-[hsl(var(--color-purple))]',
    },
    yellow: {
      text: 'text-[hsl(var(--color-yellow))]',
      bg: 'bg-[hsl(var(--color-yellow-soft))]',
      solid: 'bg-[hsl(var(--color-yellow))]',
    },
    orange: {
      text: 'text-[hsl(var(--color-orange))]',
      bg: 'bg-[hsl(var(--color-orange-soft))]',
      solid: 'bg-[hsl(var(--color-orange))]',
    },
    cyan: {
      text: 'text-[hsl(var(--color-cyan))]',
      bg: 'bg-[hsl(var(--color-cyan-soft))]',
      solid: 'bg-[hsl(var(--color-cyan))]',
    },
    pink: {
      text: 'text-[hsl(var(--color-pink))]',
      bg: 'bg-[hsl(var(--color-pink-soft))]',
      solid: 'bg-[hsl(var(--color-pink))]',
    },
    gray: {
      text: 'text-muted-foreground',
      bg: 'bg-muted',
      solid: 'bg-muted-foreground',
    },
  }
  return map[color]
}
