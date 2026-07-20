import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { AccentColor } from '@/types'
import { accentClasses } from '@/lib/colors'

const badgeVariants = cva(
  'inline-flex min-h-5 items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border border-border bg-background text-foreground',
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
          'inline-flex min-h-5 items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
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
