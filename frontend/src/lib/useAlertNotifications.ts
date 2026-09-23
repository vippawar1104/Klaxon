import { useEffect, useRef, useState } from 'react'
import { api } from './api'

const POLL_MS = 5000

export type NotifyPermission = NotificationPermission | 'unsupported'

/**
 * Native OS notifications for the currently-watched project's alerts — the
 * one thing missing from the delivery story: an alert with no webhook
 * configured was otherwise only a server log line, invisible unless you
 * were tailing it. This works with zero setup and no external service,
 * which is why it's built before email: nothing to sign up for.
 *
 * Polls rather than a live connection — matches the pattern the Setup page
 * already uses to detect the first event, and is simple enough that a
 * WebSocket isn't worth the complexity for a 5-second latency budget.
 *
 * The browser's Notification API supplies its own sound on essentially
 * every platform — nothing here manages audio directly.
 */
export function useAlertNotifications(projectId: number | null) {
  const seenIds = useRef<Set<number> | null>(null)
  const [permission, setPermission] = useState<NotifyPermission>(
    typeof window === 'undefined' || typeof Notification === 'undefined'
      ? 'unsupported'
      : Notification.permission,
  )

  // A fresh project switch gets a silent baseline, not a hundred
  // notifications for that project's entire alert history.
  useEffect(() => {
    seenIds.current = null
  }, [projectId])

  useEffect(() => {
    if (projectId === null || permission !== 'granted') return

    const poll = () => {
      api
        .alerts(projectId)
        .then((alerts) => {
          if (seenIds.current === null) {
            seenIds.current = new Set(alerts.map((a) => a.id))
            return
          }
          for (const a of alerts) {
            if (seenIds.current.has(a.id)) continue
            seenIds.current.add(a.id)
            const title =
              a.kind === 'regression'
                ? `Regressed: ${a.issue_type ?? 'Issue'}`
                : a.kind === 'volume'
                  ? `Volume alert: ${a.issue_type ?? 'Issue'}`
                  : `New issue: ${a.issue_type ?? 'Issue'}`
            try {
              new Notification(title, {
                body: a.issue_culprit ? `${a.reason} — ${a.issue_culprit}` : a.reason,
                tag: `klaxon-alert-${a.id}`, // replaces rather than stacks if fetched twice
              })
            } catch {
              /* Notification constructor can throw on some mobile browsers
               * even with permission granted — a missed notification is not
               * worth crashing the dashboard over. */
            }
          }
        })
        .catch(() => {
          /* a failed poll just tries again next tick */
        })
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [projectId, permission])

  const request = () => {
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then(setPermission)
  }

  return { permission, request }
}
