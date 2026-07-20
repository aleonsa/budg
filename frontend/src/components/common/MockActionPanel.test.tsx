import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockActionPanel } from './MockActionPanel'

const defaultProps = {
  open: true,
  title: 'Nuevo movimiento',
  description: 'Captura los datos.',
  onClose: vi.fn(),
}

function getOverlay() {
  const overlay = screen.getByRole('dialog', { name: defaultProps.title }).parentElement
  if (!overlay) throw new Error('Panel overlay not found')
  return overlay
}

describe('MockActionPanel', () => {
  afterEach(() => {
    document.body.style.overflow = ''
    vi.clearAllMocks()
  })

  it('stays absent and leaves body scrolling unchanged while closed', () => {
    document.body.style.overflow = 'scroll'
    render(
      <MockActionPanel {...defaultProps} open={false}>
        <p>Form fields</p>
      </MockActionPanel>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('exposes a named modal dialog with its description', () => {
    render(
      <MockActionPanel {...defaultProps}>
        <p>Form fields</p>
      </MockActionPanel>,
    )

    const dialog = screen.getByRole('dialog', { name: defaultProps.title })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(defaultProps.description)
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeVisible()
  })

  it('locks body scrolling while open and restores its previous value on close', () => {
    document.body.style.overflow = 'scroll'
    const { rerender } = render(
      <MockActionPanel {...defaultProps}>
        <p>Form fields</p>
      </MockActionPanel>,
    )

    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <MockActionPanel {...defaultProps} open={false}>
        <p>Form fields</p>
      </MockActionPanel>,
    )
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('closes from Escape, backdrop, and close controls but not panel content', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MockActionPanel {...defaultProps} onClose={onClose} onSubmit={vi.fn()}>
        <button>Inside action</button>
      </MockActionPanel>,
    )

    await user.click(screen.getByRole('button', { name: 'Inside action' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(getOverlay())
    await user.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledOnce()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('submits once when ready', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <MockActionPanel {...defaultProps} submitLabel="Crear" onSubmit={onSubmit}>
        <p>Form fields</p>
      </MockActionPanel>,
    )

    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('disables cancellation and submission while pending', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <MockActionPanel {...defaultProps} onSubmit={onSubmit} submitting>
        <p>Form fields</p>
      </MockActionPanel>,
    )

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    const submit = screen.getByRole('button', { name: 'Guardando…' })
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('omits submit controls when no submit action exists', () => {
    render(
      <MockActionPanel {...defaultProps}>
        <p>Read-only details</p>
      </MockActionPanel>,
    )

    expect(screen.getByText('Read-only details')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
  })

  it('focuses the close button on open and restores the trigger on close', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <>
        <button>Open form</button>
        <MockActionPanel {...defaultProps} open={false} onClose={onClose}>
          <button>Inside action</button>
        </MockActionPanel>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Open form' })
    trigger.focus()

    rerender(
      <>
        <button>Open form</button>
        <MockActionPanel {...defaultProps} onClose={onClose}>
          <button>Inside action</button>
        </MockActionPanel>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()

    rerender(
      <>
        <button>Open form</button>
        <MockActionPanel {...defaultProps} open={false} onClose={onClose}>
          <button>Inside action</button>
        </MockActionPanel>
      </>,
    )
    expect(trigger).toHaveFocus()
  })

  it('traps forward and reverse Tab navigation inside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <MockActionPanel {...defaultProps}>
        <button>Inside action</button>
        <input aria-label="Amount" />
      </MockActionPanel>,
    )
    const close = screen.getByRole('button', { name: 'Cerrar' })
    const action = screen.getByRole('button', { name: 'Inside action' })
    const input = screen.getByRole('textbox', { name: 'Amount' })

    expect(close).toHaveFocus()
    await user.tab()
    expect(action).toHaveFocus()
    await user.tab()
    expect(input).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(input).toHaveFocus()
  })

  it('restores focus and body scrolling when unmounted while open', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'External trigger'
    document.body.append(trigger)
    trigger.focus()
    document.body.style.overflow = 'scroll'

    const { unmount } = render(
      <MockActionPanel {...defaultProps}>
        <p>Form fields</p>
      </MockActionPanel>,
    )
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()

    unmount()

    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('scroll')
    trigger.remove()
  })
})
