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
    ShoppingBag: icon('Shopping bag'),
    UtensilsCrossed: icon('Utensils'),
    Coffee: icon('Coffee'),
    Car: icon('Car'),
    Fuel: icon('Fuel'),
    Home: icon('Home'),
    Film: icon('Film'),
    HeartPulse: icon('Health'),
    Briefcase: icon('Briefcase'),
    Plane: icon('Plane'),
    GraduationCap: icon('Education'),
    Gift: icon('Gift'),
    PiggyBank: icon('Savings'),
    Repeat: icon('Recurring'),
    Zap: icon('Utilities'),
    Wifi: icon('Internet'),
    Shirt: icon('Clothing'),
    PawPrint: icon('Pets'),
    Sparkles: icon('Personal care'),
    Shield: icon('Insurance'),
    CreditCard: icon('Debt'),
    Wallet: icon('Wallet'),
    Dumbbell: icon('Fitness'),
    Smartphone: icon('Tech'),
    Wrench: icon('Maintenance'),
    Baby: icon('Kids'),
    TrendingUp: icon('Investments'),
    RotateCcw: icon('Refunds'),
    Award: icon('Bonuses'),
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

  // Regression coverage: PawPrint and Sparkles were valid lucide-react names
  // that were missing from ICONS, silently falling back to HelpCircle in
  // production. Every name added to ICONS should have a test asserting it
  // actually resolves, not just that the fallback works.
  it.each([
    ['PawPrint', 'Pets'],
    ['Sparkles', 'Personal care'],
    ['ShoppingBag', 'Shopping bag'],
    ['Coffee', 'Coffee'],
    ['Fuel', 'Fuel'],
    ['Zap', 'Utilities'],
    ['Wifi', 'Internet'],
    ['Shirt', 'Clothing'],
    ['Shield', 'Insurance'],
    ['CreditCard', 'Debt'],
    ['Wallet', 'Wallet'],
    ['Dumbbell', 'Fitness'],
    ['Smartphone', 'Tech'],
    ['Wrench', 'Maintenance'],
    ['Baby', 'Kids'],
    ['TrendingUp', 'Investments'],
    ['RotateCcw', 'Refunds'],
    ['Award', 'Bonuses'],
  ])('resolves icon name %s', (name, label) => {
    render(<CategoryIcon name={name} />)

    expect(screen.getByLabelText(label)).toBeInTheDocument()
  })
})
