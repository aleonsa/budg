import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Progress } from './progress'

describe('Progress', () => {
  it('announces values within the supported range', () => {
    render(<Progress value={0.375} aria-label="Ahorro" />)

    expect(screen.getByRole('progressbar', { name: 'Ahorro' })).toHaveAttribute(
      'aria-valuenow',
      '37.5',
    )
  })

  it('announces clamped values below zero and above one', () => {
    const { rerender } = render(<Progress value={-0.5} aria-label="Uso" />)
    expect(screen.getByRole('progressbar', { name: 'Uso' })).toHaveAttribute('aria-valuenow', '0')

    rerender(<Progress value={1.5} aria-label="Uso" />)
    expect(screen.getByRole('progressbar', { name: 'Uso' })).toHaveAttribute('aria-valuenow', '100')
  })
})
