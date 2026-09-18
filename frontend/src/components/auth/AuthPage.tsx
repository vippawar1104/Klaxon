import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { LogoMark, Wordmark } from '../Logo'
import { api } from '../../lib/api'
import { toErrorMessage } from '../../lib/errors'

export type AuthMode = 'signin' | 'signup'

interface Props {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onSuccess: (token: string, email: string) => void
  onBack: () => void
}

const PERKS = [
  'Group a thousand crashes into one issue',
  'One alert per issue, however many events arrive',
  'Stack traces with the culprit frame extracted',
]

export function AuthPage({ mode, onModeChange, onSuccess, onBack }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  const isSignUp = mode === 'signup'

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  useEffect(() => {
    setError(null)
  }, [mode])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return

    // Checked here as well as server-side so the user is told before a round trip.
    if (isSignUp && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const res = isSignUp
        ? await api.signup(email, password)
        : await api.login(email, password)
      onSuccess(res.token, res.email)
    } catch (err) {
      setError(
        toErrorMessage(err, 'Something went wrong.').includes('409')
          ? 'That email is already registered. Try signing in instead.'
          : isSignUp
            ? 'Could not create that account. Check the email and try again.'
            : 'Incorrect email or password.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-landing-bg font-sans text-landing-ink">
      <div className="mx-auto grid min-h-screen max-w-6xl lg:grid-cols-2">
        {/* Form */}
        <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
          <button
            onClick={onBack}
            className="mb-10 flex w-fit items-center gap-1.5 text-[13px] text-landing-muted transition-colors hover:text-white"
          >
            <ArrowLeft size={14} /> Back to site
          </button>

          <div className="flex items-center gap-2">
            <LogoMark size={22} />
            <Wordmark className="text-[17px]" />
          </div>

          <h1 className="mt-8 text-[30px] font-bold leading-tight">
            {isSignUp ? 'Start tracking errors' : 'Welcome back'}
          </h1>
          <p className="mt-2 text-[15px] text-landing-muted">
            {isSignUp
              ? 'No card required. Your first project is ready in seconds.'
              : 'Sign in to your Klaxon dashboard.'}
          </p>

          <form onSubmit={submit} className="mt-8 max-w-sm space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] text-landing-muted">
                Email
              </label>
              <input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-landing-line bg-landing-bg-2 px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-white/30 focus:border-landing-pink"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] text-landing-muted">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-landing-line bg-landing-bg-2 px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-white/30 focus:border-landing-pink"
              />
              {isSignUp && (
                <p className="mt-1.5 text-[12px] text-landing-muted">At least 8 characters.</p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-landing-pink/40 bg-landing-pink/10 px-3 py-2 text-[13px] text-landing-pink"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-[14px] font-semibold uppercase tracking-wide text-landing-bg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-[13.5px] text-landing-muted">
            {isSignUp ? 'Already have an account?' : 'New to Klaxon?'}{' '}
            <button
              onClick={() => onModeChange(isSignUp ? 'signin' : 'signup')}
              className="font-semibold text-landing-lime transition-opacity hover:opacity-75"
            >
              {isSignUp ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </div>

        {/* Aside */}
        <div className="hidden flex-col justify-center border-l border-landing-line/40 px-12 lg:flex">
          <p className="text-[22px] font-medium leading-snug">
            A thousand crashes.
            <br />
            <span className="text-landing-pink">One alert.</span>
          </p>
          <ul className="mt-8 space-y-4">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-landing-lime" />
                <span className="text-[14.5px] text-landing-muted">{perk}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
