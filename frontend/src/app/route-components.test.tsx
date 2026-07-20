import { lazy } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RouteSuspense } from './route-components'

const NeverResolvingPage = lazy(
  () => new Promise<{ default: () => React.ReactNode }>(() => undefined),
)

describe('RouteSuspense', () => {
  it('shows a loading message while a route is pending', () => {
    render(
      <RouteSuspense>
        <NeverResolvingPage />
      </RouteSuspense>,
    )

    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('shows ready route content without the loading message', () => {
    render(
      <RouteSuspense>
        <p>Ready route</p>
      </RouteSuspense>,
    )

    expect(screen.getByText('Ready route')).toBeInTheDocument()
    expect(screen.queryByText('Cargando…')).not.toBeInTheDocument()
  })
})
