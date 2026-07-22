import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BottomNav } from './BottomNav'

function LocationProbe() {
  return <output aria-label="Current path">{useLocation().pathname}</output>
}

function renderNavigation(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('BottomNav', () => {
  it('marks and navigates primary destinations', async () => {
    const user = userEvent.setup()
    renderNavigation()

    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('link', { name: 'Mov.' }))
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/transactions')
  })

  it('navigates to a secondary destination and closes the more sheet', async () => {
    const user = userEvent.setup()
    renderNavigation('/categories/food')

    await user.click(screen.getByRole('button', { name: 'Más' }))
    expect(screen.getByRole('heading', { name: 'Más' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Suscripciones' }))
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/subscriptions')

    await user.click(screen.getByRole('button', { name: 'Más' }))
    await user.click(screen.getByRole('button', { name: 'Reglas' }))
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/rules')
    expect(screen.queryByRole('heading', { name: 'Más' })).not.toBeInTheDocument()
  })

  it('closes the more sheet with Escape without changing routes', async () => {
    const user = userEvent.setup()
    renderNavigation('/accounts')

    await user.click(screen.getByRole('button', { name: 'Más' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('heading', { name: 'Más' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/accounts')
  })
})
