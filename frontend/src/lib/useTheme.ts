import { useEffect, useState } from 'react'

const KEY = 'klaxon.theme'

function apply(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

function initial(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* private mode / blocked storage — fall through to system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Dashboard-only dark mode. The marketing pages have their own separate,
 * always-dark palette (`landing-theme`) — this hook and this toggle only
 * ever touch the authenticated app. */
export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(initial)

  useEffect(() => {
    apply(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* per-viewer convenience only — losing it just means it resets next visit */
    }
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return { theme, toggle }
}
