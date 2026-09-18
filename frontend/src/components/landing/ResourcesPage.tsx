import { BookOpen, LifeBuoy, ScrollText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useReveal } from '../../lib/useReveal'
import { useMarketingNav } from '../../lib/useMarketingNav'
import { MarketingPage } from './MarketingChrome'

const GUIDES = [
  { title: 'Install the SDK', body: 'One script tag or one npm install — your first event inside five minutes.', to: '/docs#quickstart' },
  { title: 'How fingerprinting groups issues', body: 'What goes into the hash, what is deliberately left out, and why.', to: '/docs#grouping' },
  { title: 'Set up an alert rule', body: 'New-issue, regression and volume rules, and how the cooldown actually works.', to: '/docs#alerts' },
  { title: 'Configure a webhook', body: 'Point alerts at Slack, PagerDuty, or your own endpoint — and what gets refused.', to: '/docs#webhooks' },
  { title: 'Self-host Klaxon', body: 'The same deployment setup this product ships itself with.', to: '/docs#self-hosting' },
  { title: 'Reading the API directly', body: 'Every dashboard call is a plain, documented HTTP endpoint behind your token.', to: '/docs#api' },
]

const FAQ = [
  {
    q: 'Does the SDK slow my app down?',
    a: 'Events batch for five seconds and flush out of band via sendBeacon, off the main thread\'s critical path. Every hook body is wrapped in try/catch — a reporter that crashes the app is a worse failure than no reporter.',
  },
  {
    q: 'What happens if Klaxon is down?',
    a: 'The SDK fails silently and drops the event rather than retry-storming a service that is already unhealthy. On a 429 it honours Retry-After and goes quiet until that window passes.',
  },
  {
    q: 'Is the DSN key safe to ship in my bundle?',
    a: 'Yes — it is write-only by design. It authorises submitting an event to exactly one project and cannot read issues, list projects, or change alert rules, even if someone extracts it from your JS.',
  },
  {
    q: 'How is grouping different from deduplication?',
    a: 'Grouping folds many distinct crashes into one issue by fingerprint (error type + top in-app frames, not line numbers). Deduplication discards the same event submitted twice, using the SDK-generated event id, checked before anything is counted. You need both — grouping alone would still double-count a retried request.',
  },
  {
    q: 'Can one bad deploy take the service down?',
    a: 'No — accepting an event and processing it are separate steps, so a traffic spike never slows down the response the SDK is waiting on. Alerts are throttled by cooldown too, so a crash loop produces one notification, not thousands.',
  },
  {
    q: 'Can I see this without creating a real account?',
    a: 'Get demo does create an account — a throwaway one, generated silently with a random password, seeded with a couple of sample issues. Every dashboard read requires real authentication, so this is a genuine (disposable) session, not a bypass.',
  },
  {
    q: 'Can a webhook alert be used to reach my own internal network?',
    a: 'No — a webhook target is validated so an alert rule can only ever notify you, never become a way to reach infrastructure it shouldn\'t be able to touch.',
  },
  {
    q: 'Can another account on Klaxon see my issues?',
    a: 'No. Every read and write is checked against the project\'s owner. A request for a project you do not own gets the same response as a project that does not exist — there is no way to tell the difference from outside.',
  },
]

export function ResourcesPage() {
  useReveal()
  const { goSignup } = useMarketingNav()

  return (
    <MarketingPage>
      <section className="border-b border-landing-line/40 px-5 pb-16 pt-16 sm:px-8 sm:pb-20 sm:pt-20">
        <div className="mx-auto max-w-[1280px]">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-landing-pink">Resources</p>
          <h1 className="mt-3 max-w-3xl text-[36px] font-bold leading-[1.1] sm:text-[56px]">
            Guides, answers, and how this is priced
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-landing-muted sm:text-[19px]">
            Short, specific, and honest about what actually happens under the hood — no marketing
            fog between you and the mechanism.
          </p>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <h2 data-reveal className="flex items-center gap-2.5 text-[26px] font-medium sm:text-[34px]">
            <BookOpen size={24} className="text-landing-lime" /> Guides
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GUIDES.map((g, i) => (
              <Link
                key={g.title}
                to={g.to}
                data-reveal
                data-reveal-delay={i * 50}
                className="group rounded-xl border border-landing-line bg-landing-card/60 p-5 transition-colors hover:border-landing-pink"
              >
                <h3 className="text-[16px] font-bold group-hover:text-landing-pink">{g.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-landing-muted">{g.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <h2 data-reveal className="flex items-center gap-2.5 text-[26px] font-medium sm:text-[34px]">
            <ScrollText size={22} className="text-landing-lime" /> Why flat pricing
          </h2>
          <p data-reveal className="mt-5 max-w-2xl text-[15.5px] leading-relaxed text-landing-muted">
            Most error trackers meter by event volume, which means the worst day your app has — the
            day a bad deploy loops on an exception — is also the day your bill spikes, right when
            you least want to be thinking about it. Klaxon charges per project, flat, regardless of
            how many events land in it. The full numbers are on{' '}
            <Link to="/pricing" className="text-landing-pink underline underline-offset-2">
              the pricing page
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px]">
          <h2 data-reveal className="flex items-center gap-2.5 text-[26px] font-medium sm:text-[34px]">
            <LifeBuoy size={22} className="text-landing-lime" /> Frequently asked
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 lg:grid-cols-2">
            {FAQ.map(({ q, a }, i) => (
              <div key={q} data-reveal data-reveal-delay={i * 60}>
                <h3 className="text-[16.5px] font-bold">{q}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-landing-muted">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 text-center sm:px-8 sm:py-24">
        <h2 data-reveal className="text-[28px] font-medium leading-tight sm:text-[42px]">
          Still have a question the docs don't answer?
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={goSignup}
            className="rounded bg-white px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90"
          >
            Get started
          </button>
          <Link
            to="/docs"
            className="rounded border border-landing-pink px-7 py-3.5 text-[14px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
          >
            Read the docs
          </Link>
        </div>
      </section>
    </MarketingPage>
  )
}
