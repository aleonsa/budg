import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { Input, Sheet, Separator, Button } from '@/components/ui'
import { useTransactionFilters } from '@/stores/transactionFilters'
import type { TransactionFilterType } from '@/stores/transactionFilters'
import type { Category, Account } from '@/types'
import { cn } from '@/lib/utils'

const TYPE_TABS: { label: string; value: TransactionFilterType }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Gastos', value: 'expense' },
  { label: 'Ingresos', value: 'income' },
  { label: 'Transferencias', value: 'transfer' },
]

interface FilterBarProps {
  categories: Category[]
  accounts: Account[]
}

export function FilterBar({ categories, accounts }: FilterBarProps) {
  const filters = useTransactionFilters()
  const [sheetOpen, setSheetOpen] = useState(false)

  const activeFilterCount = (filters.accountId ? 1 : 0) + (filters.categoryId ? 1 : 0)

  return (
    <div className="space-y-2">
      {/* Global search + advanced category filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar movimientos"
            placeholder="Busca todo: descripción, comercio, cuenta o categoría…"
            value={filters.search}
            onChange={(e) => filters.setSearch(e.target.value)}
            className="pl-8"
          />
          {filters.search && (
            <button
              aria-label="Limpiar búsqueda"
              onClick={() => filters.setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Button
          aria-label="Abrir filtros"
          variant="outline"
          size="icon"
          className="relative shrink-0"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground"
            >
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* Account is frequent enough to deserve a visible one-tap selector. */}
      <select
        aria-label="Filtrar por cuenta"
        className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        value={filters.accountId ?? ''}
        onChange={(event) => filters.setAccount(event.target.value || null)}
      >
        <option value="">Todas las cuentas</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name} · {account.last4}
          </option>
        ))}
      </select>

      {/* Type tabs — horizontally scrollable */}
      <div className="scrollbar-hide flex gap-1 overflow-x-auto rounded-lg bg-muted p-0.5">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => filters.setType(tab.value)}
            className={cn(
              'h-6 shrink-0 rounded-[6px] px-2.5 text-[11px] font-medium transition-colors',
              filters.type === tab.value
                ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Month selector */}
      <MonthSelector value={filters.month} onChange={filters.setMonth} />

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.accountId && (
            <FilterChip
              label={accounts.find((a) => a.id === filters.accountId)?.name ?? 'Cuenta'}
              onClear={() => filters.setAccount(null)}
            />
          )}
          {filters.categoryId && (
            <FilterChip
              label={categories.find((c) => c.id === filters.categoryId)?.name ?? 'Categoría'}
              onClear={() => filters.setCategory(null)}
            />
          )}
        </div>
      )}

      {/* Advanced filters sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filtros"
        description="Filtra por cuenta o categoría"
      >
        <div className="space-y-5">
          {/* Account */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cuenta
            </p>
            <div className="flex flex-wrap gap-1.5">
              <FilterPill
                active={!filters.accountId}
                onClick={() => filters.setAccount(null)}
                label="Todas"
                ariaLabel="Todas las cuentas"
              />
              {accounts.map((acc) => (
                <FilterPill
                  key={acc.id}
                  active={filters.accountId === acc.id}
                  onClick={() => filters.setAccount(acc.id)}
                  label={`${acc.name} · ${acc.last4}`}
                />
              ))}
            </div>
          </div>

          <Separator />

          {/* Category */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Categoría
            </p>
            <div className="flex flex-wrap gap-1.5">
              <FilterPill
                active={!filters.categoryId}
                onClick={() => filters.setCategory(null)}
                label="Todas"
                ariaLabel="Todas las categorías"
              />
              {categories
                .filter((c) => c.kind === 'expense')
                .map((cat) => (
                  <FilterPill
                    key={cat.id}
                    active={filters.categoryId === cat.id}
                    onClick={() => filters.setCategory(cat.id)}
                    label={cat.name}
                  />
                ))}
            </div>
          </div>

          {(filters.accountId || filters.categoryId) && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                filters.setAccount(null)
                filters.setCategory(null)
              }}
            >
              Limpiar filtros
            </Button>
          )}
        </div>
      </Sheet>
    </div>
  )
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      aria-label={`Quitar filtro ${label}`}
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
    >
      {label}
      <X className="h-3 w-3" />
    </button>
  )
}

function FilterPill({
  active,
  onClick,
  label,
  ariaLabel,
}: {
  active: boolean
  onClick: () => void
  label: string
  ariaLabel?: string
}) {
  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  )
}

/** Month navigator — prev / current label / next. */
function MonthSelector({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const [year, month] = value.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  const label = date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })

  const shift = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1)
    const nextYear = next.getFullYear()
    const nextMonth = String(next.getMonth() + 1).padStart(2, '0')
    onChange(`${nextYear}-${nextMonth}`)
  }

  return (
    <div className="flex items-center justify-between">
      <button
        aria-label="Mes anterior"
        onClick={() => shift(-1)}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <span className="text-xs font-medium capitalize">{label}</span>
      <button
        aria-label="Mes siguiente"
        onClick={() => shift(1)}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  )
}
