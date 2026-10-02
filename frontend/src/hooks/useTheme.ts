import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'milepost-theme'

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function subscribeSystem(callback: () => void) {
  media?.addEventListener('change', callback)
  return () => media?.removeEventListener('change', callback)
}

export function useTheme() {
  const system = useSyncExternalStore(subscribeSystem, () => (media?.matches ? 'dark' : 'light'), () => 'light' as Theme)
  const [stored, setStored] = useState<Theme | null>(readStored)
  const theme: Theme = stored ?? (system as Theme)

  useEffect(() => {
    const root = document.documentElement
    if (stored) root.dataset.theme = stored
    else delete root.dataset.theme
    const color = getComputedStyle(root).getPropertyValue('--canvas').trim()
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color))
  }, [stored, system])

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setStored(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* storage unavailable: theme still applies for this visit */
    }
  }, [theme])

  return { theme, toggle }
}
