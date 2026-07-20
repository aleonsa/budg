import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card'

describe('Card', () => {
  it('composes labelled content and interactive footer actions', async () => {
    const user = userEvent.setup()
    const onReview = vi.fn()
    render(
      <Card role="region" aria-labelledby="summary-title">
        <CardHeader>
          <CardTitle id="summary-title" role="heading" aria-level={2}>
            Resumen mensual
          </CardTitle>
          <CardDescription>Julio de 2026</CardDescription>
        </CardHeader>
        <CardContent>Gasto total: $1,000.00</CardContent>
        <CardFooter>
          <button onClick={onReview}>Revisar</button>
        </CardFooter>
      </Card>,
    )

    const card = screen.getByRole('region', { name: 'Resumen mensual' })
    expect(card).toHaveTextContent('Julio de 2026')
    expect(card).toHaveTextContent('Gasto total: $1,000.00')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(onReview).toHaveBeenCalledOnce()
  })
})
