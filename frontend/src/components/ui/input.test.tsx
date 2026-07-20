import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Input } from './input'

describe('Input', () => {
  it('accepts user input and exposes its value through the input ref', async () => {
    const user = userEvent.setup()
    const ref = createRef<HTMLInputElement>()
    render(<Input ref={ref} aria-label="Nombre" />)

    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Cuenta diaria')

    expect(ref.current).toHaveValue('Cuenta diaria')
  })

  it('does not accept user input while disabled', async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Nombre" disabled />)

    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Ignored')

    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveValue('')
  })
})
