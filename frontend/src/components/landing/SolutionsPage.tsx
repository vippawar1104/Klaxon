import { AlertTriangle, Code2, GitBranch, Rocket, Server, Users } from 'lucide-react'
import { useReveal } from '../../lib/useReveal'
import { useMarketingNav } from '../../lib/useMarketingNav'
import { MarketingPage } from './MarketingChrome'

const AUDIENCES = [
  {
    icon: Code2,
    tone: 'pink' as const,
    id: 'frontend',
    title: 'Frontend teams',
    lede: 'The trace you get is minified garbage, and the bug only reproduces on someone else\'s browser.',
    points: [
      'Frames come back as a.js:1:24913. Build hashes are stripped from bundle names so a redeploy never orphans the issue, and source-map support resolves the rest to the line you actually wrote.',
      'Every event carries browser, environment and release tags, so a Chrome trace and a Firefox trace for the same bug land in one group instead of two.',
      'Frames from node_modules, vendor bundles and chrome-extension:// are never used to group — a browser extension injecting garbage into the page does not fill your issue list.',
      'Breadcrumbs record the clicks, navigations and fetch calls leading up to the throw, so "cannot reproduce" stops closing half your tickets.',
    ],
  },
  {
    icon: AlertTriangle,
    tone: 'lime' as const,
    id: 'oncall',
    title: 'On-call engineers',
    lede: 'A thousand identical crashes should be one page, not a thousand.',
    points: [
      'A new-issue alert and a regression alert on the same issue are tracked independently, so the more urgent one is never swallowed by the other having just fired.',
      'Three rule kinds cover the real cases: a brand-new issue, an issue crossing a volume threshold in a window, and a resolved issue coming back after a deploy.',
      'Delivery goes to a webhook you point at whatever already pages you — Slack incoming webhook, PagerDuty, or a custom endpoint. The target is validated so it cannot be pointed back at your own internal network.',
      'Ingest returns 202 before any processing happens, so the crash storm that is paging you does not also degrade the service that is trying to tell you about it.',
    ],
  },
  {
    icon: GitBranch,
    tone: 'pink' as const,
    id: 'release',
    title: 'Release management',
    lede: 'A bug you fixed last sprint quietly came back, and nobody noticed until support did.',
    points: [
      'Resolving an issue is a real state change Klaxon watches. If the same fingerprint reappears, it is marked regressed, not silently reopened as if it were still just sitting there unresolved.',
      'Every stored event carries the release tag it happened under, so "did this ship in 2.4.1 or 2.4.2" is a filter, not an investigation.',
      'The regression alert rule fires independently of new-issue and volume rules, so a regression is never missed just because the issue already has history.',
    ],
  },
  {
    icon: Rocket,
    tone: 'lime' as const,
    id: 'indie',
    title: 'Indie hackers & small teams',
    lede: 'You do not have an on-call rotation. You have you, and a phone.',
    points: [
      'One script tag. No build step, no agent, no config file to get wrong before the first event shows up.',
      'Flat pricing, not a per-event meter that turns a viral morning into a surprise bill — see Pricing for the actual numbers.',
      'Self-hostable: the same deployment setup this product runs on is yours to point at your own infrastructure if you would rather own the data outright.',
    ],
  },
  {
    icon: Server,
    tone: 'pink' as const,
    id: 'platform-teams',
    title: 'Platform & infra teams',
    lede: 'You are the one who has to trust that a third-party SDK will not make things worse.',
    points: [
      'Every hook body in the browser SDK is wrapped in try/catch — a reporter that throws inside your app is a worse failure than no reporter at all, so it is designed against.',
      'On a 429 the SDK honours Retry-After and goes quiet rather than retry-storming a service that told it to back off.',
      'The ingest key embedded in your bundle is write-only by design: it authorises submitting events to one project and cannot read issues, list projects, or touch alert rules — extracting it from your JS gets an attacker nothing but a way to send you noise.',
    ],
  },
  {
    icon: Users,
    tone: 'lime' as const,
    id: 'multi-team',
    title: 'Multiple teams, one account',
    lede: "Team A's crash data should not be Team B's business.",
    points: [
      'Every project belongs to exactly one account, and every read or write is checked against that ownership — a project you do not own is not just hidden in the UI, it is unreachable.',
      'A request for a project you do not own gets the same response as a project that does not exist, so account ids cannot be enumerated by probing.',
      'Separate projects per app or per team, each with its own DSN, its own alert rules, and its own webhook targets.',
    ],
  },
]

export function SolutionsPage() {
  useReveal()
  const { goSignup, goDemo } = useMarketingNav()

  return (
    <MarketingPage>
      <section className="border-b border-landing-line/40 px-5 pb-16 pt-16 sm:px-8 sm:pb-20 sm:pt-20">
        <div className="mx-auto max-w-[1280px]">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-landing-pink">Solutions</p>
          <h1 className="mt-3 max-w-3xl text-[36px] font-bold leading-[1.1] sm:text-[56px]">
            Whichever part of this is your problem
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-landing-muted sm:text-[19px]">
            Klaxon is one product, but the reason it matters is different depending on which seat
            you're in. Pick yours.
          </p>
          <nav className="mt-7 flex flex-wrap gap-2">
            {AUDIENCES.map((a) => (
              <a
                key={a.id}
                href={`#${a.id}`}
                className="rounded-full border border-landing-line px-3.5 py-1.5 text-[13px] text-landing-muted transition-colors hover:border-landing-pink hover:text-white"
              >
                {a.title}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1280px] space-y-16">
          {AUDIENCES.map(({ icon: Icon, tone, id, title, lede, points }, i) => (
            <article
              key={id}
              id={id}
              data-reveal
              data-reveal-delay={i * 40}
              className="scroll-mt-24 border-t border-landing-line/40 pt-12 first:border-t-0 first:pt-0"
            >
              <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
                <div>
                  <div
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-lg border ${
                      tone === 'pink' ? 'border-landing-pink/50 text-landing-pink' : 'border-landing-lime/50 text-landing-lime'
                    }`}
                  >
                    <Icon size={20} />
                  </div>
                  <h2 className="mt-4 text-[26px] font-bold leading-tight sm:text-[30px]">{title}</h2>
                  <p className="mt-3 text-[15px] italic leading-relaxed text-landing-muted">"{lede}"</p>
                </div>
                <ul className="space-y-4">
                  {points.map((p) => (
                    <li key={p} className="flex gap-3 text-[15px] leading-relaxed text-landing-muted">
                      <span
                        className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                          tone === 'pink' ? 'bg-landing-pink' : 'bg-landing-lime'
                        }`}
                      />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 text-center sm:px-8 sm:py-24">
        <h2 data-reveal className="text-[28px] font-medium leading-tight sm:text-[42px]">
          Whichever one that was, it takes five lines to find out.
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={goSignup}
            className="rounded bg-white px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
          >
            Get started
          </button>
          <button
            onClick={goDemo}
            className="rounded border border-landing-pink px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
          >
            Get demo
          </button>
        </div>
      </section>
    </MarketingPage>
  )
}
