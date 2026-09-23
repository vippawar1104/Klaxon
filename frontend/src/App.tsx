import { useEffect, useState } from 'react'
import { Route, Routes, useSearchParams } from 'react-router-dom'
import { Sidebar, type PaneKey } from './components/Sidebar'
import { IssuesPane } from './components/issues/IssuesPane'
import { IssueDetail } from './components/issues/IssueDetail'
import { AlertsPane } from './components/alerts/AlertsPane'
import { SetupPane } from './components/setup/SetupPane'
import { BillingPane } from './components/billing/BillingPane'
import { TrialExpiredScreen } from './components/billing/TrialExpiredScreen'
import { LandingPage } from './components/landing/LandingPage'
import { PlatformPage } from './components/landing/PlatformPage'
import { SolutionsPage } from './components/landing/SolutionsPage'
import { ResourcesPage } from './components/landing/ResourcesPage'
import { DocsPage } from './components/landing/DocsPage'
import { PricingPage } from './components/landing/PricingPage'
import { FeedbackPage } from './components/landing/FeedbackPage'
import { FeedbackInboxPage } from './components/landing/FeedbackInboxPage'
import { AuthPage, type AuthMode } from './components/auth/AuthPage'
import { api, getToken, setToken } from './lib/api'
import { daysLeft } from './lib/trial'
import { useAlertNotifications } from './lib/useAlertNotifications'
import { NotifyBanner } from './components/NotifyBanner'

export type { PaneKey }

/**
 * Where each entry point leads:
 *
 *   Get started            → sign-up page → dashboard (signed in)
 *   Sign in                → sign-in page → dashboard (signed in)
 *   Get demo / preview     → throwaway account created silently, seeded with
 *                            sample issues, dashboard directly, demo banner —
 *                            every dashboard read requires real auth, so this
 *                            is a real (disposable) session, not a bypass
 *   Platform ▸ Dashboard   → same as Get demo
 *   Every other nav item   → scrolls to its landing section
 *
 * A stored token restores the dashboard on reload without a round trip to the
 * landing page.
 *
 * The marketing site is five standalone routes (/platform, /solutions,
 * /resources, /docs, /pricing) plus this one ("/"), which is still the single
 * component that also owns auth and the dashboard. Those five pages have no
 * signed-in state of their own — their header CTAs navigate to
 * "/?start=signup" etc., and the effect below reads that on arrival and hands
 * off to the exact same handlers the home page's own buttons use, so there is
 * only one place that knows how to start a session.
 */
type View = 'landing' | 'auth' | 'dashboard'

function Home() {
  const [view, setView] = useState<View>('landing')
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [restoring, setRestoring] = useState(true)

  const [activePane, setActivePane] = useState<PaneKey>('issues')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [openIssueId, setOpenIssueId] = useState<number | null>(null)
  const { permission: notifyPermission, request: requestNotifyPermission } =
    useAlertNotifications(projectId)
  const [creating, setCreating] = useState(false)

  // Checked once on entering the dashboard, before Sidebar or any pane
  // mounts — an expired account never gets far enough to trigger the panes'
  // own data fetches, which would otherwise 402 individually and need their
  // own error handling. checkingExpiry starts true so the real dashboard
  // never flashes on screen for a moment before this resolves.
  const [expired, setExpired] = useState(false)
  const [checkingExpiry, setCheckingExpiry] = useState(true)
  // Days remaining, kept alongside `expired` from the same fetch rather than
  // a second call from Sidebar — one request answers both "is this account
  // blocked" and "what should the countdown in the sidebar say".
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null)

  const [searchParams, setSearchParams] = useSearchParams()

  const createProject = async () => {
    setCreating(true)
    try {
      const project = await api.createProject('my-app')
      setProjectId(project.id)
      // Straight to setup: a project with no DSN in front of you is useless.
      setActivePane('setup')
    } finally {
      setCreating(false)
    }
  }

  // "Get demo" promises a look at the dashboard with nothing to sign up for.
  // It used to work by hitting endpoints that had no auth check at all; once
  // those were scoped to the caller (closing a real cross-tenant leak), the
  // button just 401'd. The fix keeps the promise from the visitor's side —
  // no form, no password to remember — while satisfying real auth underneath:
  // a throwaway account, created silently, seeded with a couple of sample
  // issues so the grouping story is visible on arrival instead of an empty
  // list.
  // Everything the dashboard remembers is per-ACCOUNT, but this component
  // outlives a sign-out: without a page refresh, signing in as someone else
  // (or starting a demo) kept the previous account's selected project, open
  // issue and trial state. The stale project id was the visible bug — the
  // Setup page waited forever on a project this account doesn't own.
  const resetDashboard = () => {
    setProjectId(null)
    setOpenIssueId(null)
    setActivePane('issues')
    setExpired(false)
    setTrialDaysLeft(null)
  }

  const startDemo = async () => {
    try {
      const id = crypto.randomUUID()
      const { token } = await api.signup(`demo-${id}@klaxon.dev`, id)
      setToken(token)
      resetDashboard()

      const [project] = await api.projects()
      if (project) {
        const cartCrash = (line: number) => ({
          event_id: crypto.randomUUID(),
          type: 'TypeError',
          value: "Cannot read property 'total' of undefined",
          stacktrace:
            `TypeError: Cannot read property 'total' of undefined\n` +
            `    at renderCart (https://shop.example.com/assets/cart.js:${line}:18)\n` +
            `    at checkout (https://shop.example.com/assets/checkout.js:118:4)`,
        })
        // Line numbers vary on purpose — fingerprinting groups on the frame,
        // not the line, so this is the same demo the marketing copy above
        // describes: many events, one issue.
        await Promise.all([
          ...[42, 44, 41, 43, 42, 45, 42, 44].map((line) =>
            api.seedEvent(project.id, project.public_key, cartCrash(line)),
          ),
          api.seedEvent(project.id, project.public_key, {
            event_id: crypto.randomUUID(),
            type: 'ReferenceError',
            value: 'applyCoupon is not defined',
            stacktrace:
              "ReferenceError: applyCoupon is not defined\n" +
              '    at onClick (https://shop.example.com/assets/pricing.js:88:6)',
          }),
        ])
        // Seeded events go through the same queue real traffic does, so give
        // the worker a moment to group them before the issue list first loads.
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      setIsDemo(true)
      setView('dashboard')
    } catch {
      // Most likely cause: the per-address signup throttle, if this is
      // clicked repeatedly in a short window. A real signup is the honest
      // fallback rather than a silently dead button.
      setAuthMode('signup')
      setView('auth')
    }
  }

  // Restore a previous session before deciding what to render, so a signed-in
  // reload doesn't flash the landing page first.
  useEffect(() => {
    if (!getToken()) {
      setRestoring(false)
      return
    }
    api
      .me()
      .then((me) => {
        setEmail(me.email)
        setView('dashboard')
      })
      .catch(() => setToken(null))
      .finally(() => setRestoring(false))
  }, [])

  // Runs once, on the transition into the dashboard — not on every render,
  // and not inside the dashboard's own JSX, so it can't race Sidebar or a
  // pane mounting first and firing its own (soon-to-402) fetch.
  useEffect(() => {
    if (view !== 'dashboard') return
    setCheckingExpiry(true)
    api
      .billingStatus()
      .then((s) => {
        setExpired(s.expired)
        setTrialDaysLeft(daysLeft(s.trial_ends_at))
      })
      .catch(() => setExpired(false)) // fail open: a status-check outage must never lock anyone out
      .finally(() => setCheckingExpiry(false))
  }, [view])

  // Handoff from the five marketing pages: their CTAs navigate here with
  // ?start=signup|signin|demo rather than duplicating auth state five times
  // over. Runs once restoration has settled, so it never races the "already
  // signed in" redirect above, and only while still on the landing view — a
  // signed-in visitor clicking a marketing CTA is already past this.
  useEffect(() => {
    if (restoring || view !== 'landing') return
    const start = searchParams.get('start')
    if (!start) return
    setSearchParams({}, { replace: true })
    if (start === 'signup') {
      setAuthMode('signup')
      setView('auth')
    } else if (start === 'signin') {
      setAuthMode('signin')
      setView('auth')
    } else if (start === 'demo') {
      void startDemo()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoring, view, searchParams])

  const signOut = async () => {
    try {
      await api.logout()
    } catch {
      /* the local token is cleared either way */
    }
    setToken(null)
    resetDashboard()
    setEmail(null)
    setIsDemo(false)
    setView('landing')
  }

  if (restoring) {
    return <div className="min-h-screen bg-landing-bg" />
  }

  if (view === 'landing') {
    return (
      <LandingPage
        onStart={() => {
          setAuthMode('signup')
          setView('auth')
        }}
        onSignIn={() => {
          setAuthMode('signin')
          setView('auth')
        }}
        onDemo={startDemo}
      />
    )
  }

  if (view === 'auth') {
    return (
      <AuthPage
        mode={authMode}
        onModeChange={setAuthMode}
        onBack={() => setView('landing')}
        onSuccess={(token, userEmail) => {
          setToken(token)
          resetDashboard()
          setEmail(userEmail)
          setIsDemo(false)
          setView('dashboard')
        }}
      />
    )
  }

  if (checkingExpiry) {
    return <div className="min-h-screen bg-bg-base" />
  }

  if (expired) {
    return <TrialExpiredScreen onSignOut={signOut} />
  }

  return (
    <div className="flex h-screen flex-col bg-bg-base text-text-primary">
      {isDemo && (
        <div className="flex items-center justify-center gap-3 bg-accent px-4 py-2 text-[13px] text-white">
          <span>Demo mode — a throwaway account seeded with sample crashes.</span>
          <button
            onClick={() => setView('landing')}
            className="rounded bg-white/15 px-2 py-0.5 font-medium transition-colors hover:bg-white/25"
          >
            Back to site
          </button>
        </div>
      )}

      <NotifyBanner permission={notifyPermission} onRequest={requestNotifyPermission} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          activePane={activePane}
          onPaneChange={(pane) => {
            setActivePane(pane)
            setOpenIssueId(null)
          }}
          projectId={projectId}
          onProjectChange={setProjectId}
          onExit={() => setView('landing')}
          email={email}
          onSignOut={signOut}
          trialDaysLeft={trialDaysLeft}
        />

        <main className="min-w-0 flex-1">
          {activePane === 'issues' &&
            projectId !== null &&
            (openIssueId === null ? (
              <IssuesPane projectId={projectId} onOpen={setOpenIssueId} />
            ) : (
              <IssueDetail issueId={openIssueId} onBack={() => setOpenIssueId(null)} />
            ))}

          {activePane === 'issues' && projectId === null && (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div>
                <p className="text-sm font-medium">No project yet</p>
                <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
                  A project is what the SDK submits events against. Create one to get a DSN.
                </p>
                <button
                  onClick={createProject}
                  disabled={creating}
                  className="mt-4 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create a project'}
                </button>
              </div>
            </div>
          )}

          {activePane === 'alerts' && projectId !== null && <AlertsPane projectId={projectId} />}

          {activePane === 'setup' && <SetupPane projectId={projectId} />}

          {activePane === 'billing' && <BillingPane />}
        </main>
      </div>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/platform" element={<PlatformPage />} />
      <Route path="/solutions" element={<SolutionsPage />} />
      <Route path="/resources" element={<ResourcesPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/feedback" element={<FeedbackPage />} />
      <Route path="/feedback/inbox" element={<FeedbackInboxPage />} />
    </Routes>
  )
}

export default App
