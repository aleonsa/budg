import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { CategoryIcon } from './CategoryIcon'
import { CATEGORY_ICON_OPTIONS, categoryIconLabel } from './category-icon-options'
import type { AccentColor } from '@/types'
import { cn } from '@/lib/utils'

interface CategoryIconPickerProps {
  value: string
  color: AccentColor
  onChange: (value: string) => void
}

export function CategoryIconPicker({ value, color, onChange }: CategoryIconPickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        aria-label="Icono"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center gap-2 rounded-[7px] border border-input bg-background px-2.5 text-left text-[13px] hover:bg-accent focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      >
        <CategoryIcon name={value} color={color} className="h-7 w-7" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{categoryIconLabel(value)}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{value}</span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Iconos disponibles"
          className="grid max-h-64 grid-cols-3 gap-1 overflow-y-auto rounded-[8px] border border-border bg-background p-1.5 sm:grid-cols-4"
        >
          {CATEGORY_ICON_OPTIONS.map((option) => {
            const selected = option.name === value
            return (
              <button
                key={option.name}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={`${option.label} (${option.name})`}
                onClick={() => {
                  onChange(option.name)
                  setOpen(false)
                }}
                className={cn(
                  'relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-[7px] px-1 py-1.5 text-center hover:bg-accent',
                  selected && 'bg-accent ring-1 ring-primary/30',
                )}
              >
                <CategoryIcon name={option.name} color={color} className="h-7 w-7" />
                <span className="line-clamp-2 text-[10px] leading-tight">{option.label}</span>
                {selected && <Check className="absolute right-1 top-1 h-3 w-3 text-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
