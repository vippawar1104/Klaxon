import { Fingerprint, Lock, Radio, Shield, Timer, Workflow } from 'lucide-react'
import { useReveal } from '../../lib/useReveal'
import { useMarketingNav } from '../../lib/useMarketingNav'
import { MarketingPage } from './MarketingChrome'

const PILLARS = [
  {
    icon: Fingerprint,
    tone: 'pink' as const,
    title: 'Fingerprinting, not string-matching',
    body: 'Each event is grouped on the error type plus where it actually happened in your code — deliberately not the line number. An edit two lines above the throw site does not split one bug into two; a fix that moves the throw site by a line does not orphan its history.',
    detail: 'Vendor bundles, framework internals and browser-extension frames are never used to group, so third-party noise never becomes the thing two different bugs happen to share.',
  },
  {
    icon: Workflow,
    tone: 'lime' as const,
    title: 'Grouping and dedup solve different problems',
    body: 'Grouping folds many distinct crashes into one issue — that is what turns 1,000 events into 1 row. Deduplication is separate: a retried submission after a network timeout is recognised and never counted twice, even when several are processed at the same moment.',
    detail: 'Both are correct under real concurrency, not just on the happy path — a burst of identical retries collapses to exactly one count, verified under load, not assumed.',
  },
  {
    icon: Timer,
    tone: 'pink' as const,
    title: 'One alert, on a real cooldown',
    body: 'A rule fires once per issue inside its cooldown window — a new-issue alert and a regression alert on the same issue are tracked independently, so the more urgent one is never silently swallowed by the other having just fired.',
    detail: 'Three rule kinds ship by default: a brand-new issue, a resolved issue reappearing after a deploy, and a volume threshold inside a time window — each with its own cooldown.',
  },
  {
    icon: Radio,
    tone: 'lime' as const,
    title: 'A crash storm costs nothing but time',
    body: 'Accepting an event and processing it are two separate steps, so a spike in traffic never slows down the response the SDK is waiting on. A crash loop that sends 50,000 events in a minute is absorbed, not felt.',
    detail: 'After the first few occurrences of an issue, only a sample of full payloads is kept — the count on the issue itself is always exact regardless.',
  },
  {
    icon: Shield,
    tone: 'pink' as const,
    title: 'Your data is yours alone',
    body: 'Every issue, alert and rule is checked against who owns it before anything is returned or changed. A request for a project you do not own gets the same response as a project that does not exist — an outsider cannot tell the difference, let alone read the data.',
    detail: 'The same protection covers every action, not only reads — resolving an issue or disabling an alert rule you do not own is refused exactly the same way.',
  },
  {
    icon: Lock,
    tone: 'lime' as const,
    title: 'A webhook alert cannot be turned against you',
    body: "Alert rules can post to a webhook you choose. That target is validated, so it cannot be pointed at your own internal infrastructure — an alert rule is a notification, never a door into your network.",
    detail: 'The key embedded in your bundle is write-only: it authorises submitting events to one project and nothing else — it cannot read issues, list projects, or touch alert rules even if extracted from your JS.',
  },
]

const PIPELINE = [
  { step: '01 · SDK', detail: 'Hooks window.onerror and unhandledrejection automatically, batches for five seconds, and flushes on tab close so nothing is lost to a closed tab.' },
  { step: '02 · Ingest', detail: 'Validates the request and returns immediately — typically in single-digit milliseconds — before any real processing happens.' },
  { step: '03 · Queue', detail: 'Absorbs traffic spikes, and is resilient to a processing failure partway through a batch — an accepted event is never silently dropped.' },
  { step: '04 · Group', detail: 'Parses the stack and updates the matching issue — correctly, even when many events for the same issue arrive at the same moment.' },
  { step: '05 · Alert', detail: 'Checked against every enabled rule for the project; the first one that matches and is out of cooldown fires.' },
]

export function PlatformPage() {
  useReveal()
  const { goSignup, goDemo } = useMarketingNav()

  return (
    <MarketingPage>
      <section className="border-b border-landing-line/40 px-5 pb-16 pt-16 sm:px-8 sm:pb-20 sm:pt-20">
        <div className="mx-auto max-w-[1280px]">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-landing-pink">Platform</p>
          <h1 className="mt-3 max-w-3xl text-[36px] font-bold leading-[1.1] sm:text-[56px]">
            What actually happens between a crash and a notification
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-landing-muted sm:text-[19px]">
            Not a features list — the real mechanics: how events are grouped, how duplicates are
            caught, how one alert survives a thousand identical crashes, and how the whole pipeline
            stays out of your request path.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={goSignup}
              className="rounded bg-white px-6 py-3 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
            >
              Get started
            </button>
            <button
              onClick={goDemo}
              className="rounded border border-landing-pink px-6 py-3 text-[14px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
            >
              Get demo
            </button>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <div className="grid gap-x-10 gap-y-14 lg:grid-cols-2">
            {PILLARS.map(({ icon: Icon, tone, title, body, detail }, i) => (
              <article key={title} data-reveal data-reveal-delay={i * 70}>
                <div
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${
                    tone === 'pink' ? 'border-landing-pink/50 text-landing-pink' : 'border-landing-lime/50 text-landing-lime'
                  }`}
                >
                  <Icon size={18} />
                </div>
                <h3 className="mt-4 text-[20px] font-bold leading-snug">{title}</h3>
                <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-landing-muted">{body}</p>
                <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-white/50">{detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pipeline" className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <h2 data-reveal className="text-[28px] font-medium sm:text-[38px]">
            The five stages, end to end
          </h2>
          <div className="mt-10 space-y-4">
            {PIPELINE.map(({ step, detail }, i) => (
              <div
                key={step}
                data-reveal
                data-reveal-delay={i * 80}
                className="grid gap-1 rounded-xl border border-landing-line bg-landing-card/60 p-5 sm:grid-cols-[10rem_1fr] sm:items-start sm:gap-6"
              >
                <span className="font-mono text-[13px] text-landing-lime">{step}</span>
                <p className="text-[14.5px] leading-relaxed text-landing-muted">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 text-center sm:px-8 sm:py-24">
        <h2 data-reveal className="text-[28px] font-medium leading-tight sm:text-[42px]">
          See the fingerprint hold across a real deploy.
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={goDemo}
            className="rounded bg-white px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
          >
            Get demo
          </button>
          <button
            onClick={goSignup}
            className="rounded border border-landing-pink px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
          >
            Get started
          </button>
        </div>
      </section>
    </MarketingPage>
  )
}
