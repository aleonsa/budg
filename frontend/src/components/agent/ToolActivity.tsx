import { useState } from 'react'
import {
  Check,
  ChevronDown,
  CircleX,
  Landmark,
  ListTree,
  Search,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolActivityStep } from '@/stores/agent'

const toolLabels: Record<string, string> = {
  list_accounts: 'Consultando tus cuentas',
  list_categories: 'Consultando tus categorías',
  search_transactions: 'Buscando movimientos',
  get_financial_summary: 'Calculando tu resumen financiero',
  create_transaction: 'Preparando un nuevo movimiento',
  update_transaction: 'Preparando cambios al movimiento',
  delete_transaction: 'Preparando la eliminación del movimiento',
}

export function ToolActivity({
  steps,
  streaming = false,
}: {
  steps: ToolActivityStep[]
  streaming?: boolean
}) {
  const [userChoice, setUserChoice] = useState<boolean | null>(null)
  const expanded = userChoice ?? streaming

  if (steps.length === 0) return null

  return (
    <div className="mb-3 text-xs">
      <button
        type="button"
        onClick={() => setUserChoice(!expanded)}
        aria-expanded={expanded}
        className="group flex items-center gap-1 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className={cn(streaming && 'agent-text-shimmer')}>{summarize(steps, streaming)}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>

      {expanded && (
        <ol className="ml-[9px] mt-2 border-l border-border">
          {steps.map((step) => (
            <ToolRow key={step.id} step={step} />
          ))}
          {!streaming && steps.every((step) => step.status === 'done') && (
            <ToolRow step={{ id: 'done', callId: 'done', tool: 'done', status: 'done' }} />
          )}
          {!streaming && steps.some((step) => step.status === 'failed') && (
            <ToolRow step={{ id: 'failed', callId: 'failed', tool: 'failed', status: 'failed' }} />
          )}
          {!streaming && steps.some((step) => step.status === 'warning') && (
            <ToolRow
              step={{ id: 'warning', callId: 'warning', tool: 'warning', status: 'warning' }}
            />
          )}
          {!streaming && steps.some((step) => step.status === 'cancelled') && (
            <ToolRow
              step={{
                id: 'cancelled',
                callId: 'cancelled',
                tool: 'cancelled',
                status: 'cancelled',
              }}
            />
          )}
        </ol>
      )}
    </div>
  )
}

function ToolRow({ step }: { step: ToolActivityStep }) {
  const running = step.status === 'running'
  const Icon = toolIcon(step.tool)
  const label =
    step.tool === 'done'
      ? 'Listo'
      : step.tool === 'failed'
        ? 'No se pudo completar'
        : step.tool === 'cancelled'
          ? 'Respuesta detenida'
          : step.tool === 'warning'
            ? 'Completado con observaciones'
            : (toolLabels[step.tool] ?? humanizeToolName(step.tool))

  return (
    <li className="relative flex items-center gap-2.5 py-1 pl-5">
      <span className="absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-background text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className={cn(running ? 'agent-text-shimmer' : 'text-muted-foreground')}>{label}</span>
    </li>
  )
}

function summarize(steps: ToolActivityStep[], streaming: boolean): string {
  if (streaming) {
    const current = steps.find((step) => step.status === 'running') ?? steps.at(-1)
    return current ? (toolLabels[current.tool] ?? humanizeToolName(current.tool)) : 'Trabajando'
  }
  if (steps.some((step) => step.status === 'failed')) return 'Actividad interrumpida'
  if (steps.some((step) => step.status === 'cancelled')) return 'Respuesta detenida'
  if (steps.some((step) => step.status === 'warning')) return 'Completado con observaciones'
  return steps.length === 1 ? 'Usó 1 herramienta' : `Usó ${steps.length} herramientas`
}

function humanizeToolName(tool: string): string {
  const label = tool.replaceAll('_', ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function toolIcon(tool: string) {
  if (tool === 'done') return Check
  if (tool === 'failed' || tool === 'cancelled') return CircleX
  if (tool === 'warning') return TriangleAlert
  if (tool === 'search_transactions') return Search
  if (tool === 'get_financial_summary') return Landmark
  if (tool === 'list_accounts' || tool === 'list_categories') return ListTree
  return Wrench
}
