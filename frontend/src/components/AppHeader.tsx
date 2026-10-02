import { MoonIcon, SunIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  compact?: boolean
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  children?: ReactNode
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" translate="no">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--ink)" />
        <rect x="15" y="15" width="2.5" height="11" fill="var(--canvas)" />
        <rect x="9" y="6" width="14.5" height="11" rx="2" fill="var(--accent)" />
        <rect x="12" y="9.5" width="8.5" height="1.6" rx="0.8" fill="#fefefd" />
        <rect x="12" y="12.4" width="5.5" height="1.6" rx="0.8" fill="#fefefd" />
      </svg>
      <span className={`text-[19px] font-bold tracking-[-0.02em] ${compact ? 'max-sm:sr-only' : ''}`}>Milepost</span>
    </span>
  )
}

export function AppHeader({ compact, theme, onToggleTheme, children }: Props) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/75">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="-ml-1 rounded-full px-1 py-1" aria-label="Milepost home">
          <Logo compact={compact} />
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:justify-between sm:pl-6">{children}</div>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <SunIcon size={20} weight="bold" aria-hidden /> : <MoonIcon size={20} weight="bold" aria-hidden />}
        </button>
      </div>
    </header>
  )
}
