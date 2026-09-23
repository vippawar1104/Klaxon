import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useMarketingNav } from '../../lib/useMarketingNav'
import { MarketingPage } from './MarketingChrome'

const SECTIONS = [
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'api', label: 'API reference' },
  { id: 'react', label: 'React' },
  { id: 'grouping', label: 'How grouping works' },
  { id: 'alerts', label: 'Alert rules' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'self-hosting', label: 'Self-hosting' },
]

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-landing-line bg-landing-bg-2/80 p-4 font-mono text-[12.5px] leading-relaxed text-landing-muted">
      <code>{children}</code>
    </pre>
  )
}

function Row({ name, type, def, body }: { name: string; type: string; def?: string; body: string }) {
  return (
    <div className="border-t border-landing-line/50 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className="font-mono text-[13.5px] text-landing-pink">{name}</code>
        <span className="font-mono text-[12px] text-landing-muted">{type}</span>
        {def && <span className="font-mono text-[12px] text-white/40">default: {def}</span>}
      </div>
      <p className="mt-1 text-[14px] leading-relaxed text-landing-muted">{body}</p>
    </div>
  )
}

export function DocsPage() {
  const { goSignup } = useMarketingNav()
  const location = useLocation()

  // Guides on the Resources page and the home page's dropdown deep-link here
  // with a hash (e.g. /docs#alerts) — scroll to it once the page has mounted.
  useEffect(() => {
    if (!location.hash) return
    const el = document.querySelector(location.hash)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash])

  return (
    <MarketingPage>
      <section className="border-b border-landing-line/40 px-5 pb-12 pt-16 sm:px-8 sm:pt-20">
        <div className="mx-auto max-w-[1280px]">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-landing-pink">Docs</p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.1] sm:text-[48px]">Documentation</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-landing-muted">
            Everything here matches the actual SDK and API — nothing aspirational, nothing planned.
          </p>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8">
        <div className="mx-auto grid max-w-[1280px] gap-12 lg:grid-cols-[14rem_1fr]">
          <nav className="hidden lg:block">
            <div className="sticky top-24 space-y-1 border-l border-landing-line/60 pl-4">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="block py-1 text-[13.5px] text-landing-muted transition-colors hover:text-white"
                >
                  {s.label}
                </a>
              ))}
            </div>
          </nav>

          <div className="max-w-2xl space-y-16">
            <article id="quickstart" className="scroll-mt-24">
              <h2 className="text-[24px] font-bold">Quickstart</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                Every project you create has a ready-made loader URL — copy the script tag from the
                Setup tab in the dashboard, or npm install the package directly:
              </p>
              <Code>{`<script src="https://your-api.example.com/js/1/pk_live.js"></script>`}</Code>
              <p className="mt-4 text-[15px] leading-relaxed text-landing-muted">
                Or, for a bundled app:
              </p>
              <Code>{`npm install @klaxon/browser

import Klaxon from '@klaxon/browser'

Klaxon.init({
  dsn: 'https://pk_live@your-api.example.com/1',
  release: 'web@2.4.1',
  environment: 'production',
})`}</Code>
              <p className="mt-4 text-[14.5px] leading-relaxed text-landing-muted">
                That's the whole setup. window.onerror and unhandledrejection are hooked
                automatically — nothing else to wire up for an uncaught exception to be reported.
              </p>
            </article>

            <article id="configuration" className="scroll-mt-24">
              <h2 className="text-[24px] font-bold">Configuration</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                Options passed to <code className="text-landing-pink">Klaxon.init()</code>:
              </p>
              <div className="mt-4">
                <Row name="dsn" type="string — required" body="The DSN from your project's Setup tab: https://<public_key>@<host>/<project_id>. Everything else is derived from it." />
                <Row name="environment" type="string" def="'production'" body="Tagged on every event; filter issues by it in the dashboard." />
                <Row name="release" type="string" def="null" body="Tagged on every event. Pair it with your deploy pipeline so a regression can be traced to the version that reintroduced it." />
                <Row name="sampleRate" type="number, 0–1" def="1" body="Fraction of events sent to the server at all, before Klaxon's own server-side sampling of stored payloads. Leave at 1 unless volume is a real cost concern client-side." />
                <Row name="beforeSend" type="(event) => event | null" def="null" body="Runs before an event is queued. Return null to drop it, or return a modified copy — strip a field that shouldn't leave the browser, for instance." />
                <Row name="user" type="object" def="null" body="Attached to every event from this point on. Equivalent to calling setUser() immediately after init." />
              </div>
            </article>

            <article id="api" className="scroll-mt-24">
              <h2 className="text-[24px] font-bold">API reference</h2>
              <div className="mt-4">
                <Row name="Klaxon.captureException(err, extra?)" type="(Error, object?) => void" body="Report an error manually — the one that matters most, since React (and most frameworks) route render errors to an error boundary rather than window.onerror, so the script tag alone never sees them. See React, below, for the boundary that calls this for you." />
                <Row name="Klaxon.captureMessage(message, extra?)" type="(string, object?) => void" body="Report a plain string as an event, for a condition worth tracking that isn't a thrown exception." />
                <Row name="Klaxon.addBreadcrumb({ category, message, level? })" type="(object) => void" body="Append to the trail attached to the next event — the last 30 kept. Klaxon's own outgoing requests are excluded, so a crash loop's breadcrumbs stay the user's actions, not the reporter's own traffic." />
                <Row name="Klaxon.setUser(user)" type="(object | null) => void" body="Attach identifying context to every subsequent event. Pass null to clear it, e.g. on sign-out." />
                <Row name="Klaxon.flush()" type="() => void" body="Send whatever is queued immediately instead of waiting for the five-second batch timer. Called automatically on tab close." />
              </div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-landing-muted">
                Every call is wrapped internally so a bug in your own beforeSend, or a value that
                fails to serialise, cannot throw back into your app.
              </p>
            </article>

            <article id="react" className="scroll-mt-24">
              <h2 className="text-[24px] font-bold">React</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                <code className="text-landing-pink">Klaxon.init()</code> alone misses the largest
                class of crash in a React app: React catches its own render errors and hands them
                to the nearest error boundary instead of letting them reach{' '}
                <code className="text-landing-pink">window.onerror</code>. Import the boundary
                from the package's React entry point and wrap your app in it:
              </p>
              <Code>{`import Klaxon from '@klaxon/browser'
import { KlaxonErrorBoundary } from '@klaxon/browser/react'

Klaxon.init({ dsn: 'https://pk_live@your-api.example.com/1' })

function Root() {
  return (
    <KlaxonErrorBoundary fallback={<p>Something went wrong.</p>}>
      <App />
    </KlaxonErrorBoundary>
  )
}`}</Code>
              <p className="mt-4 text-[14.5px] leading-relaxed text-landing-muted">
                One prop worth knowing: <code className="text-landing-pink">onError</code>, called
                after Klaxon has already recorded the crash, for your own handling on top —
                nothing needs to duplicate the reporting itself.
              </p>
            </article>

            <article id="grouping" className="scroll-mt-24">
              <h2 className="text-[24px] font-bold">How grouping works</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                Each event is parsed into an error type, a message, and a stack trace. The
                fingerprint is a hash of the error type plus the top in-app frames —{' '}
                <strong className="text-white">line numbers are deliberately excluded</strong>. Frames
                from node_modules, vendor bundles and browser extensions are stripped first, so
                third-party noise is never what two unrelated bugs happen to share.
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                Grouping is separate from deduplication. Every event carries a client-generated{' '}
                <code className="text-landing-pink">event_id</code>, and a retried request after a
                timeout is recognised and never counted twice — even if several arrive at once.
              </p>
            </article>

            <article id="alerts" className="scroll-mt-24">
              <h2 className="text-[24px] font-bold">Alert rules</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                Three rule kinds, each on its own cooldown per issue:
              </p>
              <div className="mt-4">
                <Row name="new_issue" type="fires once, on first occurrence" body="An issue that didn't exist before this event." />
                <Row name="regression" type="fires when a resolved issue reappears" body="Marking an issue resolved is a real state change; if the same fingerprint comes back, it's flagged regressed rather than silently reopened." />
                <Row name="volume" type="threshold + window" body="Fires once the issue crosses N events inside a rolling window, e.g. 100 events in 5 minutes." />
              </div>
              <p className="mt-3 text-[14.5px] leading-relaxed text-landing-muted">
                A new-issue alert and a regression alert on the same issue are tracked
                independently — a regression is never swallowed just because a new-issue alert on
                the same issue fired an hour earlier.
              </p>
            </article>

            <article id="webhooks" className="scroll-mt-24">
              <h2 className="text-[24px] font-bold">Webhooks</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                An alert rule with a webhook target gets a POST with the issue's type, message,
                culprit, current count, and which rule fired — point it at a Slack incoming webhook,
                PagerDuty, or your own endpoint.
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                Webhook targets are validated, so a rule can only ever notify you — it cannot be
                turned into a way to reach your own internal infrastructure.
              </p>
            </article>

            <article id="self-hosting" className="scroll-mt-24">
              <h2 className="text-[24px] font-bold">Self-hosting</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-landing-muted">
                Klaxon is open about how it runs — the same deployment configuration this product
                uses ships in the repository. Clone it, connect your own database and hosting, and
                follow the setup guide there to run it entirely on your own infrastructure.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 text-center sm:px-8 sm:py-24">
        <h2 className="text-[28px] font-medium leading-tight sm:text-[42px]">
          That's the whole surface. Nothing hidden behind it.
        </h2>
        <button
          onClick={goSignup}
          className="mt-8 rounded bg-white px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
        >
          Get started
        </button>
      </section>
    </MarketingPage>
  )
}
