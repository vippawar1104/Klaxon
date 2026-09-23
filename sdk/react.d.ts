import type { ComponentType, ErrorInfo, ReactNode } from 'react'

export interface KlaxonErrorBoundaryProps {
  children: ReactNode
  /** Shown in place of the crashed subtree. Omit to render nothing rather
   * than throw the error further up the tree. */
  fallback?: ReactNode
  /** Called after Klaxon has already been sent the error — for your own
   * additional handling (a toast, a redirect), not instead of Klaxon's. */
  onError?: (error: unknown, info: ErrorInfo) => void
}

/**
 * Wrap the part of your tree you want covered — typically the whole app.
 * Catches a render error Klaxon.init()'s window.onerror hook cannot see by
 * itself, reports it via Klaxon.captureException, and renders `fallback`
 * instead of leaving the user at a blank screen.
 */
export const KlaxonErrorBoundary: ComponentType<KlaxonErrorBoundaryProps>
