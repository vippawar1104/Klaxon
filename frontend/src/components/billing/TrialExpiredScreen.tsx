import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { LogoMark, Wordmark } from '../Logo'
import { api } from '../../lib/api'

/**
 * Replaces the entire dashboard for a free account past its trial — no
 * sidebar, no issues, no alerts, nothing reachable until they subscribe or
 * an operator extends them via the database (trial_ends_at). Not a modal
 * over the dashboard: the dashboard's own data-fetching panes are never
 * mounted in this state, so there is nothing to leak through it.
 */
export function TrialExpiredScreen({ onSignOut }: { onSignOut: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-bg-base px-6 text-center">
      <div className="flex items-center gap-2 text-text-primary">
        <LogoMark size={22} />
        <Wordmark className="text-[17px]" />
      </div>

      <h1 className="mt-8 text-[24px] font-bold text-text-primary">
        Your free trial has ended
      </h1>
      <p className="mt-3 max-w-sm text-[14.5px] leading-relaxed text-text-secondary">
        Your issues and alerts are still here — subscribe to Pro to keep reading them. Nothing
        has been deleted.
      </p>

      {error && <p className="mt-4 text-[13px] text-red-600">{error}</p>}

      <button
        onClick={upgrade}
        disabled={busy}
        className="mt-7 rounded-lg bg-accent px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? 'Redirecting…' : 'Upgrade to Pro — $19/mo'}
      </button>

      <button
        onClick={onSignOut}
        className="mt-5 flex items-center gap-1.5 text-[13px] text-text-tertiary transition-colors hover:text-text-secondary"
      >
        <LogOut size={13} /> Sign out
      </button>
    </div>
  )
}
