import { useEffect } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { LogoMark, Wordmark } from '../Logo'
import { useMarketingNav } from '../../lib/useMarketingNav'

const PAGES = [
  { to: '/platform', label: 'Platform' },
  { to: '/solutions', label: 'Solutions' },
  { to: '/resources', label: 'Resources' },
  { to: '/docs', label: 'Docs' },
  { to: '/pricing', label: 'Pricing' },
]

/**
 * Header and footer shared by the five standalone marketing pages. The home
 * page ("/") keeps its own richer, animated header — this one is deliberately
 * plainer since these pages are the destination, not the hero.
 */
export function MarketingHeader() {
  const { goSignup, goSignin, goDemo } = useMarketingNav()

  return (
    <header className="sticky top-0 z-40 border-b border-landing-line/40 bg-landing-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <LogoMark size={22} />
          <Wordmark className="text-[17px]" />
        </Link>

        <nav className="hidden flex-1 items-center gap-6 text-[13px] font-medium uppercase tracking-wide lg:flex">
          {PAGES.map((p) => (
            <NavLink
              key={p.to}
              to={p.to}
              className={({ isActive }) =>
                isActive ? 'text-landing-pink' : 'text-white/85 transition-colors hover:text-white'
              }
            >
              {p.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={goSignin}
            className="hidden text-[13px] font-medium uppercase tracking-wide text-white/85 transition-colors hover:text-white sm:block"
          >
            Sign in
          </button>
          <button
            onClick={goDemo}
            className="rounded border border-landing-pink px-3.5 py-2 text-[13px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
          >
            Get demo
          </button>
          <button
            onClick={goSignup}
            className="rounded bg-white px-3.5 py-2 text-[13px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
          >
            Get started
          </button>
        </div>
      </div>
    </header>
  )
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-landing-line/40 px-5 py-8 sm:px-8">
      <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-3 sm:flex-row">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark size={18} />
          <Wordmark className="text-[14px]" />
        </Link>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-landing-muted">
          {PAGES.map((p) => (
            <Link key={p.to} to={p.to} className="transition-colors hover:text-white">
              {p.label}
            </Link>
          ))}
          <Link to="/feedback" className="transition-colors hover:text-white">
            Report a bug
          </Link>
        </nav>
        <p className="text-[13px] text-landing-muted">A thousand crashes, one alert.</p>
      </div>
    </footer>
  )
}

/** Standard page shell: dark theme, header, content slot, footer. */
export function MarketingPage({ children }: { children: React.ReactNode }) {
  // Paint the document itself dark while this page is mounted, so an
  // overscroll bounce doesn't reveal the dashboard's light background —
  // matches what the home page does for the same reason.
  useEffect(() => {
    document.documentElement.classList.add('landing-theme')
    window.scrollTo(0, 0)
    return () => document.documentElement.classList.remove('landing-theme')
  }, [])

  return (
    <div className="min-h-screen overflow-y-auto bg-landing-bg font-sans text-landing-ink">
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  )
}
