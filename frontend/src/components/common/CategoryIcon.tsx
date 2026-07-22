import { cn } from '@/lib/utils'
import { accentClasses } from '@/lib/colors'
import type { AccentColor } from '@/types'

import {
  ShoppingCart,
  ShoppingBag,
  Tag,
  House,
  Utensils,
  UtensilsCrossed,
  Coffee,
  Car,
  Fuel,
  Home,
  Film,
  HeartPulse,
  Briefcase,
  Plane,
  GraduationCap,
  Gift,
  PiggyBank,
  Repeat,
  Zap,
  Wifi,
  Shirt,
  PawPrint,
  Sparkles,
  Shield,
  CreditCard,
  Wallet,
  Dumbbell,
  Smartphone,
  Wrench,
  Baby,
  TrendingUp,
  RotateCcw,
  Award,
  HelpCircle,
} from 'lucide-react'

const ICONS: Record<string, typeof ShoppingCart> = {
  ShoppingCart,
  ShoppingBag,
  Tag,
  House,
  Utensils,
  UtensilsCrossed,
  Coffee,
  Car,
  Fuel,
  Home,
  Film,
  HeartPulse,
  Briefcase,
  Plane,
  GraduationCap,
  Gift,
  PiggyBank,
  Repeat,
  Zap,
  Wifi,
  Shirt,
  PawPrint,
  Sparkles,
  Shield,
  CreditCard,
  Wallet,
  Dumbbell,
  Smartphone,
  Wrench,
  Baby,
  TrendingUp,
  RotateCcw,
  Award,
}

interface CategoryIconProps {
  name: string
  color?: AccentColor
  className?: string
}

/**
 * Renders a category icon inside a colored soft circle.
 * The color matches the category's accent color.
 */
export function CategoryIcon({ name, color = 'gray', className }: CategoryIconProps) {
  const Icon = ICONS[name] ?? HelpCircle
  const c = accentClasses(color)

  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        c.bg,
        className,
      )}
    >
      <Icon className={cn('h-4 w-4', c.text)} />
    </div>
  )
}
