import type { Alert, AlertRule, Issue, IssueDetail, IssueStatus, Project, Triage } from './types'

// Relative by default so the dev server's proxy handles it. In production the
// dashboard and API are separate origins, so the API's base URL is baked in at
// build time via VITE_API_BASE (e.g. https://klaxon-api.onrender.com/api).
const BASE = import.meta.env.VITE_API_BASE ?? '/api'
const TOKEN_KEY = 'klaxon.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null // private mode / blocked storage
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* not fatal — the session just won't survive a reload */
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    // Surface the server's own `detail` when there is one — it explains *why*
    // far better than a status code, e.g. "key is valid but throttled".
    let detail = ''
    try {
      detail = (await res.json())?.detail ?? ''
    } catch {
      /* no JSON body */
    }
    throw new Error(detail || `Request failed: ${res.status} ${res.statusText}`)
  }
  // 204 has no body to parse.
  return (res.status === 204 ? undefined : await res.json()) as T
}

interface AuthResponse {
  token: string
  email: string
  user_id: number
}

export const api = {
  signup: (email: string, password: string) =>
    request<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  me: () => request<{ user_id: number; email: string }>('/auth/me'),

  projects: () => request<Project[]>('/projects'),

  createProject: (name: string) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),

  issues: (projectId: number, status: 'open' | 'all' | IssueStatus = 'open') =>
    request<Issue[]>(`/issues?project_id=${projectId}&status=${status}`),

  issue: (id: number) => request<IssueDetail>(`/issues/${id}`),

  setStatus: (id: number, status: IssueStatus) =>
    request<{ id: number; status: IssueStatus }>(`/issues/${id}/status?status=${status}`, {
      method: 'POST',
    }),

  explain: (id: number, refresh = false) =>
    request<Triage & { issue_id: number }>(`/issues/${id}/explain${refresh ? '?refresh=true' : ''}`, {
      method: 'POST',
    }),

  alerts: (projectId: number) => request<Alert[]>(`/alerts?project_id=${projectId}`),

  alertRules: (projectId: number) => request<AlertRule[]>(`/alerts/rules?project_id=${projectId}`),

  toggleRule: (ruleId: number) =>
    request<{ id: number; enabled: boolean }>(`/alerts/rules/${ruleId}/toggle`, { method: 'POST' }),

  // Public — no session required, since the person reporting a problem may
  // not be signed in (or may be reporting one that's stopping them from
  // signing in at all).
  submitFeedback: (body: { email?: string; message: string; page_url?: string }) =>
    request<{ status: string }>('/feedback', { method: 'POST', body: JSON.stringify(body) }),

  // Owner-only inbox — the backend returns 404 (not 403) for anyone else.
  listFeedback: () =>
    request<{ id: number; email: string | null; message: string; page_url: string | null; created_at: string }[]>(
      '/feedback',
    ),

  // Ingest is keyed by the project's public_key, not the session token — this
  // is the one call that authenticates itself, used only to seed sample
  // crashes into a fresh demo project. request() still attaches the bearer
  // token if one is set; the ingest endpoint simply ignores it.
  seedEvent: (
    projectId: number,
    publicKey: string,
    body: { event_id: string; type: string; value: string; stacktrace: string },
  ) =>
    request<{ event_id: string }>(`/${projectId}/store?key=${publicKey}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  billingStatus: () =>
    request<{ plan: 'free' | 'pro'; trial_ends_at: string | null; expired: boolean }>(
      '/billing/status',
    ),

  // Both return a Stripe-hosted URL to redirect the browser to — no card
  // field is ever handled by this app itself.
  createCheckoutSession: (successUrl: string, cancelUrl: string) =>
    request<{ url: string }>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ success_url: successUrl, cancel_url: cancelUrl }),
    }),

  createPortalSession: (returnUrl: string) =>
    request<{ url: string }>('/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ success_url: returnUrl, cancel_url: returnUrl }),
    }),
}
