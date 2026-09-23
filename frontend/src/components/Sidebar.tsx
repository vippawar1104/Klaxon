import { useEffect, useState } from 'react'
import { Bell, ChevronDown, Clock, CreditCard, HelpCircle, LayoutGrid, ListFilter, LogOut, Moon, Plug, Sun } from 'lucide-react'
import { LogoMark, Wordmark } from './Logo'
import { api } from '../lib/api'
import { pickProjectId } from '../lib/pickProject'
import { useTheme } from '../lib/useTheme'
import type { Project } from '../lib/types'

export type PaneKey = 'issues' | 'alerts' | 'setup' | 'billing'

interface SidebarProps {
  activePane: PaneKey
  onPaneChange: (pane: PaneKey) => void
  projectId: number | null
  onProjectChange: (id: number) => void
  onExit: () => void
  email: string | null
  onSignOut: () => void
  // null on Pro or a comped account (no trial clock at all) — the pill below
  // only renders once there is an actual number to show.
  trialDaysLeft: number | null
}

const NAV: { key: PaneKey; label: string; icon: typeof ListFilter }[] = [
  { key: 'issues', label: 'Issues', icon: ListFilter },
  { key: 'alerts', label: 'Alerts', icon: Bell },
  { key: 'setup', label: 'Setup', icon: Plug },
  { key: 'billing', label: 'Billing', icon: CreditCard },
]

export function Sidebar({
  activePane,
  onPaneChange,
  projectId,
  onProjectChange,
  onExit,
  email,
  onSignOut,
  trialDaysLeft,
}: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const { theme, toggle: toggleTheme } = useTheme()

  useEffect(() => {
    api
      .projects()
      .then((list) => {
        setProjects(list)
        // Not just "when nothing is selected": a selection left over from a
        // previous account has to be replaced too. See pickProjectId.
        const wanted = pickProjectId(list, projectId)
        if (wanted !== null && wanted !== projectId) onProjectChange(wanted)
      })
      .catch(() => setProjects([]))
  }, [])

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border-subtle bg-bg-base">
      <button
        onClick={onExit}
        title="Back to site"
        className="flex items-center gap-2 px-4 py-5 text-text-primary transition-opacity hover:opacity-70"
      >
        <LogoMark size={22} />
        <Wordmark className="text-[16px]" />
      </button>

      <div className="px-3">
        {projects.length > 0 ? (
          <div className="relative">
            <LayoutGrid
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
            <select
              value={pickProjectId(projects, projectId) ?? projects[0].id}
              onChange={(e) => onProjectChange(Number(e.target.value))}
              className="w-full appearance-none truncate rounded-lg border border-border-subtle bg-bg-surface py-2 pl-8 pr-7 text-[13px] text-text-primary shadow-sm outline-none focus:border-text-tertiary"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
          </div>
        ) : (
          <div className="rounded-lg border border-border-subtle bg-bg-surface px-2.5 py-2 text-xs text-text-tertiary">
            No projects yet
          </div>
        )}
      </div>

      {trialDaysLeft !== null && (
        <button
          onClick={() => onPaneChange('billing')}
          className={`mx-3 mt-3 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12.5px] transition-colors ${
            trialDaysLeft <= 3
              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              : 'border-border-subtle bg-bg-surface text-text-secondary hover:bg-bg-raised'
          }`}
        >
          <Clock size={14} className="shrink-0" />
          <span>
            {trialDaysLeft === 0
              ? 'Trial ends today'
              : trialDaysLeft === 1
                ? '1 day left in trial'
                : `${trialDaysLeft} days left in trial`}
          </span>
        </button>
      )}

      <nav className="mt-3 space-y-0.5 px-3">
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onPaneChange(key)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] transition-colors ${
              activePane === key
                ? 'border border-border-subtle bg-bg-surface font-medium text-text-primary shadow-sm'
                : 'border border-transparent text-text-secondary hover:bg-bg-raised hover:text-text-primary'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-auto space-y-1 border-t border-border-subtle p-3">
        {email && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold uppercase text-white">
              {email[0]}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-secondary" title={email}>
              {email}
            </span>
          </div>
        )}
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <a
          href="https://github.com/vippawar1104/CodeOn"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary"
        >
          <HelpCircle size={15} />
          Docs
        </a>
        {email && (
          <button
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary"
          >
            <LogOut size={15} />
            Sign out
          </button>
        )}
      </div>
    </aside>
  )
}
