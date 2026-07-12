import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

/**
 * AppShell — the persistent layout wrapping all routes.
 *
 * Desktop (sm+): fixed sidebar on left, content with left margin.
 * Mobile: content full-width, fixed bottom nav.
 */
export function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />

      {/* Main content area */}
      <div className="sm:pl-[var(--sidebar-width)]">
        <main className="mx-auto min-h-screen w-full max-w-5xl px-4 pb-20 pt-0 sm:px-6 sm:pb-8">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
