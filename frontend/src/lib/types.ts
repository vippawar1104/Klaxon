export type IssueStatus = 'unresolved' | 'resolved' | 'ignored' | 'regressed'
export type Level = 'error' | 'warning' | 'info'

export interface Issue {
  id: number
  type: string
  value: string
  culprit: string
  level: Level
  status: IssueStatus
  times_seen: number
  first_seen: string
  last_seen: string
  ai_severity?: AiSeverity | null
}

export type AiSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface Triage {
  root_cause: string
  severity: AiSeverity
  suggested_fix: string
  confidence: number
  model: string | null
  cached: boolean
}

export interface Frame {
  function?: string | null
  module?: string | null
  filename?: string | null
  lineno?: number | null
  colno?: number | null
}

export interface Breadcrumb {
  timestamp?: number | null
  category?: string | null
  message?: string | null
  level: string
}

export interface EventPayload {
  event_id: string
  type: string
  value: string
  stacktrace?: string | null
  level: string
  environment: string
  release?: string | null
  url?: string | null
  breadcrumbs: Breadcrumb[]
  tags: Record<string, string>
  user?: Record<string, unknown> | null
}

export interface IssueDetail extends Issue {
  fingerprint: string
  latest_event: EventPayload | null
  triage: Triage | null
}

export interface Project {
  id: number
  name: string
  public_key: string
  created_at: string
  /** Where the SDK posts. Derived from the request unless KLAXON_INGEST_ORIGIN is set. */
  dsn: string
  /** Self-configuring script src: the SDK with init() already applied. */
  loader_url: string
}

export type AlertKind = 'new_issue' | 'regression' | 'volume'

export interface Alert {
  id: number
  issue_id: number
  kind: AlertKind
  reason: string
  channel: string
  delivered: boolean
  times_seen_at_fire: number
  created_at: string
  issue_type: string | null
  issue_culprit: string | null
}

export interface AlertRule {
  id: number
  kind: AlertKind
  threshold: number
  window_s: number
  cooldown_s: number
  channel: string
  target: string | null
  enabled: boolean
}
