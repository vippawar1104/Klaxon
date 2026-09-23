/**
 * Klaxon's React integration: an error boundary.
 *
 * Why this file exists at all: window.onerror — everything the core SDK
 * hooks automatically — never sees a React render error. React catches
 * those itself and hands them to the nearest error boundary instead, so a
 * script tag or a bare Klaxon.init() call alone misses the single largest
 * class of crash in a React app. This is what actually closes that gap,
 * the same reason @sentry/react ships an ErrorBoundary rather than relying
 * on its core SDK's global handlers alone.
 *
 * Plain createElement, no JSX: this ships as-is, with no build step, the
 * same way klaxon.js does.
 *
 * Usage:
 *   import Klaxon from '@klaxon/browser'
 *   import { KlaxonErrorBoundary } from '@klaxon/browser/react'
 *
 *   Klaxon.init({ dsn: '...' })
 *
 *   <KlaxonErrorBoundary fallback={<p>Something went wrong.</p>}>
 *     <App />
 *   </KlaxonErrorBoundary>
 */
;(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('react'), require('./klaxon.js'))
  } else {
    global.KlaxonReact = factory(global.React, global.Klaxon)
  }
})(typeof window !== 'undefined' ? window : globalThis, function (React, Klaxon) {
  'use strict'

  /**
   * React error boundaries must be class components — there is no Hooks
   * equivalent to componentDidCatch, by React's own design.
   */
  function KlaxonErrorBoundary(props) {
    React.Component.call(this, props)
    this.state = { hasError: false }
  }
  KlaxonErrorBoundary.prototype = Object.create(React.Component.prototype)
  KlaxonErrorBoundary.prototype.constructor = KlaxonErrorBoundary

  KlaxonErrorBoundary.getDerivedStateFromError = function () {
    return { hasError: true }
  }

  KlaxonErrorBoundary.prototype.componentDidCatch = function (error, info) {
    try {
      var extra = { react: true }
      if (info && info.componentStack) extra.componentStack = info.componentStack
      if (Klaxon && typeof Klaxon.captureException === 'function') {
        Klaxon.captureException(error, extra)
      }
    } catch (_) {
      /* reporting the crash must never itself become a second crash */
    }
    if (typeof this.props.onError === 'function') {
      try {
        this.props.onError(error, info)
      } catch (_) {
        /* same rule applies to the caller's own handler */
      }
    }
  }

  KlaxonErrorBoundary.prototype.render = function () {
    if (this.state.hasError) {
      return this.props.fallback !== undefined ? this.props.fallback : null
    }
    return this.props.children
  }

  return { KlaxonErrorBoundary: KlaxonErrorBoundary }
})
