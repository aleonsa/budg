import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'

describe('Badge', () => {
  it('exposes status text and supplied accessibility metadata', () => {
    render(
      <Badge role="status" aria-label="Estado de la cuenta" accent="green">
        Activa
      </Badge>,
    )

    expect(screen.getByRole('status', { name: 'Estado de la cuenta' })).toHaveTextContent('Activa')
  })

  it('renders non-accent status content', () => {
    render(<Badge role="status">Pendiente</Badge>)

    expect(screen.getByRole('status')).toHaveTextContent('Pendiente')
  })
})
