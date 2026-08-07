import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToolActivity } from './ToolActivity'

const steps = [
  {
    id: 'call-1',
    callId: 'call-1',
    tool: 'search_transactions',
    status: 'done' as const,
  },
  {
    id: 'call-2',
    callId: 'call-2',
    tool: 'get_financial_summary',
    status: 'running' as const,
  },
]

describe('ToolActivity', () => {
  it('stays expanded and names the active tool while streaming', () => {
    render(<ToolActivity steps={steps} streaming />)

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText('Calculando tu resumen financiero')).toHaveLength(2)
    expect(screen.getByText('Buscando movimientos')).toBeInTheDocument()
  })

  it('collapses completed tools into a summary and can reopen them', async () => {
    const user = userEvent.setup()
    render(<ToolActivity steps={steps.map((step) => ({ ...step, status: 'done' as const }))} />)

    const disclosure = screen.getByRole('button', { name: /usó 2 herramientas/i })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')

    await user.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Listo')).toBeInTheDocument()
  })

  it('does not report completion when tool activity failed', async () => {
    const user = userEvent.setup()
    render(<ToolActivity steps={[{ ...steps[0], status: 'failed' }]} />)

    const disclosure = screen.getByRole('button', { name: /actividad interrumpida/i })
    await user.click(disclosure)

    expect(screen.getByText('No se pudo completar')).toBeInTheDocument()
    expect(screen.queryByText('Listo')).not.toBeInTheDocument()
  })
})
