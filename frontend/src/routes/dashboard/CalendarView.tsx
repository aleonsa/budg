import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, TrendingUp, Plus } from 'lucide-react'
import { Card, Button } from '@/components/ui'
import { Amount } from '@/components/common/Amount'
import { CategoryIcon } from '@/components/common/CategoryIcon'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Category, Cents, Transaction, TransactionType } from '@/types'

const WEEKDAYS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']

const monthFormatter = new Intl.DateTimeFormat('es-MX', {
  month: 'long',
  year: 'numeric',
})

const dateFormatterFull = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatMonthLabel(date: Date): string {
  const formatted = monthFormatter.format(date)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function formatDayFullLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const formatted = dateFormatterFull.format(date)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function toLocalDateStr(year: number, monthIndex: number, day: number): string {
  const y = String(year)
  const m = String(monthIndex + 1).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface CalendarViewProps {
  transactions: Transaction[]
  categories: Map<string, Category>
  initialDate?: Date
  onAddTransactionForDate?: (dateStr: string, type?: TransactionType) => void
}

export function CalendarView({
  transactions,
  categories,
  initialDate,
  onAddTransactionForDate,
}: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(() => initialDate ?? new Date())
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const init = initialDate ?? new Date()
    return toLocalDateStr(init.getFullYear(), init.getMonth(), init.getDate())
  })

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const monthLabel = formatMonthLabel(currentDate)

  // Navigate months
  const handlePrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  // Days calculations for calendar grid
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay() // 0 = Sunday

  // Group transactions for current month
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`

  const monthTransactions = useMemo(() => {
    return transactions.filter((tx) => tx.date.startsWith(monthPrefix))
  }, [transactions, monthPrefix])

  // Aggregate metrics
  const totals = useMemo(() => {
    let income: Cents = 0
    let expense: Cents = 0
    let savings: Cents = 0

    for (const tx of monthTransactions) {
      if (tx.type === 'income') {
        income += tx.amount
      } else if (tx.type === 'expense') {
        expense += tx.amount
      } else if (tx.type === 'transfer') {
        savings += tx.amount
      }
    }

    const netBalance = income - expense

    // Prom. diario = total expense / days elapsed in month
    const now = new Date()
    let daysElapsed = daysInMonth
    if (now.getFullYear() === year && now.getMonth() === month) {
      daysElapsed = Math.max(1, Math.min(now.getDate(), daysInMonth))
    }

    const dailyAvgExpense = daysElapsed > 0 ? Math.round(expense / daysElapsed) : 0

    return {
      income,
      expense,
      savings,
      netBalance,
      dailyAvgExpense,
    }
  }, [monthTransactions, year, month, daysInMonth])

  // Day map: 'YYYY-MM-DD' -> { expenses: Cents, income: Cents, savings: Cents, txs: Transaction[] }
  const dayMap = useMemo(() => {
    const map = new Map<
      string,
      { expense: Cents; income: Cents; savings: Cents; txs: Transaction[] }
    >()

    for (const tx of monthTransactions) {
      const entry = map.get(tx.date) ?? { expense: 0, income: 0, savings: 0, txs: [] }
      if (tx.type === 'expense') entry.expense += tx.amount
      else if (tx.type === 'income') entry.income += tx.amount
      else if (tx.type === 'transfer') entry.savings += tx.amount
      entry.txs.push(tx)
      map.set(tx.date, entry)
    }

    return map
  }, [monthTransactions])

  // Identify "Mayor gasto" date
  const highestExpenseDate = useMemo(() => {
    let maxDate: string | null = null
    let maxAmount: Cents = 0

    for (const [dateStr, data] of dayMap.entries()) {
      if (data.expense > maxAmount) {
        maxAmount = data.expense
        maxDate = dateStr
      }
    }

    return maxDate
  }, [dayMap])

  // Transactions for selected day
  const selectedDayData = dayMap.get(selectedDate)
  const selectedDayTxs = selectedDayData?.txs ?? []

  return (
    <div className="space-y-3">
      {/* 1. Month Navigator Header */}
      <Card className="p-2.5">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg border border-border bg-background"
            onClick={handlePrevMonth}
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2 font-semibold text-foreground text-sm capitalize">
            <CalendarIcon className="h-4 w-4 text-[hsl(var(--color-green))]" />
            <span>{monthLabel}</span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg border border-border bg-background"
            onClick={handleNextMonth}
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {/* 2. Metrics Summary Card */}
      <Card className="p-3.5 space-y-3">
        {/* Top row: Gastos, Ingresos, Ahorro */}
        <div className="grid grid-cols-3 gap-2 text-center divide-x divide-border/60">
          <div className="px-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Gastos
            </p>
            <p className="mt-1 text-xs sm:text-sm font-semibold tabular-nums text-[hsl(var(--color-red))] truncate">
              {formatMoney(-totals.expense)}
            </p>
          </div>

          <div className="px-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Ingresos
            </p>
            <p className="mt-1 text-xs sm:text-sm font-semibold tabular-nums text-[hsl(var(--color-green))] truncate">
              +{formatMoney(totals.income)}
            </p>
          </div>

          <div className="px-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Ahorro
            </p>
            <p className="mt-1 text-xs sm:text-sm font-semibold tabular-nums text-[hsl(var(--color-purple))] truncate">
              {formatMoney(totals.savings)}
            </p>
          </div>
        </div>

        {/* Bottom row: Balance, Prom. diario */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/60">
          <div className="rounded-lg bg-muted/30 p-2.5 text-center">
            <p className="text-[11px] font-medium text-muted-foreground">Balance</p>
            <div className="mt-1 flex items-center justify-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-[hsl(var(--color-green))]" />
              <p
                className={cn(
                  'text-xs sm:text-sm font-semibold tabular-nums',
                  totals.netBalance >= 0
                    ? 'text-[hsl(var(--color-green))]'
                    : 'text-[hsl(var(--color-red))]',
                )}
              >
                {totals.netBalance >= 0 ? '+' : ''}
                {formatMoney(totals.netBalance)}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/30 p-2.5 text-center">
            <p className="text-[11px] font-medium text-muted-foreground">Prom. diario</p>
            <p className="mt-1 text-xs sm:text-sm font-semibold tabular-nums text-[hsl(var(--color-red))]">
              {formatMoney(-totals.dailyAvgExpense)}
            </p>
          </div>
        </div>
      </Card>

      {/* 3. Calendar Grid Card */}
      <Card className="p-3 sm:p-4">
        {/* Days of week header */}
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days grid */}
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center">
          {/* Empty padding slots before 1st day of month */}
          {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
            <div key={`empty-${idx}`} className="h-12 sm:h-14" />
          ))}

          {/* Month day slots */}
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const dayNum = idx + 1
            const dateStr = toLocalDateStr(year, month, dayNum)
            const dayInfo = dayMap.get(dateStr)

            const isSelected = selectedDate === dateStr
            const isHighestExpense = highestExpenseDate === dateStr && (dayInfo?.expense ?? 0) > 0

            const hasExpense = (dayInfo?.expense ?? 0) > 0
            const hasIncome = (dayInfo?.income ?? 0) > 0
            const hasSavings = (dayInfo?.savings ?? 0) > 0

            // Amount sub-label to display under day number
            const displayAmount = dayInfo
              ? dayInfo.expense > 0
                ? dayInfo.expense
                : dayInfo.income > 0
                  ? dayInfo.income
                  : dayInfo.savings
              : 0

            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => setSelectedDate(dateStr)}
                className={cn(
                  'flex flex-col items-center justify-between py-1 px-0.5 rounded-xl h-12 sm:h-14 transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  isSelected
                    ? 'bg-muted/70 ring-1 ring-border'
                    : 'hover:bg-muted/30 active:bg-muted/50',
                )}
              >
                {/* Day Number Circle */}
                <span
                  className={cn(
                    'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full transition-all',
                    isSelected
                      ? 'bg-[hsl(var(--color-green))] text-white font-semibold shadow-xs'
                      : isHighestExpense
                        ? 'border-2 border-[hsl(var(--color-red))] text-[hsl(var(--color-red))] font-semibold'
                        : 'text-foreground',
                  )}
                >
                  {dayNum}
                </span>

                {/* Sub-label Amount */}
                {displayAmount > 0 ? (
                  <span
                    className={cn(
                      'text-[9px] sm:text-[10px] font-semibold tabular-nums truncate max-w-full leading-tight',
                      isHighestExpense
                        ? 'text-[hsl(var(--color-red))]'
                        : dayInfo?.expense
                          ? 'text-muted-foreground'
                          : dayInfo?.income
                            ? 'text-[hsl(var(--color-green))]'
                            : 'text-[hsl(var(--color-purple))]',
                    )}
                  >
                    {formatMoneyCompact(displayAmount)}
                  </span>
                ) : (
                  <span className="h-3" />
                )}

                {/* Category/Type colored underline indicators */}
                <div className="flex items-center justify-center gap-0.5 h-1">
                  {hasExpense && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--color-red))]" />
                  )}
                  {hasIncome && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--color-green))]" />
                  )}
                  {hasSavings && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--color-purple))]" />
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Legend at bottom of calendar card */}
        <div className="mt-4 pt-3 border-t border-border/60 flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--color-red))]" />
            <span>Gastos</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--color-green))]" />
            <span>Ingresos</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--color-purple))]" />
            <span>Ahorro</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-[hsl(var(--color-red))]" />
            <span>Mayor gasto</span>
          </div>
        </div>
      </Card>

      {/* 4. Selected Day Movements Detail Card */}
      <Card className="p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold capitalize">{formatDayFullLabel(selectedDate)}</p>
            <p className="text-xs text-muted-foreground">
              {selectedDayTxs.length} {selectedDayTxs.length === 1 ? 'movimiento' : 'movimientos'}
            </p>
          </div>

          {onAddTransactionForDate && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              onClick={() => onAddTransactionForDate(selectedDate)}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Agregar</span>
            </Button>
          )}
        </div>

        {selectedDayTxs.length === 0 ? (
          <p className="rounded-lg bg-muted/30 p-3 text-center text-xs text-muted-foreground">
            Sin movimientos registrados este día.
          </p>
        ) : (
          <div className="space-y-2 divide-y divide-border/50">
            {selectedDayTxs.map((tx) => {
              const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
              const isIncome = tx.type === 'income'
              const isExpense = tx.type === 'expense'

              return (
                <div
                  key={tx.id}
                  className="pt-2 first:pt-0 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CategoryIcon
                      name={category?.icon ?? 'Repeat'}
                      color={category?.color ?? 'gray'}
                      className="h-8 w-8 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">
                        {tx.description}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {tx.merchant ??
                          (isIncome ? 'Ingreso' : isExpense ? 'Gasto' : 'Transferencia')}
                      </p>
                    </div>
                  </div>

                  <Amount
                    value={isIncome ? tx.amount : -tx.amount}
                    signed
                    size="sm"
                    className={cn(
                      'shrink-0 font-medium',
                      isIncome
                        ? 'text-[hsl(var(--color-green))]'
                        : isExpense
                          ? 'text-[hsl(var(--color-red))]'
                          : 'text-foreground',
                    )}
                  />
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
