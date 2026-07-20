import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Header, PageSection, SectionTitle } from './Header'

vi.mock('./MobileUserMenu', () => ({
  MobileUserMenu: () => <button>Mobile account</button>,
}))

describe('Header', () => {
  it('shows page context, action, and account access by default', () => {
    render(
      <Header title="Movimientos" subtitle="Julio de 2026" action={<button>Agregar</button>} />,
    )

    expect(screen.getByRole('heading', { name: 'Movimientos' })).toBeInTheDocument()
    expect(screen.getByText('Julio de 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mobile account' })).toBeInTheDocument()
  })

  it('can omit optional subtitle and account access', () => {
    render(<Header title="Acceso" showSettings={false} />)

    expect(screen.getByRole('heading', { name: 'Acceso' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mobile account' })).not.toBeInTheDocument()
  })
})

describe('page section helpers', () => {
  it('groups a titled section and its visible content', () => {
    render(
      <PageSection>
        <SectionTitle>Próximos pagos</SectionTitle>
        <p>Tarjeta: 20 de julio</p>
      </PageSection>,
    )

    expect(screen.getByRole('heading', { name: 'Próximos pagos' })).toBeInTheDocument()
    expect(screen.getByText('Tarjeta: 20 de julio')).toBeInTheDocument()
  })
})
