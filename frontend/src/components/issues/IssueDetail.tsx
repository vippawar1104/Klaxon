import { useEffect, useState } from 'react'
import { ArrowLeft, Check, EyeOff, RotateCcw, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'
import { absoluteTime, compactNumber, relativeTime } from '../../lib/time'
import type { AiSeverity, IssueDetail as Detail, IssueStatus, Triage } from '../../lib/types'
import { CodeBlock } from '../shared/CodeBlock'
import { ErrorBanner } from '../shared/ErrorBanner'
import { CopyButton } from '../shared/CopyButton'
import { Toast, useToast } from '../shared/Toast'
import { toErrorMessage } from '../../lib/errors'

const SEVERITY_STYLE: Record<AiSeverity, string> = {
  low: 'bg-bg-raised text-text-secondary',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
}

function Meta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="mt-1 font-mono text-[13px] tabular-nums" title={title}>
        {value}
      </dd>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function IssueDetail({ issueId, onBack }: { issueId: number; onBack: () => void }) {
  const [issue, setIssue] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Kept together: an explanation is only meaningful alongside the model that
  // produced it, so they are set and cleared as one value.
  const [analysis, setAnalysis] = useState<Triage | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)
  const { toast, show, dismiss } = useToast()

  const explain = async (refresh = false) => {
    setExplaining(true)
    setExplainError(null)
    try {
      setAnalysis(await api.explain(issueId, refresh))
    } catch (e) {
      // A 503 here means the optional model is unavailable, not that anything
      // broke. Show the server's reason — "no key set", "key rejected" and
      // "valid but throttled" need completely different fixes.
      setExplainError(toErrorMessage(e, 'Could not reach the AI provider.'))
    } finally {
      setExplaining(false)
    }
  }

  useEffect(() => {
    setError(null)
    api
      .issue(issueId)
      .then((i) => {
        setIssue(i)
        // A verdict saved earlier shows immediately, with no model call.
        setAnalysis(i.triage)
      })
      .catch((e) => setError(toErrorMessage(e, 'Failed to load issue.')))
  }, [issueId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBack])

  const update = async (status: IssueStatus, { silent = false } = {}) => {
    const previous = issue?.status as IssueStatus | undefined
    setBusy(true)
    try {
      await api.setStatus(issueId, status)
      setIssue(await api.issue(issueId))
      if (!silent) {
        show({
          message: status === 'resolved' ? 'Issue resolved' : `Issue ${status}`,
          onUndo: previous ? () => update(previous, { silent: true }) : undefined,
        })
      }
    } catch (e) {
      setError(toErrorMessage(e, 'Failed to update status.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-5 overflow-y-auto p-8">
      <button
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary"
      >
        <ArrowLeft size={13} /> All issues
        <kbd className="ml-1 rounded border border-border-subtle px-1 font-mono text-[10px]">esc</kbd>
      </button>

      {error && <ErrorBanner message={error} />}

      {issue && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">{issue.type}</h1>
              <p className="mt-1 text-[15px] text-text-secondary">{issue.value}</p>
              <div className="mt-1.5 flex items-center gap-1">
                <span className="font-mono text-[12.5px] text-text-tertiary">{issue.culprit}</span>
                <CopyButton value={issue.culprit} label="" />
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              {issue.status === 'resolved' ? (
                <button
                  onClick={() => update('unresolved')}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] font-medium transition-colors hover:bg-bg-raised disabled:opacity-50"
                >
                  <RotateCcw size={14} /> Reopen
                </button>
              ) : (
                <button
                  onClick={() => update('resolved')}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  <Check size={14} /> Resolve
                </button>
              )}
              <button
                onClick={() => update('ignored')}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] font-medium transition-colors hover:bg-bg-raised disabled:opacity-50"
              >
                <EyeOff size={14} /> Ignore
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border-subtle bg-bg-surface p-5 sm:grid-cols-4">
            <Meta
              label="Events"
              value={compactNumber(issue.times_seen)}
              title={`${issue.times_seen.toLocaleString()} events`}
            />
            <Meta label="Status" value={issue.status} />
            <Meta
              label="First seen"
              value={relativeTime(issue.first_seen)}
              title={absoluteTime(issue.first_seen)}
            />
            <Meta
              label="Last seen"
              value={relativeTime(issue.last_seen)}
              title={absoluteTime(issue.last_seen)}
            />
          </dl>

          {issue.latest_event?.stacktrace && (
            <Section
              title="Stack trace"
              action={
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => explain(analysis !== null)}
                    disabled={explaining}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary disabled:opacity-50"
                  >
                    <Sparkles size={13} />
                    {explaining ? 'Analysing…' : analysis ? 'Re-analyse' : 'Explain'}
                  </button>
                  <CopyButton value={issue.latest_event.stacktrace} label="Copy" />
                </div>
              }
            >
              <CodeBlock code={issue.latest_event.stacktrace} language="javascript" />
              {explainError && (
                <p className="mt-2 text-[12.5px] text-text-tertiary">{explainError}</p>
              )}
              {analysis && (
                <div className="mt-3 rounded-lg border border-border-subtle bg-bg-surface p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${SEVERITY_STYLE[analysis.severity]}`}
                    >
                      {analysis.severity}
                    </span>
                    <span className="text-[11.5px] text-text-tertiary">
                      {Math.round(analysis.confidence * 100)}% confidence
                    </span>
                    {analysis.model && (
                      <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-text-tertiary">
                        <Sparkles size={11} /> {analysis.model}
                      </span>
                    )}
                  </div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Likely cause
                  </h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-text-primary">
                    {analysis.root_cause}
                  </p>
                  <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Suggested fix
                  </h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-text-primary">
                    {analysis.suggested_fix}
                  </p>
                  <p className="mt-3 border-t border-border-subtle pt-2 text-[11px] text-text-tertiary">
                    Generated from the stack trace and breadcrumbs above. Verify before acting.
                  </p>
                </div>
              )}
            </Section>
          )}

          {issue.latest_event && issue.latest_event.breadcrumbs.length > 0 && (
            <Section title={`Breadcrumbs (${issue.latest_event.breadcrumbs.length})`}>
              <ol className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
                {issue.latest_event.breadcrumbs.map((b, i) => (
                  <li
                    key={i}
                    className={`flex gap-3 px-4 py-2 font-mono text-[12.5px] ${
                      i > 0 ? 'border-t border-border-subtle' : ''
                    }`}
                  >
                    <span className="w-20 shrink-0 text-text-tertiary">
                      {b.category ?? b.level}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{b.message}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {issue.latest_event && Object.keys(issue.latest_event.tags).length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-2">
                {Object.entries(issue.latest_event.tags).map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded-md border border-border-subtle bg-bg-surface px-2 py-1 font-mono text-[12px]"
                  >
                    <span className="text-text-tertiary">{k}</span>
                    <span className="text-text-tertiary"> · </span>
                    {v}
                  </span>
                ))}
                {issue.latest_event.release && (
                  <span className="rounded-md border border-border-subtle bg-bg-surface px-2 py-1 font-mono text-[12px]">
                    <span className="text-text-tertiary">release · </span>
                    {issue.latest_event.release}
                  </span>
                )}
                <span className="rounded-md border border-border-subtle bg-bg-surface px-2 py-1 font-mono text-[12px]">
                  <span className="text-text-tertiary">env · </span>
                  {issue.latest_event.environment}
                </span>
              </div>
            </Section>
          )}

          <Section title="Fingerprint" action={<CopyButton value={issue.fingerprint} label="Copy" />}>
            <p className="font-mono text-[13px] text-text-secondary">
              {issue.fingerprint}
              <span className="ml-2 font-sans text-text-tertiary">
                — the group key all {compactNumber(issue.times_seen)} events hashed to
              </span>
            </p>
          </Section>
        </>
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  )
}
