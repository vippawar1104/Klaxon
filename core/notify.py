"""Generic durable "tell someone" queue.

Feedback submissions go through this to reach an operator's Slack/Discord/
custom endpoint. Not specific to feedback — anything that needs a webhook
sent reliably, without making the request thread that triggered it wait on
the network, can enqueue here. Delivery and retry share `core.alerts`'s
backoff schedule and the same underlying `core.webhook.deliver`, so there is
one retry policy in the codebase, not two that can drift apart.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from backend.models import PendingNotification
from core import webhook
from core.alerts import MAX_ATTEMPTS, RETRY_BACKOFF_S

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def enqueue(session: Session, target: str, payload: dict) -> PendingNotification:
    """Queue a webhook for delivery. Returns immediately — the caller (an
    HTTP request handler, typically) never waits on the network."""
    row = PendingNotification(target=target, payload=json.dumps(payload))
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def deliver_pending(session: Session, limit: int = 20) -> int:
    """Attempt every notification that's due. Called from the worker's idle
    loop, same as alerts.retry_pending — never from a request path."""
    now = _utcnow()
    candidates = session.exec(
        select(PendingNotification)
        .where(
            PendingNotification.delivered == False,  # noqa: E712
            PendingNotification.attempts < MAX_ATTEMPTS,
        )
        .order_by(PendingNotification.created_at)  # type: ignore[arg-type]
        .limit(limit)
    ).all()
    due = [
        n for n in candidates if n.next_attempt_at is None or _aware(n.next_attempt_at) <= now
    ]
    if not due:
        return 0

    for note in due:
        try:
            body = json.loads(note.payload)
        except ValueError:
            # A malformed payload will never succeed — stop retrying rather
            # than burn attempts on something that cannot possibly work.
            logger.error("notification %s: unparseable payload, dropping", note.id)
            note.attempts = MAX_ATTEMPTS
            note.next_attempt_at = None
            session.add(note)
            session.commit()
            continue

        delivered, why = webhook.deliver(note.target, body)
        note.attempts += 1
        if delivered:
            note.delivered = True
            note.next_attempt_at = None
        elif note.attempts >= MAX_ATTEMPTS:
            logger.error(
                "notification %s: giving up after %d attempts (%s)", note.id, note.attempts, why
            )
            note.next_attempt_at = None
        else:
            backoff = RETRY_BACKOFF_S[min(note.attempts - 1, len(RETRY_BACKOFF_S) - 1)]
            note.next_attempt_at = _utcnow() + timedelta(seconds=backoff)
            logger.warning(
                "notification %s: delivery failed (%s), retry %d in %ds",
                note.id, why, note.attempts, backoff,
            )
        session.add(note)
        session.commit()

    return len(due)
