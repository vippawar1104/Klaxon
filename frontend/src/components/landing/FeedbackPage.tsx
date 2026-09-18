import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../../lib/api'
import { MarketingPage } from './MarketingChrome'

export function FeedbackPage() {
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    setError('')
    try {
      await api.submitFeedback({
        email: email.trim() || undefined,
        message: message.trim(),
        // Where they came from, not where they are now — useful context for
        // a report about something on a different page.
        page_url: document.referrer || location.pathname,
      })
      setStatus('sent')
      setMessage('')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    }
  }

  return (
    <MarketingPage>
      <section className="px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-xl">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-landing-pink">Feedback</p>
          <h1 className="mt-3 text-[32px] font-bold leading-[1.1] sm:text-[44px]">
            Found something broken?
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-landing-muted">
            No account needed. Tell us what happened and, if you'd like a reply, leave an email —
            it's the only optional field.
          </p>

          {status === 'sent' ? (
            <div className="mt-10 flex items-start gap-3 rounded-xl border border-landing-lime/40 bg-landing-lime/10 p-5">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-landing-lime" />
              <div>
                <p className="text-[15px] font-semibold text-white">Thanks — that's in.</p>
                <p className="mt-1 text-[14px] leading-relaxed text-landing-muted">
                  It's been recorded. If you left an email, you may hear back about it.
                </p>
                <button
                  onClick={() => setStatus('idle')}
                  className="mt-4 text-[13.5px] font-medium text-landing-pink hover:underline"
                >
                  Report another
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-10 space-y-5">
              <div>
                <label htmlFor="fb-message" className="block text-[13px] font-medium text-white">
                  What went wrong
                </label>
                <textarea
                  id="fb-message"
                  required
                  minLength={1}
                  maxLength={4000}
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What you were doing, what you expected, what happened instead…"
                  className="mt-2 w-full rounded-lg border border-landing-line bg-landing-card/60 px-3.5 py-3 text-[14.5px] text-white placeholder:text-white/30 focus:border-landing-pink focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="fb-email" className="block text-[13px] font-medium text-white">
                  Email <span className="font-normal text-landing-muted">(optional — for a reply)</span>
                </label>
                <input
                  id="fb-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-2 w-full rounded-lg border border-landing-line bg-landing-card/60 px-3.5 py-3 text-[14.5px] text-white placeholder:text-white/30 focus:border-landing-pink focus:outline-none"
                />
              </div>

              {status === 'error' && (
                <p className="text-[13.5px] text-landing-pink">{error}</p>
              )}

              <button
                type="submit"
                disabled={status === 'sending' || message.trim().length === 0}
                className="w-full rounded bg-white px-5 py-3 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {status === 'sending' ? 'Sending…' : 'Send report'}
              </button>
            </form>
          )}
        </div>
      </section>
    </MarketingPage>
  )
}
