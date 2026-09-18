import { useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { api } from '../../lib/api'
import { daysLeft } from '../../lib/trial'

interface Status {
  plan: 'free' | 'pro'
  trial_ends_at: string | null
}

export function BillingPane() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .billingStatus()
      .then((s) => setStatus(s))
      .catch(() => setStatus({ plan: 'free', trial_ends_at: null }))
  }, [])

  const upgrade = async () => {
    setBusy(true)
    setError('')
    try {
      const { url } = await api.createCheckoutSession(
        `${window.location.origin}/`,
        `${window.location.origin}/`,
      )
      window.location.href = url
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Could not start checkout.')
    }
  }

  const manage = async () => {
    setBusy(true)
    setError('')
    try {
      const { url } = await api.createPortalSession(`${window.location.origin}/`)
      window.location.href = url
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Could not open the billing portal.')
    }
  }

  const plan = status?.plan ?? null
  const days = status ? daysLeft(status.trial_ends_at) : null

  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      <h1 className="flex items-center gap-2.5 text-[20px] font-bold text-text-primary">
        <CreditCard size={20} /> Billing
      </h1>

      {plan === null ? (
        <p className="mt-6 text-[13.5px] text-text-secondary">Loading…</p>
      ) : (
        <div className="mt-6 rounded-xl border border-border-subtle bg-bg-surface p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] uppercase tracking-wide text-text-tertiary">
                Current plan
              </p>
              <p className="mt-1 text-[22px] font-bold capitalize text-text-primary">{plan}</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[12px] font-semibold uppercase ${
                plan === 'pro'
                  ? 'bg-accent/10 text-accent'
                  : days !== null && days <= 3
                    ? 'bg-red-50 text-red-600'
                    : 'bg-bg-raised text-text-secondary'
              }`}
            >
              {plan === 'pro' ? 'Active' : 'Free tier'}
            </span>
          </div>

          {plan === 'free' && days !== null && (
            <p
              className={`mt-4 text-[13.5px] font-medium ${
                days <= 3 ? 'text-red-600' : 'text-text-secondary'
              }`}
            >
              {days === 0
                ? 'Your trial ends today.'
                : days === 1
                  ? '1 day left in your free trial.'
                  : `${days} days left in your free trial.`}
            </p>
          )}
          {plan === 'free' && days === null && (
            <p className="mt-4 text-[13.5px] text-text-secondary">
              No trial limit on this account.
            </p>
          )}

          {error && <p className="mt-4 text-[13px] text-red-600">{error}</p>}

          <div className="mt-5">
            {plan === 'free' ? (
              <button
                onClick={upgrade}
                disabled={busy}
                className="rounded-lg bg-accent px-4 py-2.5 text-[13.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? 'Redirecting…' : 'Upgrade to Pro — $19/mo'}
              </button>
            ) : (
              <button
                onClick={manage}
                disabled={busy}
                className="rounded-lg border border-border-subtle bg-bg-surface px-4 py-2.5 text-[13.5px] font-medium text-text-primary transition-colors hover:bg-bg-raised disabled:opacity-50"
              >
                {busy ? 'Redirecting…' : 'Manage billing'}
              </button>
            )}
          </div>
        </div>
      )}

      <p className="mt-4 text-[12.5px] text-text-tertiary">
        Payments are handled entirely by Stripe — no card details are seen or stored by this app.
      </p>
    </div>
  )
}
