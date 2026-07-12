import { Header } from '@/components/layout/Header'
import { Card, Badge, Button } from '@/components/ui'
import { Zap, Info } from 'lucide-react'
import { useTransactions, useCategories } from '@/hooks/useQueries'
import type { AccentColor } from '@/types'

// ── Mock rule types (local only, no backend) ─────────────────

interface MockRule {
  id: string
  field: 'merchant' | 'description'
  operator: 'contains'
  value: string
  categoryId: string
  categoryName: string
  categoryColor: AccentColor
  isActive: boolean
  priority: number
}

const MOCK_RULES: MockRule[] = [
  {
    id: 'rule-1',
    field: 'merchant',
    operator: 'contains',
    value: 'Uber',
    categoryId: 'cat-transport',
    categoryName: 'Transporte',
    categoryColor: 'cyan',
    isActive: true,
    priority: 1,
  },
  {
    id: 'rule-2',
    field: 'merchant',
    operator: 'contains',
    value: 'OXXO',
    categoryId: 'cat-food',
    categoryName: 'Comida',
    categoryColor: 'orange',
    isActive: true,
    priority: 2,
  },
  {
    id: 'rule-3',
    field: 'description',
    operator: 'contains',
    value: 'Nómina',
    categoryId: 'cat-income',
    categoryName: 'Ingreso',
    categoryColor: 'green',
    isActive: true,
    priority: 1,
  },
  {
    id: 'rule-4',
    field: 'merchant',
    operator: 'contains',
    value: 'Netflix',
    categoryId: 'cat-entertainment',
    categoryName: 'Entretenimiento',
    categoryColor: 'purple',
    isActive: false,
    priority: 3,
  },
]

// ── Local helpers ────────────────────────────────────────────

interface MerchantCount {
  merchant: string
  count: number
  hasRule: boolean
}

function topMerchants(
  transactions: { merchant?: string; type: string }[],
  rules: MockRule[],
): MerchantCount[] {
  const counts = new Map<string, number>()
  for (const t of transactions) {
    if (t.type === 'transfer' || !t.merchant) continue
    counts.set(t.merchant, (counts.get(t.merchant) ?? 0) + 1)
  }
  const ruleMerchants = new Set(
    rules.filter((r) => r.field === 'merchant' && r.isActive).map((r) => r.value.toLowerCase()),
  )
  return Array.from(counts.entries())
    .map(([merchant, count]) => ({
      merchant,
      count,
      hasRule: ruleMerchants.has(merchant.toLowerCase()),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

// ── Sub-components ───────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border px-2.5 py-1.5">
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums leading-tight">{value}</p>
    </div>
  )
}

function RuleRow({ rule }: { rule: MockRule }) {
  const fieldLabel = rule.field === 'merchant' ? 'Comercio' : 'Descripción'

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
          {rule.priority}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{fieldLabel}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
            «{rule.value}»
          </span>
          <span className="text-xs text-muted-foreground">→</span>
          <Badge accent={rule.categoryColor}>{rule.categoryName}</Badge>
        </div>
      </div>
      <div className="shrink-0">
        {rule.isActive ? (
          <Badge accent="green">Activa</Badge>
        ) : (
          <Badge variant="muted">Inactiva</Badge>
        )}
      </div>
    </div>
  )
}

function SuggestionRow({ merchant, count }: { merchant: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{merchant}</span>
        <Badge variant="outline">{count}x</Badge>
      </div>
      <Button variant="ghost" size="sm" disabled className="shrink-0 text-[11px]">
        Crear regla
      </Button>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function RulesPage() {
  const txQ = useTransactions()
  const catQ = useCategories()

  const transactions = txQ.data ?? []
  const categories = catQ.data ?? []

  const activeRules = MOCK_RULES.filter((r) => r.isActive)
  const categorizable = transactions.filter(
    (t) => t.type !== 'transfer' && (t.merchant || t.description),
  ).length
  const suggestions = topMerchants(transactions, MOCK_RULES)
  const unsuggested = suggestions.filter((s) => !s.hasRule)

  return (
    <>
      <Header title="Reglas" subtitle="Categorización automática" />
      <div className="space-y-5 py-4">
        {/* Explanation */}
        <Card className="flex items-start gap-2.5 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Las reglas categorizan movimientos automáticamente según comercio o descripción.
            Ahorra tiempo al mantener tus transacciones organizadas sin esfuerzo manual.
            <span className="mt-1 block font-medium text-foreground">
              Funcionalidad en preparación — sin efectos reales todavía.
            </span>
          </p>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2">
          <StatChip label="Reglas activas" value={activeRules.length} />
          <StatChip label="Sugerencias" value={unsuggested.length} />
          <StatChip label="Movs. categorizables" value={categorizable} />
        </div>

        {/* Active & inactive rules */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3 w-3" />
              Reglas · {MOCK_RULES.length}
            </h2>
          </div>
          <Card className="divide-y divide-border px-3">
            {MOCK_RULES.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </Card>
        </div>

        {/* Suggestions based on merchant frequency */}
        {unsuggested.length > 0 && (
          <div className="space-y-2">
            <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Sugerencias · comercios frecuentes
            </h2>
            <Card className="divide-y divide-border px-3">
              {unsuggested.map((s) => (
                <SuggestionRow key={s.merchant} merchant={s.merchant} count={s.count} />
              ))}
            </Card>
          </div>
        )}

        {/* Categories context */}
        <div className="space-y-2">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Categorías disponibles
          </h2>
          <div className="flex flex-wrap gap-1.5 px-1">
            {categories.map((c) => (
              <Badge key={c.id} accent={c.color}>
                {c.name}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
