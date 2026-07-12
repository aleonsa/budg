import * as React from 'react'
import { cn } from '@/lib/utils'
import { accentClasses } from '@/lib/colors'
import type { AccentColor } from '@/types'

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–1 */
  value: number
  /** Visual style for the bar fill. */
  variant?: 'default' | 'warning' | 'success'
  /** Custom accent color for the fill. */
  accent?: AccentColor
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, variant = 'default', accent, ...props }, ref) => {
    const clamped = Math.min(Math.max(value, 0), 1)

    const fillClass = accent
      ? accentClasses(accent).solid
      : variant === 'warning'
        ? 'bg-[hsl(var(--color-red))]'
        : variant === 'success'
          ? 'bg-[hsl(var(--color-green))]'
          : 'bg-primary'

    return (
      <div
        ref={ref}
        className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
        {...props}
      >
        <div
          className={cn('h-full rounded-full transition-all', fillClass)}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    )
  },
)
Progress.displayName = 'Progress'

export { Progress }
