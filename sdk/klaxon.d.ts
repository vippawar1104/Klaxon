/**
 * Type definitions for @klaxon/browser.
 *
 * Kept hand-written and deliberately in lockstep with klaxon.js's real,
 * shipped API — every field here is something the runtime actually reads,
 * not aspirational surface. If you add an option to Klaxon.init in
 * klaxon.js, add it here in the same change.
 */

export interface Breadcrumb {
  /** e.g. "click", "navigation", "fetch", "console" — your own taxonomy. */
  category?: string
  message?: string | number | null
  /** default: "info" */
  level?: 'info' | 'warning' | 'error' | 'debug'
}

export interface EventLike {
  event_id: string
  type: string
  value: string
  stacktrace?: string | null
  level: string
  environment: string
  release?: string | null
  url?: string | null
  breadcrumbs: Required<Breadcrumb>[]
  tags: Record<string, string>
  user?: Record<string, unknown> | null
}

export interface InitOptions {
  /**
   * https://<public_key>@<host>/<project_id> — copy it from the Setup tab
   * of the project it belongs to. Required.
   */
  dsn: string
  /** Tagged on every event. Default: "production". */
  environment?: string
  /**
   * Tagged on every event — pair it with your deploy pipeline so a
   * regression can be traced to the version that reintroduced it.
   */
  release?: string
  /**
   * Fraction of events actually sent, 0–1. Default: 1. This is client-side
   * sampling, separate from the server's own payload-retention sampling —
   * leave at 1 unless volume is a real cost concern in the browser itself.
   */
  sampleRate?: number
  /**
   * Runs before an event is queued. Return a modified copy to redact a
   * field before it leaves the browser, or return null/undefined to drop
   * the event entirely.
   */
  beforeSend?: (event: EventLike) => EventLike | null | undefined
  /** Equivalent to calling setUser() immediately after init. */
  user?: Record<string, unknown> | null
}

export interface CaptureExtra {
  tags?: Record<string, string>
  user?: Record<string, unknown>
  [key: string]: unknown
}

export interface Klaxon {
  /** Call once, as early as possible — your app's entry point, not inside a
   * component. Hooks window.onerror and unhandledrejection automatically;
   * nothing else needs to be wired up for an uncaught exception to report
   * itself. A second call is a no-op — init cannot be reconfigured. */
  init(options: InitOptions): void

  /**
   * Report an error manually. This is the one that matters most for a
   * framework app: React (and most frameworks) route render errors to an
   * error boundary, not window.onerror, so the script/init alone never
   * sees them — see the ./react entry point for a ready-made boundary that
   * calls this for you.
   */
  captureException(error: unknown, extra?: CaptureExtra): void

  /** Report a plain string as an event, for a condition worth tracking that
   * isn't a thrown exception. */
  captureMessage(message: string, extra?: CaptureExtra): void

  /** Append to the trail attached to the next event — the last 30 kept. */
  addBreadcrumb(crumb: Breadcrumb): void

  /** Attach identifying context to every subsequent event. Pass null to
   * clear it, e.g. on sign-out. */
  setUser(user: Record<string, unknown> | null): void

  /** Send whatever is queued immediately instead of waiting for the batch
   * timer. Called automatically on tab close. */
  flush(): void
}

declare const Klaxon: Klaxon
export default Klaxon
