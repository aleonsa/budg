import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useViewContext } from './useViewContext'

function ViewContextProbe() {
  return <div>{JSON.stringify(useViewContext())}</div>
}

describe('useViewContext', () => {
  afterEach(() => vi.useRealTimers())

  it('includes the user local date in agent context', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 14, 23, 30))

    render(
      <MemoryRouter initialEntries={['/stats']}>
        <ViewContextProbe />
      </MemoryRouter>,
    )

    expect(screen.getByText(/"currentDate":"2026-08-14"/)).toBeInTheDocument()
  })
})
