import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Amount } from './Amount'

describe('Amount', () => {
  it('shows explicit positive, negative, and zero signs when requested', () => {
    const { rerender } = render(<Amount value={123456} signed />)
    expect(screen.getByText('+$1,234.56')).toBeInTheDocument()

    rerender(<Amount value={-123456} signed />)
    expect(screen.getByText('−$1,234.56')).toBeInTheDocument()

    rerender(<Amount value={0} signed />)
    expect(screen.getByText('+$0.00')).toBeInTheDocument()
  })

  it('shows an unsigned absolute amount in the requested currency', () => {
    render(<Amount value={-987} currency="USD" />)

    expect(screen.getByText('US$9.87')).toBeInTheDocument()
  })
})
