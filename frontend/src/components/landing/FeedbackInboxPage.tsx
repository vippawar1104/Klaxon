import { useEffect, useState } from 'react'
import { Inbox, Mail } from 'lucide-react'
import { api, getToken } from '../../lib/api'
import { MarketingPage } from './MarketingChrome'

type Row = { id: number; email: string | null; message: string; page_url: string | null; created_at: string }

/**
 * Deliberately not linked from any public nav or footer — reachable only by
 * a signed-in KLAXON_OWNER_EMAIL account that knows this URL. The backend is
 * the real gate (404 for anyone else); not linking it publicly just avoids
 * advertising that a gate exists to look for.
 */
export function FeedbackInboxPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getToken()) {
      setError('Sign in as the account set in KLAXON_OWNER_EMAIL to view this.')
      return
    }
    api
      .listFeedback()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load feedback.'))
  }, [])

  return (
    <MarketingPage>
      <section className="px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h1 className="flex items-center gap-2.5 text-[28px] font-bold">
            <Inbox size={24} className="text-landing-pink" /> Feedback inbox
          </h1>

          {error && (
            <p className="mt-6 rounded-lg border border-landing-line bg-landing-card/60 p-4 text-[14px] text-landing-muted">
              {error}
            </p>
          )}

          {rows && rows.length === 0 && (
            <p className="mt-6 text-[14.5px] text-landing-muted">No reports yet.</p>
          )}

          {rows && rows.length > 0 && (
            <div className="mt-8 space-y-4">
              {rows.map((r) => (
                <div key={r.id} className="rounded-xl border border-landing-line bg-landing-card/60 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-landing-muted">
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                    {r.email && (
                      <a
                        href={`mailto:${r.email}`}
                        className="flex items-center gap-1.5 text-landing-pink hover:underline"
                      >
                        <Mail size={13} /> {r.email}
                      </a>
                    )}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-[14.5px] leading-relaxed text-white">
                    {r.message}
                  </p>
                  {r.page_url && (
                    <p className="mt-2 truncate text-[12px] text-white/40">from: {r.page_url}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </MarketingPage>
  )
}
