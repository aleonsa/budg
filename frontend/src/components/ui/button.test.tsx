import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('handles an enabled click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(<Button onClick={onClick}>Guardar</Button>)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not handle clicks while disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <Button disabled onClick={onClick}>
        Guardar
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onClick).not.toHaveBeenCalled()
  })
})
