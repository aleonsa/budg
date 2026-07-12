import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { AccentColor } from '@/types'
import { accentClasses } from '@/lib/colors'

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border border-border text-foreground',
        muted: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Accent color — renders as a soft pill with colored text. */
  accent?: AccentColor
}

function Badge({ className, variant, accent, ...props }: BadgeProps) {
  if (accent) {
    const c = accentClasses(accent)
    return (
      <div
        className={cn(
          'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
          c.bg,
          c.text,
          className,
        )}
        {...props}
      />
    )
  }
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
