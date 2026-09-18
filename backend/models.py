from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=_utcnow)

    # Billing. "free" until a checkout.session.completed webhook says
    # otherwise — the webhook is the only thing that ever sets "pro", never
    # the client-side checkout redirect, which a user controls and could
    # revisit or replay.
    plan: str = "free"  # free | pro
    stripe_customer_id: Optional[str] = Field(default=None, index=True)
    stripe_subscription_id: Optional[str] = None

    # NULL means "never expires" — deliberately, not "no trial started". A
    # brand-new signup gets now + 14 days set explicitly; an account that
    # predates this feature, or one an operator has comp'd, is left NULL by
    # the backfill migration and stays free indefinitely. Editing this column
    # directly in the database is the intended way to extend, shorten, or
    # remove a trial by hand — nothing caches it, so a direct edit takes
    # effect on the very next request.
    trial_ends_at: Optional[datetime] = Field(default=None, index=True)


class AuthSession(SQLModel, table=True):
    """Opaque server-side session. Deleting the row logs the user out."""

    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    expires_at: datetime
    created_at: datetime = Field(default_factory=_utcnow)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    # Ships in browser bundles by design: authorises "submit an event to this
    # project" and nothing else.
    public_key: str = Field(index=True, unique=True)
    # Nullable so projects created before auth existed keep working.
    owner_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=_utcnow)


class Issue(SQLModel, table=True):
    """A group of crashes sharing one fingerprint."""

    __table_args__ = (UniqueConstraint("project_id", "fingerprint", name="uq_issue_group"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    fingerprint: str = Field(index=True)

    type: str
    value: str
    culprit: str = ""
    level: str = "error"
    status: str = "unresolved"  # unresolved | resolved | ignored | regressed

    # Denormalised on purpose: the issue list must never COUNT(*) over events.
    times_seen: int = 1
    first_seen: datetime = Field(default_factory=_utcnow)
    last_seen: datetime = Field(default_factory=_utcnow, index=True)
    last_alert_at: Optional[datetime] = None


class AlertRule(SQLModel, table=True):
    """When to notify. `kind` picks the trigger; threshold/window apply to 'volume'."""

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)

    kind: str = "new_issue"  # new_issue | regression | volume
    threshold: int = 100  # events within the window, for kind='volume'
    window_s: int = 300
    # The whole point of the product: one alert per issue per cooldown, however
    # many events arrive in between.
    cooldown_s: int = 3600

    channel: str = "console"  # console | webhook
    target: Optional[str] = None  # webhook URL
    enabled: bool = True
    created_at: datetime = Field(default_factory=_utcnow)


class Alert(SQLModel, table=True):
    """A notification that actually fired — the audit trail for '1 alert sent'."""

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    rule_id: Optional[int] = Field(default=None, foreign_key="alertrule.id")

    kind: str
    reason: str
    channel: str
    delivered: bool = True
    # Events seen at the moment it fired, so the UI can show "1 alert, N events".
    times_seen_at_fire: int = 0
    created_at: datetime = Field(default_factory=_utcnow, index=True)

    # Retry state for channel='webhook'. A console alert delivers inline (it's
    # a log line, nothing to retry) and never touches these. A webhook alert
    # used to deliver inline too — a slow or dead endpoint held up the worker
    # processing the *next* crash event, and a failed delivery was simply
    # forgotten, never retried. Both fixed by making delivery its own pass,
    # queued here rather than in the middle of grouping.
    attempts: int = 0
    next_attempt_at: Optional[datetime] = Field(default=None, index=True)


class PendingEvent(SQLModel, table=True):
    """The ingest queue.

    Ingest writes one row here and returns; a background worker drains it. The
    queue is a table rather than Redis so the project needs no extra service,
    while keeping the property that matters: the request thread never
    fingerprints, groups, or evaluates alerts.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    event_id: str = Field(index=True)
    payload: str  # the raw EventIngest JSON

    attempts: int = 0
    # Set while a worker holds the row, so two workers cannot claim the same one.
    locked_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_utcnow, index=True)


class SeenEvent(SQLModel, table=True):
    """Dedup ledger: one row per accepted event_id.

    Kept separate from `event` because that table is *sampled* — past the
    retention threshold no row is written at all, so dedup silently stopped
    working exactly where it matters most, and an SDK retry after a timeout
    permanently inflated a busy issue's count. Dedup has to cover every event;
    payload storage does not.

    The unique constraint, not a preceding SELECT, is what makes this correct:
    two workers racing the same event_id both attempt the insert and exactly
    one wins.
    """

    __table_args__ = (UniqueConstraint("project_id", "event_id", name="uq_seen_event"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    # Client-generated UUID.
    event_id: str = Field(index=True)
    # The group this event counted towards. Stored rather than issue_id so a
    # duplicate can resolve the issue without the row ever holding a NULL:
    # the fingerprint is known before any row is written.
    fingerprint: str
    received_at: datetime = Field(default_factory=_utcnow, index=True)


class Event(SQLModel, table=True):
    """One sampled occurrence, with the full payload kept for debugging."""

    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    # Client-generated UUID. Dedup lives in SeenEvent, not here — this table is
    # sampled, so it cannot answer "have we already counted this?".
    event_id: str = Field(index=True)

    payload: str  # JSON: frames, breadcrumbs, request/user context
    release: Optional[str] = None
    environment: str = "production"
    received_at: datetime = Field(default_factory=_utcnow, index=True)




class Feedback(SQLModel, table=True):
    """A bug report or comment submitted from the public site.

    Deliberately not tied to a project or an account — the person hitting
    "report a bug" on the marketing site is often not signed in at all, and
    may be reporting a problem with the site itself rather than with any
    project's crash data.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    # Optional: a reporter who wants a reply leaves it, no account required.
    email: Optional[str] = Field(default=None, max_length=254)
    message: str = Field(max_length=4000)
    # Which page they were on — context for the report, not a required field.
    page_url: Optional[str] = Field(default=None, max_length=500)
    user_agent: Optional[str] = Field(default=None, max_length=300)
    created_at: datetime = Field(default_factory=_utcnow, index=True)


class PendingNotification(SQLModel, table=True):
    """A generic outbound webhook waiting to be sent, with retry.

    Not tied to an Alert — this is the queue new feedback submissions go
    through to reach an operator's Slack/Discord/etc, and is generic enough
    for anything else that needs a durable "notify someone" later. The
    request handler that creates a row here never makes the HTTP call itself;
    the worker does, off the request path, same as ingest.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    target: str  # webhook URL
    payload: str  # JSON body to POST
    attempts: int = 0
    delivered: bool = False
    next_attempt_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_utcnow, index=True)
