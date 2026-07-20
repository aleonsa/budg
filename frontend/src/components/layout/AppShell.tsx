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
        <main className="mx-auto min-h-screen w-full max-w-[1440px] px-3 pb-20 sm:px-5 sm:pb-6 lg:px-6">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
