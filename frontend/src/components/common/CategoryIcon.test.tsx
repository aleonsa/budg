import type { SVGProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CategoryIcon } from './CategoryIcon'

vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: SVGProps<SVGSVGElement>) => (
    <svg aria-label={name} {...props} />
  )

  return {
    ShoppingCart: icon('Shopping cart'),
    UtensilsCrossed: icon('Utensils'),
    Car: icon('Car'),
    Home: icon('Home'),
    Film: icon('Film'),
    HeartPulse: icon('Health'),
    Briefcase: icon('Briefcase'),
    Plane: icon('Plane'),
    GraduationCap: icon('Education'),
    Gift: icon('Gift'),
    PiggyBank: icon('Savings'),
    Repeat: icon('Recurring'),
    HelpCircle: icon('Unknown category'),
  }
})

describe('CategoryIcon', () => {
  it('renders the selected category icon', () => {
    render(<CategoryIcon name="ShoppingCart" />)

    expect(screen.getByLabelText('Shopping cart')).toBeInTheDocument()
  })

  it('falls back to a help icon for an unknown icon name', () => {
    render(<CategoryIcon name="NotAnIcon" />)

    expect(screen.getByLabelText('Unknown category')).toBeInTheDocument()
  })
})
