import { useState } from 'react'
import { Bell, X } from 'lucide-react'
import type { NotifyPermission } from '../lib/useAlertNotifications'

const DISMISSED_KEY = 'klaxon.notify-banner.dismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Only ever shown for `permission === 'default'` — browsers require an
 * explicit user gesture to request Notification permission, so this can't
 * just happen silently on load the way the alert poll itself does. Once
 * granted or dismissed, gone for good (until localStorage is cleared).
 */
export function NotifyBanner({
  permission,
  onRequest,
}: {
  permission: NotifyPermission
  onRequest: () => void
}) {
  const [dismissed, setDismissed] = useState(wasDismissed)

  if (permission !== 'default' || dismissed) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      /* per-viewer convenience only — reappears next visit, not a big deal */
    }
    setDismissed(true)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-bg-raised px-4 py-2 text-[13px]">
      <div className="flex items-center gap-2 text-text-secondary">
        <Bell size={14} className="shrink-0" />
        Get a notification the moment a new alert fires — no setup needed.
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onRequest}
          className="rounded-md bg-accent px-2.5 py-1 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Enable
        </button>
        <button
          onClick={dismiss}
          title="Dismiss"
          className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-surface hover:text-text-secondary"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
