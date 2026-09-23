import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'
import type { Project } from '../../lib/types'
import { CodeBlock } from '../shared/CodeBlock'
import { CopyButton } from '../shared/CopyButton'
import { ErrorBanner } from '../shared/ErrorBanner'
import { toErrorMessage } from '../../lib/errors'

/** Long enough to feel live, slow enough not to hammer the API. */
const POLL_MS = 4000

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-4">
      {/* Numbered because these are genuinely ordered — you cannot verify
          before you install. */}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface font-mono text-[12px] tabular-nums text-text-secondary">
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-8">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-text-secondary">
          {children}
        </div>
      </div>
    </li>
  )
}

export function SetupPane({ projectId }: { projectId: number | null }) {
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receiving, setReceiving] = useState(false)

  useEffect(() => {
    if (projectId === null) return
    setError(null)
    api
      .projects()
      .then((list) => {
        const found = list.find((p) => p.id === projectId) ?? null
        setProject(found)
        // Said out loud rather than left as an eternal "Loading…": a project id
        // this account doesn't own used to look exactly like a slow request.
        if (!found) setError('That project is not in this account. Choose one from the sidebar.')
      })
      .catch((e) => setError(toErrorMessage(e, 'Could not load the project.')))
  }, [projectId])

  // Live verification. Stops polling once the first event lands, so a
  // long-open tab is not a permanent background request loop.
  useEffect(() => {
    if (projectId === null || receiving) return
    let cancelled = false

    const check = () => {
      api
        .issues(projectId, 'all')
        .then((issues) => {
          if (!cancelled && issues.length > 0) setReceiving(true)
        })
        .catch(() => {
          /* verification is a nicety; a failed poll should not raise an error */
        })
    }

    check()
    const id = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [projectId, receiving])

  const loaderUrl = project?.loader_url ?? ''
  const dsn = project?.dsn ?? ''

  const tag = loaderUrl ? `<script src="${loaderUrl}"></script>` : ''

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto p-8">
      <header>
        <h1 className="text-2xl font-bold">Install Klaxon</h1>
        <p className="mt-1 text-[15px] text-text-secondary">
          One line in your <code className="font-mono text-[13px]">&lt;head&gt;</code>. Crashes
          from real users start arriving here — no SDK to host, nothing to configure, no
          try/catch to write.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      <ol>
        <Step n={1} title="Paste this into your <head>">
          <p>
            Put it above your own scripts. The SDK arrives already configured for this
            project, so there is no gap between it loading and starting to listen.
          </p>
          {tag ? (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-surface p-3">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px]">
                  {tag}
                </code>
                <CopyButton value={tag} label="Copy" />
              </div>
              <p>
                The key in that URL ships publicly by design — it authorises submitting events
                to this project and nothing else.
              </p>
            </>
          ) : (
            <p>Loading…</p>
          )}
        </Step>

        <Step n={2} title="Verify">
          <p>Throw something on purpose from your browser console:</p>
          <CodeBlock code={`setTimeout(() => { null.f() })`} language="javascript" />
          <p>
            It must be thrown asynchronously or from real app code — an error typed directly
            into the console is caught by devtools and never reaches{' '}
            <code className="font-mono text-[12.5px]">window.onerror</code>.
          </p>

          <div
            className={`mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] ${
              receiving
                ? 'border-severity-success/30 bg-severity-success/10 text-severity-success'
                : 'border-border-subtle bg-bg-surface text-text-secondary'
            }`}
          >
            {receiving ? (
              <>
                <CheckCircle2 size={15} className="shrink-0" />
                Events received — you are all set.
              </>
            ) : (
              <>
                <Loader2 size={15} className="shrink-0 animate-spin" />
                Waiting for the first event…
              </>
            )}
          </div>
        </Step>
      </ol>

      <details className="rounded-xl border border-border-subtle bg-bg-surface p-5" open>
        <summary className="cursor-pointer text-[13px] font-semibold uppercase tracking-wide text-text-tertiary">
          Using React, Next.js or a bundler?
        </summary>
        <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-text-secondary">
          <p>
            Skip the script tag — install the package and call{' '}
            <code className="font-mono text-[12.5px]">init</code> once, in your app's entry
            file, with this DSN:
          </p>
          <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-base p-3">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px]">
              {dsn || '…'}
            </code>
            {dsn && <CopyButton value={dsn} label="Copy" />}
          </div>
          <CodeBlock code={`npm install @klaxon/browser`} language="bash" />
          <CodeBlock
            code={`// main.tsx / index.js — your app's entry point\nimport Klaxon from '@klaxon/browser'\n\nKlaxon.init({\n  dsn: '${dsn || 'https://pk_xxx@your-api.example.com/1'}',\n  release: 'web@2.4.1', // whichever version this deploy is\n})`}
            language="javascript"
          />
          <p>
            Setting <code className="font-mono text-[12.5px]">release</code> is what lets an
            issue tell you which version it first appeared in — the thing you want at 3am.
          </p>

          <p className="pt-1">
            <strong className="font-semibold text-text-primary">
              That alone still misses React's render errors.
            </strong>{' '}
            React catches those itself and hands them to the nearest error boundary rather than{' '}
            <code className="font-mono text-[12.5px]">window.onerror</code> — wrap your app in
            the one the package ships:
          </p>
          <CodeBlock
            code={`import Klaxon from '@klaxon/browser'\nimport { KlaxonErrorBoundary } from '@klaxon/browser/react'\n\nKlaxon.init({ dsn: '${dsn || 'https://pk_xxx@your-api.example.com/1'}' })\n\nfunction Root() {\n  return (\n    <KlaxonErrorBoundary fallback={<p>Something went wrong.</p>}>\n      <App />\n    </KlaxonErrorBoundary>\n  )\n}`}
            language="jsx"
          />
          <p>
            Next.js App Router has its own top-level catch —{' '}
            <code className="font-mono text-[12.5px]">app/global-error.tsx</code> — for a crash
            above where a normal boundary can reach:
          </p>
          <CodeBlock
            code={`'use client'\nimport Klaxon from '@klaxon/browser'\n\nKlaxon.init({ dsn: '${dsn || 'https://pk_xxx@your-api.example.com/1'}' })\n\nexport default function GlobalError({ error }) {\n  Klaxon.captureException(error)\n  return <html><body><h2>Something went wrong</h2></body></html>\n}`}
            language="jsx"
          />
        </div>
      </details>

      <section className="rounded-xl border border-border-subtle bg-bg-surface p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary">
          What happens next
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">
          Every crash is hashed into a group from its error type and stack frames — with line
          numbers and build hashes deliberately excluded, so the same bug stays one issue
          across deploys. A thousand crashes become one issue with a counter, and you get one
          alert rather than a thousand. Resolve an issue and Klaxon reopens it as a regression
          if it returns.
        </p>
      </section>
    </div>
  )
}
