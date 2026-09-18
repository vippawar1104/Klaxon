import { useEffect, useState } from 'react'
import { Bell, BellOff, RefreshCw, ShieldCheck, TrendingUp, Undo2 } from 'lucide-react'
import { api } from '../../lib/api'
import { absoluteTime, compactNumber, relativeTime } from '../../lib/time'
import type { Alert, AlertKind, AlertRule } from '../../lib/types'
import { ErrorBanner } from '../shared/ErrorBanner'
import { toErrorMessage } from '../../lib/errors'

const KIND_META: Record<AlertKind, { label: string; blurb: string; icon: typeof Bell }> = {
  new_issue: {
    label: 'New issue',
    blurb: 'A bug nobody has seen before',
    icon: Bell,
  },
  regression: {
    label: 'Regression',
    blurb: 'A resolved issue that came back',
    icon: Undo2,
  },
  volume: {
    label: 'Volume threshold',
    blurb: 'More than N events in a rolling window',
    icon: TrendingUp,
  },
}

function formatCooldown(seconds: number): string {
  if (seconds === 0) return 'none'
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

export function AlertsPane({ projectId }: { projectId: number }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [rules, setRules] = useState<AlertRule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [a, r] = await Promise.all([api.alerts(projectId), api.alertRules(projectId)])
      setAlerts(a)
      setRules(r)
    } catch (e) {
      setError(toErrorMessage(e, 'Failed to load alerts.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [projectId])

  const toggle = async (rule: AlertRule) => {
    // Optimistic: the switch should feel instant, and a failure reloads truth.
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)))
    try {
      await api.toggleRule(rule.id)
    } catch (e) {
      setError(toErrorMessage(e, 'Failed to update rule.'))
      load()
    }
  }

  const suppressed = (alerts ?? []).reduce(
    (total, a) => total + Math.max(0, a.times_seen_at_fire - 1),
    0
  )

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-y-auto p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Alerts</h1>
          <p className="mt-1 text-sm text-text-secondary">
            One notification per issue per cooldown, however many events arrive.
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

      {alerts !== null && alerts.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-5 py-4">
          <ShieldCheck size={18} className="shrink-0 text-severity-success" />
          <p className="text-[13.5px] text-text-secondary">
            <span className="font-mono font-medium text-text-primary">{alerts.length}</span> alert
            {alerts.length === 1 ? '' : 's'} sent · roughly{' '}
            <span className="font-mono font-medium text-text-primary">
              {compactNumber(suppressed)}
            </span>{' '}
            further events absorbed by cooldown instead of paging you.
          </p>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-text-tertiary">
          Rules
        </h2>
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
          {rules.length === 0 && !loading && (
            <p className="px-4 py-5 text-[13px] text-text-secondary">
              No rules for this project yet.
            </p>
          )}
          {rules.map((rule, i) => {
            const meta = KIND_META[rule.kind]
            const Icon = meta?.icon ?? Bell
            return (
              <div
                key={rule.id}
                className={`flex items-center gap-3 px-4 py-3.5 ${
                  i > 0 ? 'border-t border-border-subtle' : ''
                }`}
              >
                <Icon
                  size={16}
                  className={rule.enabled ? 'text-text-primary' : 'text-text-tertiary'}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] font-medium ${rule.enabled ? '' : 'text-text-tertiary'}`}>
                    {meta?.label ?? rule.kind}
                    {rule.kind === 'volume' && (
                      <span className="ml-1.5 font-mono text-[12px] text-text-secondary">
                        ≥ {rule.threshold.toLocaleString()} / {formatCooldown(rule.window_s)}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-text-secondary">{meta?.blurb}</p>
                </div>
                <span className="hidden font-mono text-[11.5px] text-text-tertiary sm:block">
                  cooldown {formatCooldown(rule.cooldown_s)} · {rule.channel}
                </span>
                <button
                  onClick={() => toggle(rule)}
                  aria-pressed={rule.enabled}
                  aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${meta?.label ?? rule.kind}`}
                  className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                    rule.enabled ? 'bg-accent' : 'bg-bg-raised'
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      rule.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-text-tertiary">
          Sent
        </h2>
        {alerts !== null && alerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-subtle bg-bg-surface px-6 py-12 text-center">
            <BellOff size={20} className="mx-auto text-text-tertiary" />
            <p className="mt-3 text-sm font-medium">Nothing has fired yet</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Alerts appear here the moment a rule matches an incoming event.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
            {(alerts ?? []).map((alert, i) => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 px-4 py-3.5 ${
                  i > 0 ? 'border-t border-border-subtle' : ''
                }`}
              >
                <Bell size={15} className="mt-0.5 shrink-0 text-severity-warning" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">
                    {alert.issue_type ?? 'Issue'}{' '}
                    <span className="font-mono text-[12px] text-text-tertiary">
                      {alert.issue_culprit}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-text-secondary">{alert.reason}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-[12px] tabular-nums text-text-secondary">
                    {compactNumber(alert.times_seen_at_fire)} events
                  </p>
                  <p
                    className="mt-0.5 text-[11.5px] text-text-tertiary"
                    title={absoluteTime(alert.created_at)}
                  >
                    {relativeTime(alert.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
