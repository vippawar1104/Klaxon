import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'

export interface NavItem {
  label: string
  description: string
  /** Scrolls to an id on the CURRENT page — only meaningful within a single
   * long page (e.g. the home page's own in-page sections). */
  href?: string
  /** Navigates to a real route — used for links to the standalone pages
   * (Platform, Solutions, Resources, Docs, Pricing). */
  to?: string
  onSelect?: () => void
}

export function NavDropdown({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-white/85 transition-colors hover:text-white"
      >
        {label}
        <ChevronDown
          size={13}
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-1/2 top-full z-30 w-[19rem] -translate-x-1/2 pt-3">
          <div className="rise overflow-hidden rounded-xl border border-landing-line bg-landing-card shadow-2xl shadow-black/50">
            {items.map((item, i) => (
              <button
                key={item.label}
                onClick={() => {
                  setOpen(false)
                  if (item.onSelect) item.onSelect()
                  else if (item.to) navigate(item.to)
                  else if (item.href) document.querySelector(item.href)?.scrollIntoView({ behavior: 'smooth' })
                }}
                className={`block w-full px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                  i > 0 ? 'border-t border-landing-line/60' : ''
                }`}
              >
                <span className="block text-[13.5px] font-semibold normal-case tracking-normal text-white">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[12.5px] normal-case tracking-normal text-landing-muted">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
