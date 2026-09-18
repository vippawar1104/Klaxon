"""Alert evaluation: a thousand crashes, one notification.

Runs on the worker side of the pipeline, right after an issue is upserted, and
uses the `times_seen`/`status` the upsert just returned so no extra query is
needed to decide whether to fire.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlmodel import Session, select

from backend.models import Alert, AlertRule, Issue
from core import webhook

logger = logging.getLogger(__name__)

# Applied in order as attempts climb; the last entry repeats for any further
# attempt. Past MAX_ATTEMPTS the alert stops retrying — delivered stays False
# permanently, which is itself the honest audit trail ("this alert fired but
# was never acknowledged by the endpoint"), not a row that quietly vanishes.
RETRY_BACKOFF_S = [30, 300, 1800]
MAX_ATTEMPTS = 4


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; compare them as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def default_rules(project_id: int) -> List[AlertRule]:
    """Sensible defaults so a new project alerts without any configuration."""
    return [
        AlertRule(project_id=project_id, kind="new_issue", cooldown_s=3600),
        AlertRule(project_id=project_id, kind="regression", cooldown_s=3600),
        AlertRule(project_id=project_id, kind="volume", threshold=100, window_s=300, cooldown_s=3600),
    ]


def _matches(rule: AlertRule, issue: Issue, is_new: bool) -> Optional[str]:
    """Return the human reason this rule fires, or None."""
    if rule.kind == "new_issue" and is_new:
        return "New issue seen for the first time"

    if rule.kind == "regression" and issue.status == "regressed":
        return "Issue regressed after being resolved"

    if rule.kind == "volume" and issue.times_seen >= rule.threshold:
        window_start = _utcnow() - timedelta(seconds=rule.window_s)
        if _aware(issue.last_seen) >= window_start:
            return f"{issue.times_seen:,} events (threshold {rule.threshold:,})"

    return None


def _in_cooldown(session: Session, issue: Issue, rule: AlertRule) -> bool:
    """The mechanism that turns 1,000 crashes into 1 alert.

    Scoped to (issue, rule kind), not to the issue alone. A single shared
    cooldown meant one `new_issue` alert silently swallowed the regression
    alert for the same issue an hour later — and a regression is the more
    urgent signal of the two.
    """
    last = session.exec(
        select(Alert.created_at)
        .where(Alert.issue_id == issue.id, Alert.kind == rule.kind)
        .order_by(Alert.created_at.desc())  # type: ignore[attr-defined]
        .limit(1)
    ).first()

    if last is None:
        return False
    return _utcnow() - _aware(last) < timedelta(seconds=rule.cooldown_s)


def _payload(issue: Issue, reason: str) -> dict:
    return {
        "issue_id": issue.id,
        "project_id": issue.project_id,
        "type": issue.type,
        "value": issue.value,
        "culprit": issue.culprit,
        "times_seen": issue.times_seen,
        "reason": reason,
    }


def evaluate(session: Session, issue: Issue, is_new: bool) -> Optional[Alert]:
    """Fire at most one alert for this issue. Returns the Alert row if one
    matched — for a webhook, "matched and queued", not "delivered": that part
    now happens later, on retry_pending's own pass, off this call entirely.

    A webhook used to be delivered right here, inline, during event
    processing. Two problems with that: a slow or dead endpoint held up the
    worker from processing the *next* queued crash while this one waited on
    it, and a failed delivery was simply logged and forgotten — never
    retried. Recording the Alert immediately and delivering it separately
    fixes both without changing what a caller of evaluate() sees.
    """
    rules = session.exec(
        select(AlertRule).where(
            AlertRule.project_id == issue.project_id,
            AlertRule.enabled == True,  # noqa: E712 — SQLModel needs the comparison
        )
    ).all()

    for rule in rules:
        reason = _matches(rule, issue, is_new)
        if not reason or _in_cooldown(session, issue, rule):
            continue

        now = _utcnow()
        issue.last_alert_at = now
        session.add(issue)

        is_webhook = rule.channel == "webhook" and bool(rule.target)
        if not is_webhook:
            # console: a log line, not a network call — nothing to queue.
            logger.info("ALERT [%s] %s %s — %s", rule.kind, issue.type, issue.culprit, reason)

        alert = Alert(
            project_id=issue.project_id,
            issue_id=issue.id,
            rule_id=rule.id,
            kind=rule.kind,
            reason=reason,
            channel=rule.channel,
            delivered=not is_webhook,  # console alerts are "delivered" the instant they're logged
            times_seen_at_fire=issue.times_seen,
            created_at=now,
        )
        session.add(alert)
        session.commit()
        session.refresh(alert)

        # Deliberately not delivered here, even for the very first attempt.
        # "Most webhooks respond fast" is true right up until the moment it
        # isn't — and a crash storm big enough to trip a volume alert is
        # exactly the kind of event that correlates with the alerting
        # endpoint also being under stress. Any inline attempt, including a
        # supposedly-fast one, blocks this worker thread from picking up the
        # *next* queued crash while it waits. retry_pending() makes the first
        # attempt too, from the idle loop, once genuine ingest work is caught
        # up — for a lightly loaded instance that's within one idle tick.

        return alert

    return None


def _try_deliver(session: Session, alert: Alert, target: str, payload: dict) -> None:
    """One delivery attempt, called both from evaluate() (the first try, right
    away — most webhooks succeed immediately, so this keeps behaviour close to
    the old inline delivery for the common case) and from retry_pending() for
    every attempt after that."""
    delivered, why = webhook.deliver(target, payload)
    alert.attempts += 1
    if delivered:
        alert.delivered = True
        alert.next_attempt_at = None
    elif alert.attempts >= MAX_ATTEMPTS:
        logger.error("alert %s: giving up after %d attempts (%s)", alert.id, alert.attempts, why)
        alert.next_attempt_at = None
    else:
        backoff = RETRY_BACKOFF_S[min(alert.attempts - 1, len(RETRY_BACKOFF_S) - 1)]
        alert.next_attempt_at = _utcnow() + timedelta(seconds=backoff)
        logger.warning(
            "alert %s: delivery failed (%s), retry %d in %ds", alert.id, why, alert.attempts, backoff
        )
    session.add(alert)
    session.commit()


def retry_pending(session: Session, limit: int = 20) -> int:
    """Deliver (or re-deliver) every webhook alert that's due. Called from the
    worker's idle loop — never from the ingest/grouping path, so a slow or
    dead endpoint costs nothing there.
    """
    now = _utcnow()
    due = session.exec(
        select(Alert)
        .where(
            Alert.channel == "webhook",
            Alert.delivered == False,  # noqa: E712
            Alert.attempts < MAX_ATTEMPTS,
        )
        .order_by(Alert.created_at)  # type: ignore[arg-type]
        .limit(limit)
    ).all()
    # next_attempt_at is checked in Python, not the WHERE clause: it's NULL
    # both for "never tried yet" (deliver now) and "gave up" (never again,
    # already excluded by the attempts filter above), and SQLite's NULL
    # semantics make "column IS NULL OR column <= :now" easy to get wrong
    # across both backends — safer to filter the handful of candidates here.
    due = [a for a in due if a.next_attempt_at is None or _aware(a.next_attempt_at) <= now]
    if not due:
        return 0

    issues = {
        i.id: i for i in session.exec(select(Issue).where(Issue.id.in_([a.issue_id for a in due]))).all()  # type: ignore[attr-defined]
    }
    rules = {
        r.id: r
        for r in session.exec(
            select(AlertRule).where(AlertRule.id.in_([a.rule_id for a in due if a.rule_id]))  # type: ignore[attr-defined]
        ).all()
    }

    for alert in due:
        rule = rules.get(alert.rule_id) if alert.rule_id else None
        issue = issues.get(alert.issue_id)
        if not rule or not rule.target or not issue:
            # The rule or issue was deleted since this alert fired — nothing
            # left to retry against. Stop trying rather than fail forever.
            alert.next_attempt_at = None
            alert.attempts = MAX_ATTEMPTS
            session.add(alert)
            session.commit()
            continue
        _try_deliver(session, alert, rule.target, _payload(issue, alert.reason))

    return len(due)
