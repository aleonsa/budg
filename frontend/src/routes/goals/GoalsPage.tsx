import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/common/EmptyState'
import { Amount } from '@/components/common/Amount'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Badge, Button, Card, Input, Label, Progress, Separator } from '@/components/ui'
import {
  deriveGoalProgress,
  useAccounts,
  useSavingsGoals,
  useSavingsOverview,
} from '@/hooks/useQueries'
import { today } from '@/lib/date'
import { centsToInput, formatMoney, toCents } from '@/lib/format'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { SavingsGoal, SavingsGoalWithProgress } from '@/types'

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function isValidAmountInput(value: string, allowBlank = false) {
  if (!value.trim()) return allowBlank
  const normalized = value.replace(/[^0-9.-]/g, '')
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return false
  return Number.isSafeInteger(Math.round(Number(normalized) * 100))
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
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null)
  const [deletingGoal, setDeletingGoal] = useState<SavingsGoal | null>(null)
  const [savingGoal, setSavingGoal] = useState<SavingsGoal | null>(null)
  const goalsQuery = useSavingsGoals()
  const accountsQuery = useAccounts()
  const overviewQuery = useSavingsOverview()
  const queryClient = useQueryClient()

  // New goal form
  const [fName, setFName] = useState('')
  const [fTarget, setFTarget] = useState('')
  const [fAccount, setFAccount] = useState('')
  const [fDate, setFDate] = useState('')
  const [showGoalErrors, setShowGoalErrors] = useState(false)

  // Save and assign form
  const [fSaveAmount, setFSaveAmount] = useState('')
  const [fSaveSource, setFSaveSource] = useState('')
  const [fSaveDestination, setFSaveDestination] = useState('')
  const [fSaveDate, setFSaveDate] = useState(today())
  const [saveOperationId, setSaveOperationId] = useState('')
  const [showSaveErrors, setShowSaveErrors] = useState(false)
  const [managingGoal, setManagingGoal] = useState<SavingsGoal | null>(null)
  const [manageMode, setManageMode] = useState<'assign' | 'release' | 'reallocate'>('assign')
  const [fManageAmount, setFManageAmount] = useState('')
  const [fManageAccount, setFManageAccount] = useState('')
  const [fManageTarget, setFManageTarget] = useState('')
  const [fManageDate, setFManageDate] = useState(today())
  const [manageOperationId, setManageOperationId] = useState('')
  const [showManageErrors, setShowManageErrors] = useState(false)

  const createMut = useMutation({
    mutationFn: api.createSavingsGoal,
    onSuccess: invalidateGoalQueries,
  })
  const updateMut = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Parameters<typeof api.updateSavingsGoal>[1]
    }) => api.updateSavingsGoal(id, patch),
    onSuccess: invalidateGoalQueries,
  })
  const saveMut = useMutation({
    mutationFn: ({
      id,
      input,
      operationId,
    }: {
      id: string
      input: Parameters<typeof api.saveToGoal>[1]
      operationId: string
    }) => api.saveToGoal(id, input, { idempotencyKey: operationId }),
    onSuccess: () => {
      invalidateGoalQueries()
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
    },
  })
  const deleteMut = useMutation({
    mutationFn: api.deleteSavingsGoal,
    onSuccess: invalidateGoalQueries,
  })
  const manageMut = useMutation({
    mutationFn: (input: {
      goalId: string
      mode: 'assign' | 'release' | 'reallocate'
      amount: number
      accountId: string
      targetGoalId: string
      date: string
      operationId: string
    }) =>
      input.mode === 'reallocate'
        ? api.reallocateSavings(
            input.goalId,
            {
              toGoalId: input.targetGoalId,
              accountId: input.accountId,
              amount: input.amount,
              date: input.date,
            },
            { idempotencyKey: input.operationId },
          )
        : api.allocateSavings(
            input.goalId,
            {
              accountId: input.accountId,
              amount: input.mode === 'release' ? -input.amount : input.amount,
              date: input.date,
            },
            { idempotencyKey: input.operationId },
          ),
    onSuccess: invalidateGoalQueries,
  })

  function invalidateGoalQueries() {
    queryClient.invalidateQueries({ queryKey: queryKeys.savingsGoals })
    queryClient.invalidateQueries({ queryKey: queryKeys.savingsOverview })
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
  }

  const openGoalPanel = () => {
    createMut.reset()
    updateMut.reset()
    setEditingGoal(null)
    setFName('')
    setFTarget('')
    setFAccount('')
    setFDate('')
    setShowGoalErrors(false)
    setIsGoalPanelOpen(true)
  }

  const openEditPanel = (goal: SavingsGoal) => {
    createMut.reset()
    updateMut.reset()
    setEditingGoal(goal)
    setFName(goal.name)
    setFTarget(centsToInput(goal.targetAmount))
    setFAccount(goal.accountId ?? '')
    setFDate(goal.targetDate ?? '')
    setShowGoalErrors(false)
    setIsGoalPanelOpen(true)
  }

  const closeGoalPanel = () => {
    createMut.reset()
    updateMut.reset()
    setEditingGoal(null)
    setShowGoalErrors(false)
    setIsGoalPanelOpen(false)
  }

  const openDeletePanel = (goal: SavingsGoal) => {
    deleteMut.reset()
    setDeletingGoal(goal)
  }

  const closeDeletePanel = () => {
    deleteMut.reset()
    setDeletingGoal(null)
  }

  const openSavePanel = (goal: SavingsGoal) => {
    const debitAccounts = (accountsQuery.data ?? []).filter(
      (account) => account.type === 'debit' && account.isActive && account.balanceTrackingEnabled,
    )
    const destination = debitAccounts.some((account) => account.id === goal.accountId)
      ? goal.accountId!
      : (debitAccounts[0]?.id ?? '')
    const source = debitAccounts.find((account) => account.id !== destination)?.id ?? ''
    saveMut.reset()
    setSavingGoal(goal)
    setFSaveAmount('')
    setFSaveSource(source)
    setFSaveDestination(destination)
    setFSaveDate(today())
    setSaveOperationId(crypto.randomUUID())
    setShowSaveErrors(false)
  }

  const closeSavePanel = () => {
    saveMut.reset()
    setShowSaveErrors(false)
    setSavingGoal(null)
  }

  const openManagePanel = (goal: SavingsGoal) => {
    manageMut.reset()
    setManagingGoal(goal)
    setManageMode('assign')
    setFManageAmount('')
    setFManageAccount(goal.accountId ?? overviewQuery.data?.accounts[0]?.accountId ?? '')
    setFManageTarget(
      (goalsQuery.data ?? []).find((candidate) => candidate.id !== goal.id)?.id ?? '',
    )
    setFManageDate(today())
    setManageOperationId(crypto.randomUUID())
    setShowManageErrors(false)
  }

  const closeManagePanel = () => {
    manageMut.reset()
    setManagingGoal(null)
    setShowManageErrors(false)
  }

  const handleGoalSave = () => {
    const target = toCents(fTarget)
    const current = 0
    if (!fName.trim() || !isValidAmountInput(fTarget) || target <= 0) {
      setShowGoalErrors(true)
      return
    }
    if (editingGoal) {
      const patch: Parameters<typeof api.updateSavingsGoal>[1] = {}
      const name = fName.trim()
      const targetDate = fDate || null
      const accountId = fAccount || null
      if (name !== editingGoal.name) patch.name = name
      if (target !== editingGoal.targetAmount) patch.targetAmount = target
      if (targetDate !== (editingGoal.targetDate ?? null)) patch.targetDate = targetDate
      if (accountId !== editingGoal.accountId) patch.accountId = accountId
      if (Object.keys(patch).length === 0) {
        closeGoalPanel()
        return
      }
      updateMut.reset()
      updateMut.mutate(
        {
          id: editingGoal.id,
          patch,
        },
        { onSuccess: closeGoalPanel },
      )
      return
    }
    createMut.reset()
    createMut.mutate(
      {
        name: fName.trim(),
        targetAmount: target,
        currentAmount: current,
        targetDate: fDate || undefined,
        accountId: fAccount || null,
        isCompleted: false,
      },
      { onSuccess: closeGoalPanel },
    )
  }

  const handleSave = () => {
    if (!savingGoal) return
    const amount = toCents(fSaveAmount)
    if (
      amount <= 0 ||
      !fSaveSource ||
      !fSaveDestination ||
      fSaveSource === fSaveDestination ||
      !fSaveDate
    ) {
      setShowSaveErrors(true)
      return
    }
    saveMut.reset()
    saveMut.mutate(
      {
        id: savingGoal.id,
        operationId: saveOperationId,
        input: {
          sourceAccountId: fSaveSource,
          destinationAccountId: fSaveDestination,
          amount,
          date: fSaveDate,
          description: `Ahorro para ${savingGoal.name}`,
        },
      },
      { onSuccess: closeSavePanel },
    )
  }

  const handleManage = () => {
    if (!managingGoal) return
    const amount = toCents(fManageAmount)
    if (
      amount <= 0 ||
      !fManageAccount ||
      !fManageDate ||
      (manageMode === 'reallocate' && !fManageTarget)
    ) {
      setShowManageErrors(true)
      return
    }
    manageMut.reset()
    manageMut.mutate(
      {
        goalId: managingGoal.id,
        mode: manageMode,
        amount,
        accountId: fManageAccount,
        targetGoalId: fManageTarget,
        date: fManageDate,
        operationId: manageOperationId,
      },
      { onSuccess: closeManagePanel },
    )
  }

  if (goalsQuery.isError || accountsQuery.isError || overviewQuery.isError) {
    return (
      <>
        <Header title="Metas" subtitle="Ahorro y objetivos" />
        <Card role="alert" className="my-4 p-3 text-sm text-destructive">
          No se pudieron cargar las metas. Intenta de nuevo.
        </Card>
      </>
    )
  }

  const isLoading = goalsQuery.isLoading || accountsQuery.isLoading || overviewQuery.isLoading

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
  const overview = overviewQuery.data!
  const savingsEligibleAccounts = accounts.filter(
    (account) => account.type === 'debit' && account.isActive && account.balanceTrackingEnabled,
  )
  const goalNameInvalid = showGoalErrors && !fName.trim()
  const goalTargetInvalid =
    showGoalErrors && (!isValidAmountInput(fTarget) || toCents(fTarget) <= 0)
  const activeGoalMutation = editingGoal ? updateMut : createMut
  const goalPanel = (
    <MockActionPanel
      open={isGoalPanelOpen}
      title={editingGoal ? 'Editar meta' : 'Nueva meta'}
      description={
        editingGoal
          ? 'Actualiza montos, fecha o cuenta vinculada.'
          : 'Define una meta de ahorro con cuenta y fecha objetivo.'
      }
      submitLabel={editingGoal ? 'Guardar cambios' : 'Crear'}
      submitting={activeGoalMutation.isPending}
      onClose={closeGoalPanel}
      onSubmit={handleGoalSave}
    >
      <div className="space-y-1.5">
        <Label htmlFor="goal-name">Nombre</Label>
        <Input
          id="goal-name"
          placeholder="Ej. Fondo de emergencia"
          value={fName}
          onChange={(e) => setFName(e.target.value)}
          aria-invalid={goalNameInvalid || Boolean(activeGoalMutation.error) || undefined}
          aria-describedby={
            goalNameInvalid
              ? 'goal-name-error'
              : activeGoalMutation.error
                ? 'goal-save-error'
                : undefined
          }
        />
        {goalNameInvalid && (
          <p id="goal-name-error" role="alert" className="text-xs text-destructive">
            El nombre es obligatorio.
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="goal-target">Objetivo</Label>
          <Input
            id="goal-target"
            placeholder="$0.00"
            inputMode="decimal"
            value={fTarget}
            onChange={(e) => setFTarget(e.target.value)}
            aria-invalid={goalTargetInvalid || undefined}
            aria-describedby={goalTargetInvalid ? 'goal-target-error' : undefined}
          />
          {goalTargetInvalid && (
            <p id="goal-target-error" role="alert" className="text-xs text-destructive">
              El objetivo debe ser mayor que cero.
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="goal-account">Cuenta vinculada</Label>
          <select
            id="goal-account"
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={fAccount}
            onChange={(e) => setFAccount(e.target.value)}
          >
            <option value="">Sin cuenta</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="goal-date">Fecha objetivo</Label>
          <Input
            id="goal-date"
            type="date"
            value={fDate}
            onChange={(e) => setFDate(e.target.value)}
          />
        </div>
      </div>
      {activeGoalMutation.error && (
        <p id="goal-save-error" role="alert" className="text-xs text-destructive">
          No se pudo {editingGoal ? 'actualizar' : 'crear'} la meta. Intenta de nuevo.
        </p>
      )}
    </MockActionPanel>
  )

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
        {goalPanel}
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
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">En cuentas de ahorro</p>
                <Amount value={overview.totalAccountBalance} size="lg" className="mt-1 block" />
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
                aria-label="Progreso total de metas"
                className="flex-1"
              />
              <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {formatPercent(totalProgress)}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Asignado</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {formatMoney(overview.totalAllocated)}
                </p>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Sin asignar</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {formatMoney(overview.totalUnallocated)}
                </p>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Por ahorrar</p>
                <p className="mt-1 font-semibold tabular-nums">{formatMoney(totalRemaining)}</p>
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
                  <Progress
                    value={nextGoal.progress}
                    accent="blue"
                    aria-label={`Progreso de la meta ${nextGoal.name}`}
                    className="flex-1"
                  />
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

        {overview.accounts.length > 0 && (
          <section className="space-y-2">
            <div>
              <p className="text-sm font-medium">Cuentas de ahorro</p>
              <p className="text-xs text-muted-foreground">Saldo real separado por asignación.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {overview.accounts.map((account) => (
                <Card key={account.accountId} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{account.accountName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatMoney(account.allocatedAmount)} asignado
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatMoney(account.balance)}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatMoney(account.unallocatedAmount)} libre
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

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
                    aria-label={`Progreso de la meta ${goal.name}`}
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
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Editar ${goal.name}`}
                        onClick={() => openEditPanel(goal)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Eliminar ${goal.name}`}
                        onClick={() => openDeletePanel(goal)}
                      >
                        Eliminar
                      </Button>
                      {!isComplete && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openManagePanel(goal)}>
                            Gestionar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openSavePanel(goal)}>
                            Ahorrar
                          </Button>
                        </>
                      )}
                    </div>
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
                          <div className="mt-1 flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openManagePanel(goal)}>
                              Gestionar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Editar ${goal.name}`}
                              onClick={() => openEditPanel(goal)}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Eliminar ${goal.name}`}
                              onClick={() => openDeletePanel(goal)}
                            >
                              Eliminar
                            </Button>
                          </div>
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

      {goalPanel}

      <MockActionPanel
        open={deletingGoal !== null}
        title="Eliminar meta"
        description={`¿Eliminar “${deletingGoal?.name ?? ''}”? Esta acción no se puede deshacer.`}
        submitLabel="Eliminar meta"
        submitVariant="destructive"
        submitting={deleteMut.isPending}
        onClose={closeDeletePanel}
        onSubmit={() => {
          if (!deletingGoal) return
          deleteMut.reset()
          deleteMut.mutate(deletingGoal.id, { onSuccess: closeDeletePanel })
        }}
      >
        {deleteMut.error && (
          <p role="alert" className="text-xs text-destructive">
            No se pudo eliminar la meta. Intenta de nuevo.
          </p>
        )}
      </MockActionPanel>

      <MockActionPanel
        open={managingGoal !== null}
        title="Gestionar ahorro"
        description={`Asigna, libera o mueve saldo de “${managingGoal?.name ?? ''}” sin crear movimientos bancarios ficticios.`}
        submitLabel="Aplicar"
        submitting={manageMut.isPending}
        onClose={closeManagePanel}
        onSubmit={handleManage}
      >
        <div className="space-y-1.5">
          <Label htmlFor="goal-manage-mode">Operación</Label>
          <select
            id="goal-manage-mode"
            value={manageMode}
            onChange={(event) => {
              setManageMode(event.target.value as typeof manageMode)
              setManageOperationId(crypto.randomUUID())
            }}
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px]"
          >
            <option value="assign">Asignar saldo existente</option>
            <option value="release">Liberar saldo</option>
            {goals.length > 1 && <option value="reallocate">Mover a otra meta</option>}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="goal-manage-amount">Monto</Label>
            <Input
              id="goal-manage-amount"
              placeholder="$0.00"
              inputMode="decimal"
              value={fManageAmount}
              onChange={(event) => setFManageAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-manage-date">Fecha</Label>
            <Input
              id="goal-manage-date"
              type="date"
              value={fManageDate}
              onChange={(event) => setFManageDate(event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="goal-manage-account">Cuenta de ahorro</Label>
          <select
            id="goal-manage-account"
            value={fManageAccount}
            onChange={(event) => setFManageAccount(event.target.value)}
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px]"
          >
            <option value="">Selecciona</option>
            {savingsEligibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        {manageMode === 'reallocate' && (
          <div className="space-y-1.5">
            <Label htmlFor="goal-manage-target">Meta destino</Label>
            <select
              id="goal-manage-target"
              value={fManageTarget}
              onChange={(event) => setFManageTarget(event.target.value)}
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px]"
            >
              {goals
                .filter((goal) => goal.id !== managingGoal?.id)
                .map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        {showManageErrors && (
          <p role="alert" className="text-xs text-destructive">
            Completa cuenta, monto, fecha y meta destino cuando aplique.
          </p>
        )}
        {manageMut.error && (
          <p role="alert" className="text-xs text-destructive">
            No se pudo actualizar la asignación. Revisa el saldo disponible.
          </p>
        )}
      </MockActionPanel>

      <MockActionPanel
        open={savingGoal !== null}
        title="Ahorrar y asignar"
        description={`Transfiere dinero real y asígnalo a “${savingGoal?.name ?? ''}” en una sola operación.`}
        submitLabel="Transferir y asignar"
        submitting={saveMut.isPending}
        onClose={closeSavePanel}
        onSubmit={handleSave}
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="goal-save-amount">Monto</Label>
            <Input
              id="goal-save-amount"
              placeholder="$0.00"
              inputMode="decimal"
              value={fSaveAmount}
              onChange={(event) => setFSaveAmount(event.target.value)}
              aria-invalid={showSaveErrors && toCents(fSaveAmount) <= 0 ? true : undefined}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-save-date">Fecha</Label>
            <Input
              id="goal-save-date"
              type="date"
              value={fSaveDate}
              onChange={(event) => setFSaveDate(event.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="goal-save-source">Desde</Label>
            <select
              id="goal-save-source"
              value={fSaveSource}
              onChange={(event) => setFSaveSource(event.target.value)}
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <option value="">Selecciona</option>
              {savingsEligibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-save-destination">Hacia</Label>
            <select
              id="goal-save-destination"
              value={fSaveDestination}
              onChange={(event) => setFSaveDestination(event.target.value)}
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <option value="">Selecciona</option>
              {savingsEligibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {showSaveErrors && (
          <p role="alert" className="text-xs text-destructive">
            Ingresa monto, fecha y dos cuentas distintas con saldo automático.
          </p>
        )}
        {saveMut.error && (
          <p role="alert" className="text-xs text-destructive">
            No se pudo transferir y asignar el ahorro. Intenta de nuevo.
          </p>
        )}
      </MockActionPanel>
    </>
  )
}
