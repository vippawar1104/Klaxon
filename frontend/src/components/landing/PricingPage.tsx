import { useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useReveal } from '../../lib/useReveal'
import { useMarketingNav } from '../../lib/useMarketingNav'
import { api, getToken } from '../../lib/api'
import { MarketingPage } from './MarketingChrome'

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    period: '',
    tagline: 'One project, every core feature, no card required.',
    cta: 'Get started',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/month',
    tagline: 'Flat, per account — not per event. Unlimited team seats.',
    cta: 'Get started',
    highlight: true,
  },
  {
    name: 'Self-hosted',
    price: 'Free',
    period: 'forever',
    tagline: 'Your infrastructure, the same code this product deploys itself with.',
    cta: 'Read the docs',
    highlight: false,
  },
]

const ROWS: [string, boolean | string, boolean | string, boolean | string][] = [
  ['Projects', '1', 'Unlimited', 'Unlimited'],
  ['Team seats', '1', 'Unlimited', 'Unlimited'],
  ['Error grouping & fingerprinting', true, true, true],
  ['Dedup on retried events', true, true, true],
  ['New-issue & regression alerts', true, true, true],
  ['Volume-threshold alerts', false, true, true],
  ['Webhook delivery (Slack, PagerDuty, custom)', false, true, true],
  ['AI-assisted stack trace explanation', false, true, 'bring your own key'],
  ['Event retention', '14 days', '90 days', 'you decide'],
  ['Support', 'Community', 'Email', 'Community'],
]

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Check size={17} className="mx-auto text-landing-lime" />
  if (value === false) return <Minus size={16} className="mx-auto text-white/25" />
  return <span className="text-[13.5px] text-landing-muted">{value}</span>
}

export function PricingPage() {
  useReveal()
  const { goSignup } = useMarketingNav()
  const [checkingOut, setCheckingOut] = useState(false)

  // Already signed in → a real Checkout session, right from here. Not yet
  // signed in → the existing signup flow, same as Free; there's no account
  // yet for Stripe to attach a subscription to, so checkout has to wait
  // until after that — the Billing pane in the dashboard picks it up from
  // there.
  const startPro = async () => {
    if (!getToken()) {
      goSignup()
      return
    }
    setCheckingOut(true)
    try {
      const { url } = await api.createCheckoutSession(
        `${window.location.origin}/`,
        window.location.href,
      )
      window.location.href = url
    } catch {
      setCheckingOut(false)
    }
  }

  return (
    <MarketingPage>
      <section className="border-b border-landing-line/40 px-5 pb-16 pt-16 text-center sm:px-8 sm:pb-20 sm:pt-20">
        <div className="mx-auto max-w-2xl">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-landing-pink">Pricing</p>
          <h1 className="mt-3 text-[36px] font-bold leading-[1.1] sm:text-[52px]">
            Flat. Not per event.
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-landing-muted sm:text-[19px]">
            The worst day your app has — a bad deploy looping on an exception — should not also be
            the day your bill spikes. Every plan is a flat price regardless of event volume.
          </p>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto grid max-w-[1280px] gap-6 md:grid-cols-3">
          {TIERS.map((t, i) => (
            <div
              key={t.name}
              data-reveal
              data-reveal-delay={i * 80}
              className={`rounded-2xl border p-7 ${
                t.highlight
                  ? 'border-landing-pink bg-landing-card shadow-[0_0_60px_-20px] shadow-landing-pink'
                  : 'border-landing-line bg-landing-card/60'
              }`}
            >
              {t.highlight && (
                <span className="rounded-full bg-landing-pink/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-landing-pink">
                  Most teams start here
                </span>
              )}
              <h2 className="mt-4 text-[20px] font-bold">{t.name}</h2>
              <p className="mt-2 flex items-baseline gap-1">
                <span className="text-[38px] font-bold tabular-nums">{t.price}</span>
                <span className="text-[14px] text-landing-muted">{t.period}</span>
              </p>
              <p className="mt-3 text-[14px] leading-relaxed text-landing-muted">{t.tagline}</p>
              {t.cta === 'Read the docs' ? (
                <Link
                  to="/docs#self-hosting"
                  className="mt-6 block rounded border border-landing-pink px-4 py-2.5 text-center text-[13.5px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-landing-pink/15"
                >
                  {t.cta}
                </Link>
              ) : (
                <button
                  onClick={t.highlight ? startPro : goSignup}
                  disabled={t.highlight && checkingOut}
                  className={`mt-6 w-full rounded px-4 py-2.5 text-[13.5px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-90 disabled:opacity-50 ${
                    t.highlight ? 'bg-white text-landing-bg' : 'border border-landing-pink text-white'
                  }`}
                >
                  {t.highlight && checkingOut ? 'Redirecting…' : t.cta}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1280px] overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-landing-line">
                <th className="py-4 text-[13px] font-semibold uppercase tracking-wide text-landing-muted">
                  Feature
                </th>
                {TIERS.map((t) => (
                  <th
                    key={t.name}
                    className="py-4 text-center text-[13px] font-semibold uppercase tracking-wide text-white"
                  >
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, free, pro, selfHosted]) => (
                <tr key={label} className="border-b border-landing-line/50">
                  <td className="py-3.5 text-[14px] text-landing-muted">{label}</td>
                  <td className="py-3.5 text-center">
                    <Cell value={free} />
                  </td>
                  <td className="py-3.5 text-center">
                    <Cell value={pro} />
                  </td>
                  <td className="py-3.5 text-center">
                    <Cell value={selfHosted} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <h2 data-reveal className="text-[24px] font-medium sm:text-[30px]">
            Pricing questions
          </h2>
          <div className="mt-8 space-y-7">
            <div>
              <h3 className="text-[15.5px] font-bold">What counts against a plan?</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-landing-muted">
                Projects and seats — never events. A crash loop that sends 50,000 events in an hour
                costs nothing extra; the issue row absorbs the count, and only a sample of payloads
                is kept in full regardless of tier.
              </p>
            </div>
            <div>
              <h3 className="text-[15.5px] font-bold">Can I self-host and still be on Pro?</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-landing-muted">
                Self-hosting is its own path — the same deploy configuration this product runs on is
                yours to point at your own infrastructure, free. Pro is for running on Klaxon's
                hosted instance without managing a database yourself.
              </p>
            </div>
            <div>
              <h3 className="text-[15.5px] font-bold">What happens if I outgrow Free?</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-landing-muted">
                A second project or teammate is the trigger, not a volume number — upgrade whenever
                that becomes true, from inside the dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line/40 px-5 py-20 text-center sm:px-8 sm:py-24">
        <h2 data-reveal className="text-[28px] font-medium leading-tight sm:text-[42px]">
          Start on Free. Upgrade the day it's worth it.
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
