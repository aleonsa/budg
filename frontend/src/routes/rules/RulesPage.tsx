import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components/layout/Header'
import { Card, Badge, Button, Input, Label } from '@/components/ui'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Zap, Info } from 'lucide-react'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { useTransactions, useCategories, useRules } from '@/hooks/useQueries'
import type { Rule } from '@/types'

// ── Local helpers ────────────────────────────────────────────

interface MerchantCount {
  merchant: string
  count: number
  hasRule: boolean
}

function topMerchants(
  transactions: { merchant?: string; type: string }[],
  rules: Rule[],
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

function RuleRow({
  rule,
  category,
  onToggle,
}: {
  rule: Rule
  category?: { name: string; color: import('@/types').AccentColor }
  onToggle: () => void
}) {
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
          {category && <Badge accent={category.color}>{category.name}</Badge>}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 rounded-full p-1 transition-colors hover:bg-accent"
        aria-label={rule.isActive ? 'Desactivar regla' : 'Activar regla'}
      >
        {rule.isActive ? (
          <Badge accent="green">Activa</Badge>
        ) : (
          <Badge variant="muted">Inactiva</Badge>
        )}
      </button>
    </div>
  )
}

function SuggestionRow({
  merchant,
  count,
  onCreate,
}: {
  merchant: string
  count: number
  onCreate: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{merchant}</span>
        <Badge variant="outline">{count}x</Badge>
      </div>
      <Button variant="ghost" size="sm" className="shrink-0 text-[11px]" onClick={onCreate}>
        Crear regla
      </Button>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function RulesPage() {
  const txQ = useTransactions()
  const catQ = useCategories()
  const rulesQ = useRules()
  const queryClient = useQueryClient()

  const [isRulePanelOpen, setIsRulePanelOpen] = useState(false)
  const [fField, setFField] = useState<Rule['field']>('merchant')
  const [fOperator, setFOperator] = useState<Rule['operator']>('contains')
  const [fValue, setFValue] = useState('')
  const [fCategory, setFCategory] = useState('')

  const toggleMut = useMutation({
    mutationFn: (id: string) => api.toggleRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
  })
  const createMut = useMutation({
    mutationFn: api.createRule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
  })

  if (txQ.isError || catQ.isError || rulesQ.isError) {
    return (
      <>
        <Header title="Reglas" subtitle="Categorización automática" />
        <Card role="alert" className="my-4 p-3 text-sm text-destructive">
          No se pudieron cargar las reglas. Intenta de nuevo.
        </Card>
      </>
    )
  }

  const isLoading = txQ.isLoading || catQ.isLoading || rulesQ.isLoading

  if (isLoading) {
    return (
      <>
        <Header title="Reglas" subtitle="Categorización automática" />
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      </>
    )
  }

  const transactions = txQ.data ?? []
  const categories = catQ.data ?? []
  const rules = rulesQ.data ?? []

  const categoryMap = new Map(categories.map((c) => [c.id, c]))
  const activeRules = rules.filter((r) => r.isActive)
  const categorizable = transactions.filter(
    (t) => t.type !== 'transfer' && (t.merchant || t.description),
  ).length
  const suggestions = topMerchants(transactions, rules)
  const unsuggested = suggestions.filter((s) => !s.hasRule)

  const openPanel = (preset?: { field?: Rule['field']; value?: string }) => {
    createMut.reset()
    setFField(preset?.field ?? 'merchant')
    setFOperator('contains')
    setFValue(preset?.value ?? '')
    setFCategory('')
    setIsRulePanelOpen(true)
  }

  const closePanel = () => {
    createMut.reset()
    setIsRulePanelOpen(false)
  }

  const handleCreate = () => {
    if (!fValue.trim() || !fCategory) return
    createMut.reset()
    createMut.mutate(
      {
        field: fField,
        operator: fOperator,
        value: fValue.trim(),
        categoryId: fCategory,
        isActive: true,
      },
      { onSuccess: closePanel },
    )
  }

  const handleToggle = (id: string) => {
    toggleMut.reset()
    toggleMut.mutate(id)
  }

  return (
    <>
      <Header
        title="Reglas"
        subtitle="Categorización automática"
        action={
          <Button size="sm" onClick={() => openPanel()}>
            Crear regla
          </Button>
        }
      />
      <div className="space-y-3.5 py-3">
        {toggleMut.error && (
          <Card role="alert" className="p-3 text-xs text-destructive">
            No se pudo actualizar la regla. Intenta de nuevo.
          </Card>
        )}
        {/* Explanation */}
        <Card className="flex items-start gap-2.5 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Las reglas categorizan movimientos automáticamente según comercio o descripción. Ahorra
            tiempo al mantener tus transacciones organizadas sin esfuerzo manual.
            <span className="mt-1 block font-medium text-foreground">
              Las reglas se guardan para futuras transacciones.
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
              Reglas · {rules.length}
            </h2>
          </div>
          {rules.length === 0 ? (
            <Card className="p-3 text-xs text-muted-foreground">
              Aún no hay reglas. Crea una desde un comercio frecuente o con el botón "Crear regla".
            </Card>
          ) : (
            <Card className="divide-y divide-border px-3">
              {rules.map((rule) => {
                const cat = categoryMap.get(rule.categoryId)
                return (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    category={cat ? { name: cat.name, color: cat.color } : undefined}
                    onToggle={() => handleToggle(rule.id)}
                  />
                )
              })}
            </Card>
          )}
        </div>

        {/* Suggestions based on merchant frequency */}
        {unsuggested.length > 0 && (
          <div className="space-y-2">
            <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Sugerencias · comercios frecuentes
            </h2>
            <Card className="divide-y divide-border px-3">
              {unsuggested.map((s) => (
                <SuggestionRow
                  key={s.merchant}
                  merchant={s.merchant}
                  count={s.count}
                  onCreate={() => openPanel({ field: 'merchant', value: s.merchant })}
                />
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

      <MockActionPanel
        open={isRulePanelOpen}
        title="Crear regla"
        description="Automatiza la categorización por comercio o descripción."
        submitLabel="Crear"
        submitting={createMut.isPending}
        onClose={closePanel}
        onSubmit={handleCreate}
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Campo</Label>
            <select
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              value={fField}
              onChange={(e) => setFField(e.target.value as Rule['field'])}
            >
              <option value="merchant">Comercio</option>
              <option value="description">Descripción</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Operador</Label>
            <select
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              value={fOperator}
              onChange={(e) => setFOperator(e.target.value as Rule['operator'])}
            >
              <option value="contains">Contiene</option>
              <option value="startsWith">Empieza con</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Valor</Label>
          <Input
            placeholder="Ej. Uber"
            value={fValue}
            onChange={(e) => setFValue(e.target.value)}
            aria-invalid={Boolean(createMut.error) || undefined}
            aria-describedby={createMut.error ? 'rule-create-error' : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Categoría destino</Label>
          <select
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={fCategory}
            onChange={(e) => setFCategory(e.target.value)}
          >
            <option value="">Selecciona…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {createMut.error && (
          <p id="rule-create-error" role="alert" className="text-xs text-destructive">
            No se pudo crear la regla. Intenta de nuevo.
          </p>
        )}
      </MockActionPanel>
    </>
  )
}
