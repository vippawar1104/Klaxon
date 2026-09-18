import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  FileSearch,
  GitCompare,
  Layers,
  MonitorSmartphone,
  Repeat,
} from 'lucide-react'
import {
  siDocker,
  siGit,
  siGo,
  siJavascript,
  siNodedotjs,
  siPostgresql,
  siPython,
  siReact,
  siRust,
  siTypescript,
} from 'simple-icons'
import { LogoMark, Wordmark } from '../Logo'
import { NavDropdown } from './NavDropdown'
import { useReveal } from '../../lib/useReveal'

export interface LandingProps {
  onStart: () => void
  onDemo: () => void
  onSignIn: () => void
}

const STACK = [
  siJavascript,
  siTypescript,
  siReact,
  siNodedotjs,
  siPython,
  siGo,
  siRust,
  siPostgresql,
  siDocker,
  siGit,
]

/* ---------- product mocks shown inside the neon-bordered frames ---------- */

function InstallMock() {
  return (
    <div className="font-mono text-[13px] leading-relaxed">
      <div className="mb-3 flex gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-landing-pink/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-landing-lime/50" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
      </div>
      <p className="text-landing-muted">
        <span className="text-landing-lime">$</span>{' '}
        <span className="typing">npm install @klaxon/browser</span>
      </p>
      <p className="mt-3 text-white">
        Klaxon.<span className="text-landing-pink">init</span>({'{'} dsn {'}'})
      </p>
      <p className="text-landing-muted">// that's the whole setup</p>
    </div>
  )
}

function GroupingMock() {
  return (
    <div className="font-mono text-[12.5px]">
      <div className="space-y-1 text-landing-muted">
        {['user 48211', 'user 90733', 'user 11204'].map((u, i) => (
          <p
            key={u}
            className="collapse-row truncate"
            style={{ '--i': i } as React.CSSProperties}
          >
            <span className="text-landing-pink">TypeError</span> · cart.js:42 · {u}
          </p>
        ))}
        <p className="collapse-row text-white/30" style={{ '--i': 3 } as React.CSSProperties}>
          … 997 more
        </p>
      </div>
      <div className="my-3 flex items-center gap-2 text-landing-lime">
        <span className="h-px flex-1 bg-landing-lime/30" />
        fingerprint
        <span className="h-px flex-1 bg-landing-lime/30" />
      </div>
      <div className="group-land flex items-center justify-between rounded border border-landing-lime/50 bg-landing-lime/5 px-3 py-2">
        <span className="text-white">TypeError · cart.js:42</span>
        <span className="text-landing-lime">×1,000</span>
      </div>
    </div>
  )
}

function AlertMock() {
  return (
    <div className="font-mono text-[12.5px]">
      <div className="space-y-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="suppress-row flex items-center gap-2 text-white/25"
            style={{ '--i': i } as React.CSSProperties}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
            alert suppressed · cooldown
          </div>
        ))}
      </div>
      <div className="alert-fire mt-3 rounded border border-landing-pink/60 bg-landing-pink/10 px-3 py-2.5">
        <p className="text-landing-pink">🔔 1 alert sent</p>
        <p className="mt-1 text-white/70">TypeError in cart.js — 1,000 events</p>
      </div>
    </div>
  )
}

function TraceMock() {
  return (
    <div className="font-mono text-[12.5px] leading-relaxed">
      <p className="line-in text-landing-pink" style={{ '--i': 0 } as React.CSSProperties}>
        TypeError: Cannot read property 'total'
      </p>
      <p className="line-in mt-1 text-white" style={{ '--i': 1 } as React.CSSProperties}>
        <span className="text-landing-muted">at</span> renderCart{' '}
        <span className="text-landing-lime">cart.js:42</span>
      </p>
      <p className="line-in text-white/60" style={{ '--i': 2 } as React.CSSProperties}>
        <span className="text-landing-muted">at</span> checkout checkout.js:118
      </p>
      <p className="line-in mt-2 text-white/30" style={{ '--i': 3 } as React.CSSProperties}>
        at dispatch node_modules/react — skipped
      </p>
    </div>
  )
}

export function Frame({ tone, children }: { tone: 'lime' | 'pink'; children: React.ReactNode }) {
  const style =
    tone === 'lime'
      ? 'border-landing-lime hover:shadow-[0_0_28px_-6px] hover:shadow-landing-lime/50'
      : 'border-landing-pink hover:shadow-[0_0_28px_-6px] hover:shadow-landing-pink/50'
  return (
    <div
      className={`rounded-xl border ${style} bg-landing-bg-2/60 p-5 transition-[box-shadow,transform] duration-300 hover:-translate-y-1 sm:p-6`}
    >
      {children}
    </div>
  )
}

/** Ambient sparkles behind the hero. */
function Sparkles() {
  const dots = [
    [8, 22, 0], [17, 62, 1.4], [26, 14, 2.6], [35, 78, 0.8], [44, 30, 3.2],
    [56, 70, 1.1], [65, 18, 2.1], [74, 58, 3.8], [83, 26, 0.5], [91, 66, 2.9],
    [12, 45, 4.2], [88, 42, 1.8],
  ]
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {dots.map(([left, top, delay], i) => (
        <span
          key={i}
          className="drift absolute rounded-full bg-white"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: i % 3 === 0 ? 3 : 2,
            height: i % 3 === 0 ? 3 : 2,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </div>
  )
}

/** "Code" fractures into offset scan-bands, then snaps back clean. */
function GlitchWord({ text }: { text: string }) {
  return (
    <span className="glitch" data-text={text}>
      {text}
    </span>
  )
}

/** Counts up once on screen. */
function CountUp({ to, className = '' }: { to: number; className?: string }) {
  const [value, setValue] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        observer.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 1100)
          setValue(Math.round(to * (1 - Math.pow(1 - t, 3))))
          if (t < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      },
      { threshold: 0.4 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [to])

  return (
    <span ref={ref} className={className}>
      {value.toLocaleString()}
    </span>
  )
}

const FEATURES = [
  {
    tone: 'lime' as const,
    mock: <InstallMock />,
    title: 'Monitor in five lines',
    body: 'Drop in the SDK. No agents to install, no build step, and it never throws inside your app.',
  },
  {
    tone: 'pink' as const,
    mock: <GroupingMock />,
    title: 'A thousand crashes, one issue',
    body: 'Fingerprinting hashes the in-app frames, not line numbers — so an edit above the throw site never splits one bug in two.',
  },
  {
    tone: 'pink' as const,
    mock: <TraceMock />,
    title: 'The culprit, not the noise',
    body: 'Vendor and node_modules frames are skipped, so the frame you actually wrote is the one we show you.',
  },
  {
    tone: 'lime' as const,
    mock: <AlertMock />,
    title: 'One notification, not one thousand',
    body: 'A cooldown means twenty thousand identical crashes in the same storm still send exactly one alert.',
  },
]

/** The specific things that go wrong in frontend apps. */
const PROBLEMS = [
  {
    icon: FileSearch,
    problem: 'Your stack trace is minified garbage',
    solution:
      'Frames come back as a.js:1:24913. Klaxon strips build hashes from bundle names so a redeploy never orphans the issue, and source-map support resolves the rest.',
  },
  {
    icon: MonitorSmartphone,
    problem: 'It only breaks on someone else’s browser',
    solution:
      'Every event carries browser, environment and release tags. Chrome and Firefox traces for the same bug land in one group instead of two.',
  },
  {
    icon: Repeat,
    problem: '"Cannot reproduce" closes half your tickets',
    solution:
      'Breadcrumbs record the clicks, navigations and fetch calls leading up to the throw, so you replay the path instead of guessing it.',
  },
  {
    icon: Layers,
    problem: 'A browser extension fills your dashboard',
    solution:
      'Frames from node_modules, vendor bundles and chrome-extension:// are treated as noise and never used to group, so third-party junk stays out of your issue list.',
  },
  {
    icon: GitCompare,
    problem: 'A bug you fixed quietly came back',
    solution:
      'Resolve an issue and Klaxon watches for it. If it reappears after a deploy it is flagged as regressed, not silently reopened.',
  },
  {
    icon: Boxes,
    problem: 'One bad deploy sends 50,000 events',
    solution:
      'Ingest returns 202 before doing work, payloads are sampled after the first few, and alerts are throttled — a crash loop costs queue depth, not uptime.',
  },
]

const PIPELINE = [
  { step: 'SDK', detail: 'Hooks onerror, batches, flushes on tab close' },
  { step: 'Ingest', detail: 'Validates, rate-limits, returns 202 in ~5ms' },
  { step: 'Queue', detail: 'Absorbs spikes so processing scales separately' },
  { step: 'Group', detail: 'Fingerprints the crash and updates the matching issue' },
  { step: 'Alert', detail: 'Checked against your rules, respecting each one\'s cooldown' },
]

const FAQ = [
  {
    q: 'Does the SDK slow my app down?',
    a: 'Events batch for five seconds and flush out of band via sendBeacon. Every hook body is wrapped in try/catch — a reporter that crashes the app is worse than no reporter.',
  },
  {
    q: 'What happens if Klaxon is down?',
    a: 'The SDK fails silently and drops the event rather than retry-storming a service that is already sick. On a 429 it honours Retry-After and goes quiet.',
  },
  {
    q: 'Is the DSN key safe in my bundle?',
    a: 'Yes — it is write-only by design. It authorises submitting an event to one project and cannot read issues, list projects, or change anything.',
  },
  {
    q: 'How is grouping different from deduplication?',
    a: 'Grouping folds many distinct crashes into one issue by fingerprint. Deduplication discards the same event submitted twice, using the SDK event id. You need both.',
  },
]

export function LandingPage({ onStart, onDemo, onSignIn }: LandingProps) {
  useReveal()

  // Paint the document itself dark while the landing page is mounted, so an
  // overscroll bounce doesn't reveal the dashboard's light background.
  useEffect(() => {
    document.documentElement.classList.add('landing-theme')
    return () => document.documentElement.classList.remove('landing-theme')
  }, [])

  const scrollTo = (id: string) => document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="min-h-screen overflow-y-auto bg-landing-bg font-sans text-landing-ink">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-landing-line/40 bg-landing-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-5 py-3.5 sm:px-8">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex shrink-0 items-center gap-2"
          >
            <LogoMark size={22} />
            <Wordmark className="text-[17px]" />
          </button>

          <nav className="hidden flex-1 items-center gap-6 text-[13px] font-medium uppercase tracking-wide lg:flex">
            <NavDropdown
              label="Platform"
              items={[
                { label: 'Error tracking', description: 'Catch every crash with the full trace', href: '#platform' },
                { label: 'Grouping', description: 'A thousand crashes become one issue', href: '#platform' },
                { label: 'Alerting', description: 'Thresholds, regressions, cooldowns', href: '#platform' },
                { label: 'Dashboard', description: 'Open the live issue stream', onSelect: onDemo },
                { label: 'Full platform overview →', description: 'Fingerprinting, ingest, security, in depth', to: '/platform' },
              ]}
            />
            <NavDropdown
              label="Solutions"
              items={[
                { label: 'Frontend teams', description: 'Minified traces, browser noise, repro gaps', href: '#problems' },
                { label: 'On-call engineers', description: 'One alert per issue, not per event', href: '#problems' },
                { label: 'Release management', description: 'Catch regressions the deploy reintroduced', href: '#problems' },
                { label: 'Browse by team →', description: 'Which parts of Klaxon fit your situation', to: '/solutions' },
              ]}
            />
            <NavDropdown
              label="Resources"
              items={[
                { label: 'How it works', description: 'The ingest pipeline end to end', href: '#pipeline' },
                { label: 'SDK setup', description: 'Five lines to your first event', href: '#sdk' },
                { label: 'FAQ', description: 'Performance, safety, and grouping', href: '#faq' },
                { label: 'All resources →', description: 'Guides, FAQ and comparisons in one place', to: '/resources' },
              ]}
            />
            <Link to="/docs" className="text-white/85 transition-colors hover:text-white">
              Docs
            </Link>
            <Link to="/pricing" className="text-white/85 transition-colors hover:text-white">
              Pricing
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={onSignIn}
              className="hidden text-[13px] font-medium uppercase tracking-wide text-white/85 transition-colors hover:text-white sm:block"
            >
              Sign in
            </button>
            <button
              onClick={onDemo}
              className="rounded border border-landing-pink px-3.5 py-2 text-[13px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
            >
              Get demo
            </button>
            <button
              onClick={onStart}
              className="rounded bg-white px-3.5 py-2 text-[13px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
            >
              Get started
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden px-5 pb-24 pt-16 text-center sm:px-8 sm:pb-28 sm:pt-20">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(255,90,31,.16), transparent 70%)',
          }}
        />
        <Sparkles />

        <div className="relative mx-auto max-w-4xl">
          <button
            onClick={() => scrollTo('#platform')}
            className="rise mx-auto mb-10 flex items-center gap-2 rounded-full bg-landing-purple/25 px-4 py-2 text-[13.5px] text-white ring-1 ring-landing-purple/40 transition-colors hover:bg-landing-purple/35"
            style={{ animationDelay: '60ms' }}
          >
            Klaxon groups 1,000 crashes into 1 issue <ArrowRight size={14} />
          </button>

          <h1
            className="rise text-[42px] font-bold leading-[1.05] sm:text-[64px] lg:text-[80px]"
            style={{ animationDelay: '140ms' }}
          >
            <GlitchWord text="Code" /> breaks,{' '}
            <span className="italic text-landing-pink">catch it</span> once
          </h1>

          <p
            className="rise mx-auto mt-6 max-w-xl text-[19px] leading-relaxed text-landing-muted sm:text-[21px]"
            style={{ animationDelay: '260ms' }}
          >
            Error tracking that collapses a crash storm into a single issue — and a single
            notification.
          </p>

          <div
            className="rise mt-9 flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: '380ms' }}
          >
            <button
              onClick={onStart}
              className="rounded bg-white px-6 py-3 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
            >
              Get started
            </button>
            <button
              onClick={onDemo}
              className="rounded border border-landing-pink px-6 py-3 text-[14px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
            >
              Get demo
            </button>
          </div>
        </div>

        <div
          className="rise relative mx-auto mt-16 max-w-4xl"
          style={{ animationDelay: '520ms' }}
        >
          <button
            onClick={onDemo}
            className="block w-full rounded-xl border border-landing-line bg-landing-card/80 p-4 text-left shadow-[0_0_60px_-20px] shadow-landing-purple transition-colors hover:border-landing-purple sm:p-5"
          >
            <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-wide text-landing-muted">
              <span>Issues · shop-frontend</span>
              <span className="text-landing-lime">
                <CountUp to={466} /> events → 3 issues
              </span>
            </div>
            <div className="space-y-px overflow-hidden rounded-lg">
              {[
                ['TypeError', "Cannot read property 'total' of undefined", 'cart.js:42', 420, 'pink'],
                ['ReferenceError', 'applyCoupon is not defined', 'pricing.js:88', 37, 'pink'],
                ['TypeError', 'Failed to fetch', 'inventory.js:14', 9, 'lime'],
              ].map(([type, msg, culprit, count, tone], i) => (
                <div
                  key={String(culprit)}
                  className="flex items-center gap-3 bg-landing-bg-2/70 px-4 py-3 transition-colors hover:bg-landing-bg-2"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      tone === 'pink' ? 'bg-landing-pink' : 'bg-landing-lime'
                    } ${i === 0 ? 'pulse-ring' : ''}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{type}</p>
                    <p className="truncate text-[12.5px] text-landing-muted">{msg}</p>
                  </div>
                  <span className="hidden font-mono text-[12px] text-landing-muted sm:block">
                    {String(culprit)}
                  </span>
                  <CountUp
                    to={count as number}
                    className="w-12 text-right font-mono text-[15px] tabular-nums"
                  />
                </div>
              ))}
            </div>
          </button>
        </div>
      </section>

      {/* Frontend problems */}
      <section id="problems" className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <h2 data-reveal className="max-w-2xl text-[34px] font-medium leading-[1.15] sm:text-[48px]">
            Six ways a frontend breaks.
            <br />
            <span className="text-landing-pink">All of them land here.</span>
          </h2>

          <div className="mt-14 grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
            {PROBLEMS.map(({ icon: Icon, problem, solution }, i) => (
              <article key={problem} data-reveal data-reveal-delay={i * 70}>
                <Icon size={20} className="text-landing-lime" />
                <h3 className="mt-4 text-[17.5px] font-bold leading-snug">{problem}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-landing-muted">{solution}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Developer first */}
      <section id="platform" className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <h2 data-reveal className="text-[38px] font-medium leading-[1.1] sm:text-[60px]">
            Developer first.
            <br />
            <span className="text-landing-pink">Always.</span>
          </h2>

          <div className="mt-12 grid gap-x-8 gap-y-12 lg:grid-cols-2">
            {FEATURES.map((f, i) => (
              <article key={f.title} data-reveal data-reveal-delay={i * 90}>
                <Frame tone={f.tone}>{f.mock}</Frame>
                <h3 className="mt-5 text-[21px] font-bold">{f.title}</h3>
                <p className="mt-2 max-w-lg text-[15.5px] leading-relaxed text-landing-muted">
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section id="pipeline" className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <h2 data-reveal className="text-[30px] font-medium sm:text-[40px]">
            What happens in the five milliseconds after a crash
          </h2>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PIPELINE.map(({ step, detail }, i) => (
              <div
                key={step}
                data-reveal
                data-reveal-delay={i * 90}
                className="rounded-xl border border-landing-line bg-landing-card/60 p-5"
              >
                <span className="font-mono text-[11px] text-landing-lime">0{i + 1}</span>
                <h3 className="mt-2 text-[16px] font-bold">{step}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-landing-muted">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="border-t border-landing-line/40 px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-[1280px] gap-10 text-center sm:grid-cols-3">
          {[
            ['1,000 → 1', 'Crashes collapsed into a single issue by fingerprint'],
            ['202', 'Returned before any work happens, so a crash loop never takes you down'],
            ['< 30', 'Payloads stored per thousand events — the count lives on the issue'],
          ].map(([stat, label], i) => (
            <div key={stat} data-reveal data-reveal-delay={i * 110}>
              <p className="font-mono text-[40px] font-bold tabular-nums text-landing-lime">{stat}</p>
              <p className="mx-auto mt-3 max-w-[15rem] text-[14.5px] leading-relaxed text-landing-muted">
                {label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* SDK */}
      <section id="sdk" className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto grid max-w-[1280px] items-center gap-12 lg:grid-cols-2">
          <div data-reveal>
            <h2 className="text-[30px] font-medium sm:text-[40px]">
              Your first event,
              <br />
              <span className="text-landing-pink">before your coffee.</span>
            </h2>
            <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-landing-muted">
              One init call hooks the global handlers. Everything after that — batching, breadcrumbs,
              flush-on-close, backoff — is handled for you.
            </p>
            <button
              onClick={onStart}
              className="mt-7 flex items-center gap-2 text-[15px] font-semibold text-landing-lime transition-opacity hover:opacity-70"
            >
              Create a project <ArrowRight size={16} />
            </button>
          </div>

          <div data-reveal data-reveal-delay={120}>
            <Frame tone="lime">
              <pre className="overflow-x-auto font-mono text-[12.5px] leading-relaxed">
                <span className="text-landing-muted">{'// index.js'}</span>
                {'\n'}
                <span className="text-landing-pink">import</span> * <span className="text-landing-pink">as</span>{' '}
                Klaxon <span className="text-landing-pink">from</span>{' '}
                <span className="text-landing-lime">'@klaxon/browser'</span>
                {'\n\n'}
                Klaxon.<span className="text-landing-purple">init</span>({'{'}
                {'\n'} dsn: <span className="text-landing-lime">'https://pk_live@klaxon.dev/1'</span>,
                {'\n'} release: <span className="text-landing-lime">'web@2.4.1'</span>,
                {'\n'} environment: <span className="text-landing-lime">'production'</span>,
                {'\n'}
                {'}'})
                {'\n\n'}
                <span className="text-landing-muted">{'// that is it — crashes now report themselves'}</span>
              </pre>
            </Frame>
          </div>
        </div>
      </section>

      {/* Stack */}
      <section className="border-t border-landing-line/40 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-[1280px] text-center">
          <h2 data-reveal className="text-[30px] font-medium sm:text-[38px]">
            Anything that can POST JSON
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-landing-muted">
            The browser and Node SDKs ship first. The ingest endpoint is plain HTTP, so every other
            runtime is a thin wrapper away.
          </p>
        </div>

        {/* Full-bleed marquee: the track carries two copies so the loop is seamless.
            Masked at both edges so logos fade instead of popping. */}
        <div
          className="relative mt-12 overflow-hidden"
          style={{
            maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
          }}
        >
          <div className="marquee-track">
            {[...STACK, ...STACK].map((icon, i) => (
              <div
                key={`${icon.title}-${i}`}
                title={icon.title}
                className="marquee-item flex h-14 w-14 items-center justify-center rounded-lg border border-landing-line bg-landing-card transition-colors hover:border-landing-lime"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" role="img" aria-label={icon.title}>
                  <path d={icon.path} fill="#ffffff" fillOpacity="0.82" />
                </svg>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <h2 data-reveal className="text-[30px] font-medium sm:text-[40px]">
            Questions engineers actually ask
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 lg:grid-cols-2">
            {FAQ.map(({ q, a }, i) => (
              <div key={q} data-reveal data-reveal-delay={i * 80}>
                <h3 className="text-[16.5px] font-bold">{q}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-landing-muted">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section id="pricing" className="border-t border-landing-line/40 px-5 py-24 text-center sm:px-8">
        <h2 data-reveal className="text-[34px] font-medium leading-tight sm:text-[50px]">
          Stop reading the feed.
          <br />
          <span className="text-landing-pink">Start reading one alert.</span>
        </h2>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onStart}
            className="rounded bg-white px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
          >
            Get started
          </button>
          <button
            onClick={onDemo}
            className="rounded border border-landing-pink px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
          >
            Get demo
          </button>
        </div>
      </section>

      <footer className="border-t border-landing-line/40 px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark size={18} />
            <Wordmark className="text-[14px]" />
          </div>
          <Link to="/feedback" className="text-[13px] text-landing-muted transition-colors hover:text-white">
            Report a bug
          </Link>
          <p className="text-[13px] text-landing-muted">A thousand crashes, one alert.</p>
        </div>
      </footer>
    </div>
  )
}
