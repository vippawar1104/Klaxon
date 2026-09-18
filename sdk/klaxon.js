/**
 * Klaxon browser SDK.
 *
 * Design rules, in priority order:
 *   1. Never throw. An error reporter that crashes the app is worse than none.
 *   2. Never block. Events batch and flush out of band.
 *   3. Never make an outage worse. On 429 the client backs off and stays quiet.
 *
 * Usage:
 *   Klaxon.init({ dsn: 'http://pk_demo@localhost:8000/1', release: 'web@2.4.1' })
 *   Klaxon.captureException(err, { tags: { checkout: 'guest' } })
 */
(function (global) {
  'use strict'

  var MAX_BREADCRUMBS = 30
  var FLUSH_INTERVAL_MS = 5000
  var MAX_BATCH = 20

  var config = null
  var endpoint = null
  var publicKey = null
  var queue = []
  var breadcrumbs = []
  var timer = null
  var mutedUntil = 0
  // The page's own fetch, kept from before the breadcrumb wrapper replaces it.
  var nativeFetch = null

  /** Everything user-facing is wrapped in this: the SDK must never throw. */
  function safe(fn) {
    return function () {
      try {
        return fn.apply(null, arguments)
      } catch (_) {
        /* swallow — reporting must not break the host app */
      }
    }
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }

  /** dsn: <scheme>://<publicKey>@<host>/<projectId> */
  function parseDsn(dsn) {
    var m = /^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn)
    if (!m) throw new Error('Klaxon: malformed dsn')
    return { key: m[2], url: m[1] + '://' + m[3] + '/api/' + m[4] + '/store' }
  }

  function addBreadcrumb(crumb) {
    breadcrumbs.push({
      timestamp: Date.now() / 1000,
      category: crumb.category,
      message: String(crumb.message == null ? '' : crumb.message).slice(0, 300),
      level: crumb.level || 'info',
    })
    if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift()
  }

  function buildEvent(type, value, stack, extra) {
    var e = {
      event_id: uuid(),
      type: type || 'Error',
      value: String(value == null ? '' : value).slice(0, 1000),
      stacktrace: stack || null,
      level: (extra && extra.level) || 'error',
      environment: config.environment,
      release: config.release,
      url: global.location ? global.location.href : null,
      breadcrumbs: breadcrumbs.slice(),
      tags: (extra && extra.tags) || {},
      user: config.user || null,
    }
    return config.beforeSend ? config.beforeSend(e) : e
  }

  function enqueue(event) {
    if (!event) return // beforeSend returned null — drop it
    if (Date.now() < mutedUntil) return // circuit-broken after a 429
    if (config.sampleRate < 1 && Math.random() > config.sampleRate) return

    queue.push(event)
    if (queue.length >= MAX_BATCH) flush()
    else if (!timer) timer = setTimeout(flush, FLUSH_INTERVAL_MS)
  }

  /** safe(): one unserialisable event must not take the rest of the batch with it. */
  var post = safe(function (event, useBeacon) {
    var body = JSON.stringify(event)

    // sendBeacon survives the page unloading, which is exactly when the
    // crash that closed the tab would otherwise be lost.
    if (useBeacon && global.navigator && global.navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' })
      // Beacon cannot set headers, so the key rides along as a query param.
      global.navigator.sendBeacon(endpoint + '?key=' + encodeURIComponent(publicKey), blob)
      return
    }

    // The captured fetch, not the wrapped one: posting through our own
    // breadcrumb wrapper makes every flush write a "POST .../store" crumb, and
    // a batch of 20 evicts the entire user story we exist to capture.
    ;(nativeFetch || global.fetch)(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Klaxon-Key': publicKey },
      body: body,
      keepalive: true,
    })
      .then(function (res) {
        if (res.status === 429) {
          var retry = parseInt(res.headers.get('Retry-After') || '60', 10)
          mutedUntil = Date.now() + retry * 1000
        }
      })
      .catch(function () {
        /* network down — drop rather than retry-storm an already-sick service */
      })
  })

  var flush = safe(function (useBeacon) {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    var batch = queue.splice(0, queue.length)
    for (var i = 0; i < batch.length; i++) post(batch[i], useBeacon)
  })

  function installHandlers() {
    // safe(): these are the only entry points we do not own the caller of. A
    // throw here (a beforeSend that blows up, a reason whose toString does)
    // escapes into the host page's own error handling — from an error reporter.
    global.addEventListener(
      'error',
      safe(function (ev) {
        var err = ev.error
        enqueue(
          buildEvent(
            err && err.name ? err.name : 'Error',
            err && err.message ? err.message : ev.message,
            err && err.stack ? err.stack : null
          )
        )
      })
    )

    global.addEventListener(
      'unhandledrejection',
      safe(function (ev) {
        var reason = ev.reason
        enqueue(
          buildEvent(
            reason && reason.name ? reason.name : 'UnhandledRejection',
            reason && reason.message ? reason.message : String(reason),
            reason && reason.stack ? reason.stack : null
          )
        )
      })
    )

    // Auto-breadcrumbs: the story leading up to the crash.
    global.document &&
      global.document.addEventListener(
        'click',
        safe(function (ev) {
          var t = ev.target
          if (!t || !t.tagName) return
          var id = t.id ? '#' + t.id : ''
          var cls = t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : ''
          addBreadcrumb({ category: 'click', message: t.tagName.toLowerCase() + id + cls })
        }),
        true
      )

    if (global.fetch) {
      nativeFetch = global.fetch
      global.fetch = function (input, init) {
        var method = (init && init.method) || 'GET'
        var url = typeof input === 'string' ? input : input && input.url
        return nativeFetch.apply(this, arguments).then(
          function (res) {
            addBreadcrumb({ category: 'fetch', message: method + ' ' + url + ' ' + res.status })
            return res
          },
          function (err) {
            addBreadcrumb({ category: 'fetch', message: method + ' ' + url + ' failed', level: 'error' })
            throw err
          }
        )
      }
    }

    // Flush on the way out, while the browser still lets us.
    global.document &&
      global.document.addEventListener('visibilitychange', function () {
        if (global.document.visibilityState === 'hidden') flush(true)
      })
  }

  var Klaxon = {
    init: safe(function (options) {
      if (config) return
      var parsed = parseDsn(options.dsn)
      endpoint = parsed.url
      publicKey = parsed.key
      config = {
        environment: options.environment || 'production',
        release: options.release || null,
        sampleRate: typeof options.sampleRate === 'number' ? options.sampleRate : 1,
        beforeSend: options.beforeSend || null,
        user: options.user || null,
      }
      installHandlers()
    }),

    captureException: safe(function (err, extra) {
      if (!config) return
      enqueue(
        buildEvent(
          err && err.name ? err.name : 'Error',
          err && err.message ? err.message : String(err),
          err && err.stack ? err.stack : null,
          extra
        )
      )
    }),

    captureMessage: safe(function (message, extra) {
      if (!config) return
      enqueue(buildEvent('Message', message, null, extra))
    }),

    addBreadcrumb: safe(addBreadcrumb),

    setUser: safe(function (user) {
      if (config) config.user = user
    }),

    flush: flush,
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = Klaxon
  else global.Klaxon = Klaxon
})(typeof window !== 'undefined' ? window : globalThis)
