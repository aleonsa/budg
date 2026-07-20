import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/common/EmptyState'
import { Amount } from '@/components/common/Amount'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Badge, Button, Card, Input, Label, Progress, Separator } from '@/components/ui'
import { deriveGoalProgress, useAccounts, useSavingsGoals } from '@/hooks/useQueries'
import { formatMoney, toCents } from '@/lib/format'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { SavingsGoalWithProgress } from '@/types'

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function getDaysUntil(date: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const target = new Date(`${date}T00:00:00`)
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.ceil((target.getTime() - today.getTime()) / millisecondsPerDay)
}

function getTargetDateLabel(goal: SavingsGoalWithProgress) {
  if (!goal.targetDate) return null

  const daysUntil = getDaysUntil(goal.targetDate)
  const formattedDate = dateFormatter.format(new Date(`${goal.targetDate}T00:00:00`))

  if (goal.isCompleted) return { label: formattedDate, tone: 'muted' as const }
  if (daysUntil < 0) return { label: `Vencida · ${formattedDate}`, tone: 'danger' as const }
  if (daysUntil <= 30)
    return { label: `${daysUntil} días · ${formattedDate}`, tone: 'warning' as const }
  return { label: formattedDate, tone: 'muted' as const }
}

function getGoalState(goal: SavingsGoalWithProgress) {
  if (goal.isCompleted || goal.progress >= 1) {
    return { label: 'Completada', tone: 'success' as const }
  }

  if (!goal.targetDate) {
    return { label: 'En progreso', tone: 'muted' as const }
  }

  const daysUntil = getDaysUntil(goal.targetDate)
  if (daysUntil < 0) return { label: 'Vencida', tone: 'danger' as const }
  if (daysUntil <= 30) return { label: 'Próxima', tone: 'warning' as const }
  return { label: 'En progreso', tone: 'muted' as const }
}

function GoalStatusBadge({ goal }: { goal: SavingsGoalWithProgress }) {
  const state = getGoalState(goal)

  if (state.tone === 'success') return <Badge accent="green">{state.label}</Badge>
  if (state.tone === 'danger') {
    return (
      <Badge
        variant="muted"
        className="bg-[hsl(var(--color-red-soft))] text-[hsl(var(--color-red))]"
      >
        {state.label}
      </Badge>
    )
  }
  if (state.tone === 'warning') {
    return (
      <Badge
        variant="muted"
        className="bg-[hsl(var(--color-orange-soft))] text-[hsl(var(--color-orange))]"
      >
        {state.label}
      </Badge>
    )
  }
  return <Badge variant="muted">{state.label}</Badge>
}

export default function GoalsPage() {
  const [isGoalPanelOpen, setIsGoalPanelOpen] = useState(false)
  const [contributeGoalId, setContributeGoalId] = useState<string | null>(null)
  const goalsQuery = useSavingsGoals()
  const accountsQuery = useAccounts()
  const queryClient = useQueryClient()

  // New goal form
  const [fName, setFName] = useState('')
  const [fTarget, setFTarget] = useState('')
  const [fCurrent, setFCurrent] = useState('')
  const [fAccount, setFAccount] = useState('')
  const [fDate, setFDate] = useState('')

  // Contribution form
  const [fContribute, setFContribute] = useState('')

  const createMut = useMutation({
    mutationFn: api.createSavingsGoal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savingsGoals })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
  const contributeMut = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.contributeToSavingsGoal(id, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savingsGoals })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  const openGoalPanel = () => {
    setFName('')
    setFTarget('')
    setFCurrent('')
    setFAccount('')
    setFDate('')
    setIsGoalPanelOpen(true)
  }

  const openContributePanel = (goalId: string) => {
    setFContribute('')
    setContributeGoalId(goalId)
  }

  const handleCreate = () => {
    const target = toCents(fTarget)
    if (!fName.trim() || target <= 0) return
    createMut.mutate(
      {
        name: fName.trim(),
        targetAmount: target,
        currentAmount: toCents(fCurrent),
        targetDate: fDate || undefined,
        accountId: fAccount || null,
        isCompleted: false,
      },
      { onSuccess: () => setIsGoalPanelOpen(false) },
    )
  }

  const handleContribute = () => {
    if (!contributeGoalId) return
    const amount = toCents(fContribute)
    if (amount === 0) return
    contributeMut.mutate(
      { id: contributeGoalId, amount },
      { onSuccess: () => setContributeGoalId(null) },
    )
  }

  const isLoading = goalsQuery.isLoading || accountsQuery.isLoading

  if (isLoading) {
    return (
      <>
        <Header
          title="Metas"
          subtitle="Ahorro y objetivos"
          action={
            <Button size="sm" onClick={() => openGoalPanel()}>
              Nueva meta
            </Button>
          }
        />
        <div className="space-y-3 py-4">
          <Card className="h-24 animate-pulse bg-muted/40" />
          <Card className="h-28 animate-pulse bg-muted/40" />
          <Card className="h-28 animate-pulse bg-muted/40" />
        </div>
      </>
    )
  }

  const goals = goalsQuery.data ?? []
  const accounts = accountsQuery.data ?? []

  if (goals.length === 0) {
    return (
      <>
        <Header
          title="Metas"
          subtitle="Ahorro y objetivos"
          action={
            <Button size="sm" onClick={() => openGoalPanel()}>
              Nueva meta
            </Button>
          }
        />
        <div className="py-4">
          <EmptyState
            title="Sin metas activas"
            description="Define una meta de ahorro para trackear tu progreso."
            action={
              <Button size="sm" onClick={() => openGoalPanel()}>
                Crear meta
              </Button>
            }
          />
        </div>
      </>
    )
  }

  const accountsMap = new Map(accounts.map((account) => [account.id, account]))
  const goalsWithProgress = deriveGoalProgress(goals).sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1
    return a.order - b.order
  })
  const totalTarget = goalsWithProgress.reduce((sum, goal) => sum + goal.targetAmount, 0)
  const totalSaved = goalsWithProgress.reduce((sum, goal) => sum + goal.currentAmount, 0)
  const totalRemaining = goalsWithProgress.reduce(
    (sum, goal) => sum + Math.max(goal.remaining, 0),
    0,
  )
  const activeCount = goalsWithProgress.filter((goal) => !goal.isCompleted).length
  const completedCount = goalsWithProgress.length - activeCount
  const totalProgress = totalTarget > 0 ? totalSaved / totalTarget : 0
  const activeGoals = goalsWithProgress.filter((goal) => !goal.isCompleted && goal.progress < 1)
  const completedGoals = goalsWithProgress.filter((goal) => goal.isCompleted || goal.progress >= 1)
  const nextGoal = [...activeGoals]
    .filter((goal) => Boolean(goal.targetDate))
    .sort((a, b) => getDaysUntil(a.targetDate ?? '') - getDaysUntil(b.targetDate ?? ''))[0]

  return (
    <>
      <Header
        title="Metas"
        subtitle="Ahorro y objetivos"
        action={
          <Button size="sm" onClick={() => openGoalPanel()}>
            Nueva meta
          </Button>
        }
      />
      <div className="space-y-3 py-4">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Progreso total</p>
                <Amount value={totalSaved} size="lg" className="mt-1 block" />
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Objetivo agregado</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {formatMoney(totalTarget)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activeCount} activas · {completedCount} completadas
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Progress
                value={totalProgress}
                variant={totalProgress >= 1 ? 'success' : 'default'}
                className="flex-1"
              />
              <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {formatPercent(totalProgress)}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Restante</p>
                <p className="mt-1 font-semibold tabular-nums">{formatMoney(totalRemaining)}</p>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Activas</p>
                <p className="mt-1 font-semibold tabular-nums">{activeCount}</p>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Listas</p>
                <p className="mt-1 font-semibold tabular-nums">{completedCount}</p>
              </div>
            </div>
          </Card>

          <Card className="p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Próximo objetivo</p>
                <p className="text-xs text-muted-foreground">La meta con fecha más cercana.</p>
              </div>
              <Badge variant="muted">Agenda</Badge>
            </div>
            {nextGoal ? (
              <div className="mt-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{nextGoal.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getTargetDateLabel(nextGoal)?.label}
                    </p>
                  </div>
                  <GoalStatusBadge goal={nextGoal} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Progress value={nextGoal.progress} accent="blue" className="flex-1" />
                  <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {formatPercent(nextGoal.progress)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Faltan {formatMoney(Math.max(nextGoal.remaining, 0))}
                </p>
              </div>
            ) : (
              <p className="mt-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                No hay metas activas con fecha objetivo.
              </p>
            )}
          </Card>
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Metas activas</p>
              <p className="text-xs text-muted-foreground">Objetivos abiertos y próximos hitos.</p>
            </div>
            <Badge variant="muted">{activeGoals.length}</Badge>
          </div>

          {activeGoals.length === 0 ? (
            <Card className="p-3">
              <p className="text-sm font-medium">Sin metas pendientes</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Todas tus metas registradas están completadas.
              </p>
            </Card>
          ) : (
            activeGoals.map((goal) => {
              const account = goal.accountId ? accountsMap.get(goal.accountId) : undefined
              const isComplete = goal.isCompleted || goal.progress >= 1
              const targetDate = getTargetDateLabel(goal)

              return (
                <Card key={goal.id} className={`p-3 ${isComplete ? 'bg-muted/30' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium">{goal.name}</p>
                        <GoalStatusBadge goal={goal} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatMoney(goal.currentAmount)} / {formatMoney(goal.targetAmount)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatPercent(goal.progress)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {isComplete ? 'Objetivo logrado' : `${formatMoney(goal.remaining)} faltan`}
                      </p>
                    </div>
                  </div>

                  <Progress
                    value={goal.progress}
                    variant={isComplete ? 'success' : 'default'}
                    accent={isComplete ? undefined : 'blue'}
                    className="mt-3"
                  />

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {targetDate && (
                      <Badge
                        variant="muted"
                        className={
                          targetDate.tone === 'danger'
                            ? 'bg-[hsl(var(--color-red-soft))] text-[hsl(var(--color-red))]'
                            : targetDate.tone === 'warning'
                              ? 'bg-[hsl(var(--color-orange-soft))] text-[hsl(var(--color-orange))]'
                              : undefined
                        }
                      >
                        {targetDate.label}
                      </Badge>
                    )}
                    {account && (
                      <Badge variant="outline">
                        {account.name} · {account.institution}
                      </Badge>
                    )}
                    {!isComplete && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() => openContributePanel(goal.id)}
                      >
                        Aportar
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })
          )}
        </section>

        {completedGoals.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Metas completadas</p>
                <p className="text-xs text-muted-foreground">Patrimonio objetivo ya alcanzado.</p>
              </div>
              <Badge accent="green">{completedGoals.length}</Badge>
            </div>
            <Card className="p-3">
              <div className="space-y-3">
                {completedGoals.map((goal, index) => {
                  const account = goal.accountId ? accountsMap.get(goal.accountId) : undefined
                  return (
                    <div key={goal.id}>
                      {index > 0 && <Separator className="mb-3" />}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{goal.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {account
                              ? `${account.name} · ${account.institution}`
                              : 'Sin cuenta vinculada'}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums">
                            {formatMoney(goal.targetAmount)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[hsl(var(--color-green))]">
                            Completada
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </section>
        )}
      </div>

      <MockActionPanel
        open={isGoalPanelOpen}
        title="Nueva meta"
        description="Define una meta de ahorro con cuenta y fecha objetivo."
        submitLabel="Crear"
        submitting={createMut.isPending}
        onClose={() => setIsGoalPanelOpen(false)}
        onSubmit={handleCreate}
      >
        <div className="space-y-1.5">
          <Label>Nombre</Label>
          <Input
            placeholder="Ej. Fondo de emergencia"
            value={fName}
            onChange={(e) => setFName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Objetivo</Label>
            <Input
              placeholder="$0.00"
              inputMode="decimal"
              value={fTarget}
              onChange={(e) => setFTarget(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ahorrado actual</Label>
            <Input
              placeholder="$0.00"
              inputMode="decimal"
              value={fCurrent}
              onChange={(e) => setFCurrent(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Cuenta vinculada</Label>
            <select
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              value={fAccount}
              onChange={(e) => setFAccount(e.target.value)}
            >
              <option value="">Sin cuenta</option>
              {(accountsQuery.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Fecha objetivo</Label>
            <Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
          </div>
        </div>
      </MockActionPanel>

      <MockActionPanel
        open={contributeGoalId !== null}
        title="Aportar a la meta"
        description="Suma fondos al ahorro de esta meta."
        submitLabel="Aportar"
        submitting={contributeMut.isPending}
        onClose={() => setContributeGoalId(null)}
        onSubmit={handleContribute}
      >
        <div className="space-y-1.5">
          <Label>Monto</Label>
          <Input
            placeholder="$0.00"
            inputMode="decimal"
            value={fContribute}
            onChange={(e) => setFContribute(e.target.value)}
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">
            Usa un valor negativo para retirar fondos.
          </p>
        </div>
      </MockActionPanel>
    </>
  )
}
