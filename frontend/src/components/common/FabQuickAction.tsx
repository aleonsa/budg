import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useQuickActionStore } from '@/stores/quickAction'
import { QuickActionModal } from './QuickActionModal'

export function FabQuickAction() {
  const openQuickAction = useQuickActionStore((s) => s.openQuickAction)

  return (
    <>
      <button
        type="button"
        onClick={() => openQuickAction('movement')}
        aria-label="Nuevo movimiento"
        title="Nuevo movimiento"
        className={cn(
          'hidden sm:flex fixed bottom-6 left-[calc(var(--sidebar-width,14rem)+1.5rem)] z-50',
          'h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg',
          'transition-transform hover:scale-105 active:scale-90',
        )}
      >
        <Plus className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.2} />
      </button>

      <QuickActionModal />
    </>
  )
}
