import { PlusIcon } from '@phosphor-icons/react'
import { BrowserRouter, Link, NavLink, Route, Routes, useMatch } from 'react-router-dom'
import { AppHeader } from './components/AppHeader'
import { useTheme } from './hooks/useTheme'
import { PlannerPage } from './pages/PlannerPage'
import { TripPage } from './pages/TripPage'

function TripNav() {
  const match = useMatch('/trips/:id/*')
  if (!match) return <span />
  const id = match.params.id
  const tab = ({ isActive }: { isActive: boolean }) =>
    `inline-flex h-9 items-center rounded-full px-4 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 ${
      isActive ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]' : 'text-body hover:text-ink'
    }`
  return (
    <nav aria-label="Trip views" className="flex items-center gap-1 rounded-full bg-soft p-1">
      <NavLink to={`/trips/${id}`} end className={tab}>
        Route
      </NavLink>
      <NavLink to={`/trips/${id}/logs`} className={tab}>
        Daily Logs
      </NavLink>
    </nav>
  )
}

function Shell() {
  const { theme, toggle } = useTheme()
  const onTrip = useMatch('/trips/:id/*')
  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <a href="#main" className="sr-only rounded-full bg-ink px-4 py-2 text-canvas focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      <AppHeader compact={Boolean(onTrip)} theme={theme} onToggleTheme={toggle}>
        <TripNav />
        {onTrip && (
          <Link to="/" className="btn btn-ghost hidden h-9 px-3 text-[14px] sm:inline-flex">
            <PlusIcon size={16} weight="bold" aria-hidden />
            New Trip
          </Link>
        )}
      </AppHeader>
      <Routes>
        <Route path="/" element={<PlannerPage theme={theme} />} />
        <Route path="/trips/:id" element={<TripPage theme={theme} view="route" />} />
        <Route path="/trips/:id/logs" element={<TripPage theme={theme} view="logs" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  )
}

function NotFound() {
  return (
    <main id="main" className="mx-auto flex max-w-lg flex-col items-start gap-4 px-4 py-20 sm:px-6">
      <h1 className="text-[28px] leading-9 font-bold tracking-[-0.02em]">Page not found</h1>
      <p className="text-[16px] text-body">This address does not exist. Start a new trip plan instead.</p>
      <Link to="/" className="btn btn-primary">
        Plan a Trip
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}
