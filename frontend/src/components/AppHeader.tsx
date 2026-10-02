import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  compact?: boolean
  children?: ReactNode
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`text-[17px] font-bold tracking-[-0.01em] whitespace-nowrap ${compact ? 'max-sm:sr-only' : ''}`}>
        HOS Trip Planner
      </span>
      <span className="rounded-full bg-soft px-2 py-0.5 text-[12px] font-medium text-body">Demo</span>
    </span>
  )
}

export function AppHeader({ compact, children }: Props) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/75">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="-ml-1 rounded-full px-1 py-1" aria-label="HOS Trip Planner demo, home">
          <Logo compact={compact} />
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:justify-between sm:pl-6">{children}</div>
      </div>
    </header>
  )
}
