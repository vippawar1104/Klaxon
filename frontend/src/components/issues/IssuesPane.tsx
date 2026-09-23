import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Check, RefreshCw, Search, Terminal } from 'lucide-react'
import { api } from '../../lib/api'
import { absoluteTime, compactNumber, relativeTime } from '../../lib/time'
import type { Issue } from '../../lib/types'
import { ErrorBanner } from '../shared/ErrorBanner'
import { CopyButton } from '../shared/CopyButton'
import { toErrorMessage } from '../../lib/errors'

type Filter = 'open' | 'resolved' | 'all'
type Sort = 'last_seen' | 'times_seen' | 'first_seen'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Unresolved' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
]

const SORTS: { key: Sort; label: string }[] = [
  { key: 'last_seen', label: 'Last seen' },
  { key: 'times_seen', label: 'Events' },
  { key: 'first_seen', label: 'First seen' },
]

function LevelDot({ level }: { level: string }) {
  const tone =
    level === 'warning'
      ? 'bg-severity-warning'
      : level === 'info'
        ? 'bg-text-tertiary'
        : 'bg-severity-error'
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
}

function StatusTag({ status }: { status: string }) {
  if (status === 'regressed') {
    return (
      <span className="rounded bg-severity-error/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-severity-error">
        Regressed
      </span>
    )
  }
  if (status === 'resolved') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-severity-success/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-severity-success">
        <Check size={10} /> Resolved
      </span>
    )
  }
  return null
}

function SkeletonRows() {
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`flex items-start gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-border-subtle' : ''}`}
        >
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-bg-raised" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-28 rounded bg-bg-raised" />
            <div className="h-2.5 w-3/5 rounded bg-bg-raised" />
          </div>
          <div className="h-3 w-10 rounded bg-bg-raised" />
        </div>
      ))}
      <span className="sr-only">Loading issues…</span>
    </div>
  )
}

/** Shown when a project has no events yet — the only question that matters here
 *  is "how do I get data in?", so the answer is a runnable command. */
function Onboarding({ projectId }: { projectId: number }) {
  // The command must carry THIS project's real key and THIS deployment's real
  // API address. It used to hardcode http://localhost:8000 and the demo key,
  // which only ever worked on the developer's own machine: anyone on a hosted
  // instance copied a command that pointed nowhere, with a key that isn't
  // theirs (a 403 at best). Both come from the project's DSN, which the API
  // builds from its real public origin.
  //   undefined = still loading, null = could not be determined
  const [target, setTarget] = useState<{ origin: string; key: string } | null | undefined>(
    undefined,
  )

  useEffect(() => {
    let cancelled = false
    api
      .projects()
      .then((list) => {
        if (cancelled) return
        const project = list.find((p) => p.id === projectId)
        try {
          setTarget(project ? { origin: new URL(project.dsn).origin, key: project.public_key } : null)
        } catch {
          setTarget(null)
        }
      })
      .catch(() => {
        if (!cancelled) setTarget(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // If it can't be worked out, show obvious placeholders rather than a
  // plausible-looking wrong address.
  const origin = target?.origin ?? '<your-klaxon-url>'
  const key = target?.key ?? '<your-project-key>'
  const curl = `curl -X POST ${origin}/api/${projectId}/store \\
  -H 'Content-Type: application/json' \\
  -H 'X-Klaxon-Key: ${key}' \\
  -d '{"event_id":"'$(uuidgen)'","type":"TypeError","value":"Cannot read property .total. of undefined","stacktrace":"TypeError: boom\\n    at renderCart (https://shop.example.com/assets/cart.js:42:18)"}'`

  return (
    <div className="rounded-xl border border-dashed border-border-subtle bg-bg-surface p-8">
      <div className="flex items-center gap-2">
        <Terminal size={17} className="text-text-tertiary" />
        <h2 className="text-[15px] font-semibold">Waiting for your first event</h2>
      </div>
      <p className="mt-2 max-w-lg text-[13.5px] leading-relaxed text-text-secondary">
        Send a crash to this project and it will appear here within a second. Paste this into a
        terminal, or install the SDK and throw an error in your app.
      </p>

      <div className="mt-5 overflow-hidden rounded-lg border border-border-subtle bg-bg-base">
        <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
          <span className="font-mono text-[11px] text-text-tertiary">bash</span>
          {/* Not offered until the real address and key are known — copying
              the placeholder version would defeat the point. */}
          {target !== undefined && <CopyButton value={curl} label="Copy" />}
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
          {target === undefined ? 'Loading…' : curl}
        </pre>
      </div>
    </div>
  )
}

interface Props {
  projectId: number
  onOpen: (id: number) => void
}

export function IssuesPane({ projectId, onOpen }: Props) {
  const [all, setAll] = useState<Issue[] | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [sort, setSort] = useState<Sort>('last_seen')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState(0)

  const searchRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch everything once so filter/sort/search stay instant and local.
      setAll(await api.issues(projectId, 'all'))
    } catch (e) {
      setError(toErrorMessage(e, 'Failed to load issues.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [projectId])

  const counts = useMemo(() => {
    const list = all ?? []
    return {
      open: list.filter((i) => i.status === 'unresolved' || i.status === 'regressed').length,
      resolved: list.filter((i) => i.status === 'resolved').length,
      all: list.length,
    }
  }, [all])

  const issues = useMemo(() => {
    let list = all ?? []
    if (filter === 'open') {
      list = list.filter((i) => i.status === 'unresolved' || i.status === 'regressed')
    } else if (filter === 'resolved') {
      list = list.filter((i) => i.status === 'resolved')
    }

    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((i) =>
        `${i.type} ${i.value} ${i.culprit}`.toLowerCase().includes(q)
      )
    }

    return [...list].sort((a, b) =>
      sort === 'times_seen'
        ? b.times_seen - a.times_seen
        : new Date(b[sort]).getTime() - new Date(a[sort]).getTime()
    )
  }, [all, filter, query, sort])

  useEffect(() => {
    setCursor(0)
  }, [filter, query, sort])

  // Dev-tool keyboard conventions: j/k move, Enter opens, / focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement

      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (typing) {
        if (e.key === 'Escape') searchRef.current?.blur()
        return
      }
      if (issues.length === 0) return

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(issues.length - 1, c + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onOpen(issues[cursor].id)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [issues, cursor, onOpen])

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const isEmptyProject = !loading && !error && (all?.length ?? 0) === 0

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-5 overflow-y-auto p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Issues</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Crashes grouped by fingerprint — one row per distinct bug.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {isEmptyProject ? (
        <Onboarding projectId={projectId} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                    filter === f.key
                      ? 'bg-bg-surface font-medium text-text-primary shadow-sm ring-1 ring-border-subtle'
                      : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary'
                  }`}
                >
                  {f.label}
                  <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
                    {counts[f.key]}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative min-w-[12rem] flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search type, message or file…"
                aria-label="Search issues"
                className="w-full rounded-lg border border-border-subtle bg-bg-surface py-1.5 pl-8 pr-12 text-[13px] outline-none placeholder:text-text-tertiary focus:border-text-tertiary"
              />
              {!query && (
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
                  /
                </kbd>
              )}
            </div>

            <div className="relative">
              <ArrowUpDown
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                aria-label="Sort issues"
                className="appearance-none rounded-lg border border-border-subtle bg-bg-surface py-1.5 pl-8 pr-3 text-[13px] outline-none focus:border-text-tertiary"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading && all === null ? (
            <SkeletonRows />
          ) : issues.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle bg-bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium">No matching issues</p>
              <p className="mt-1 text-[13px] text-text-secondary">
                {query ? (
                  <>
                    Nothing matches “{query}”.{' '}
                    <button onClick={() => setQuery('')} className="underline">
                      Clear search
                    </button>
                  </>
                ) : (
                  'Nothing in this view yet.'
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
                {issues.map((issue, i) => (
                  <button
                    key={issue.id}
                    ref={(el) => {
                      rowRefs.current[i] = el
                    }}
                    onClick={() => onOpen(issue.id)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors ${
                      i > 0 ? 'border-t border-border-subtle' : ''
                    } ${cursor === i ? 'bg-bg-raised' : 'hover:bg-bg-raised'}`}
                  >
                    <LevelDot level={issue.level} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{issue.type}</span>
                        <StatusTag status={issue.status} />
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-text-secondary">
                        {issue.value}
                      </p>
                      <p className="mt-1 truncate font-mono text-[11.5px] text-text-tertiary">
                        {issue.culprit}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <div
                        className="font-mono text-[15px] font-medium tabular-nums"
                        title={`${issue.times_seen.toLocaleString()} events`}
                      >
                        {compactNumber(issue.times_seen)}
                      </div>
                      <div
                        className="mt-0.5 text-[11.5px] text-text-tertiary"
                        title={absoluteTime(issue.last_seen)}
                      >
                        {relativeTime(issue.last_seen)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <p className="text-[12px] text-text-tertiary">
                Showing {issues.length} of {counts.all} ·{' '}
                <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> to move,{' '}
                <kbd className="font-mono">enter</kbd> to open,{' '}
                <kbd className="font-mono">/</kbd> to search
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
