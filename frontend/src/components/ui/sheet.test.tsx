import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet } from './sheet'

function getBackdrop() {
  const dialog = screen.getByRole('dialog', { name: 'Detalles' })
  const backdrop = dialog.parentElement?.firstElementChild
  if (!(backdrop instanceof HTMLElement)) throw new Error('Sheet backdrop not found')
  return backdrop
}

describe('Sheet', () => {
  afterEach(() => {
    document.body.style.overflow = ''
    vi.clearAllMocks()
  })

  it('stays absent while closed', () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Detalles">
        <p>Sheet content</p>
      </Sheet>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows title, description, and content while open', () => {
    render(
      <Sheet open onClose={vi.fn()} title="Detalles" description="Información de la cuenta">
        <p>Sheet content</p>
      </Sheet>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Detalles' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Información de la cuenta')
    expect(dialog).toHaveTextContent('Sheet content')
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeVisible()
  })

  it('closes from its button, Escape, and backdrop', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Detalles">
        <button>Inside action</button>
      </Sheet>,
    )

    await user.click(screen.getByRole('button', { name: 'Inside action' }))
    expect(onClose).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.keyboard('{Escape}')
    fireEvent.click(getBackdrop())
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('gives titleless content a fallback name and visible close control', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose}>
        <p>Content-only sheet</p>
      </Sheet>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Panel' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('Content-only sheet')

    const closeButton = screen.getByRole('button', { name: 'Cerrar' })
    expect(closeButton).toBeVisible()
    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('restores the previous body overflow when closed', () => {
    document.body.style.overflow = 'scroll'
    const { rerender } = render(
      <Sheet open onClose={vi.fn()} title="Detalles">
        <p>Sheet content</p>
      </Sheet>,
    )
    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <Sheet open={false} onClose={vi.fn()} title="Detalles">
        <p>Sheet content</p>
      </Sheet>,
    )
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('focuses the close button on open and restores the trigger on close', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <>
        <button>Open details</button>
        <Sheet open={false} onClose={onClose} title="Detalles">
          <button>Inside action</button>
        </Sheet>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Open details' })
    trigger.focus()

    rerender(
      <>
        <button>Open details</button>
        <Sheet open onClose={onClose} title="Detalles">
          <button>Inside action</button>
        </Sheet>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()

    rerender(
      <>
        <button>Open details</button>
        <Sheet open={false} onClose={onClose} title="Detalles">
          <button>Inside action</button>
        </Sheet>
      </>,
    )
    expect(trigger).toHaveFocus()
  })

  it('traps forward and reverse Tab navigation inside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <Sheet open onClose={vi.fn()} title="Detalles">
        <button>Inside action</button>
        <input aria-label="Amount" />
      </Sheet>,
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
      <Sheet open onClose={vi.fn()} title="Detalles">
        <p>Sheet content</p>
      </Sheet>,
    )
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()

    unmount()

    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('scroll')
    trigger.remove()
  })
})
