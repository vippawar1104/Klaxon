"""Bounded storage.

Nothing in the ingest path ever deleted anything, so every table grew without
limit — including the dedup ledger, which takes one row per event forever. At
any real volume that is the failure that takes the service down: the disk fills
and ingest starts rejecting the crashes it exists to record.

Each window is chosen from what the data is actually *for*, not a round number:

- `seenevent` only has to outlive an SDK retry. The SDK retries within seconds,
  so a day is already generous, and this is the highest-volume table by far —
  one row per event against one row per *sampled* event elsewhere.
- `event` holds the payloads a human reads while debugging. A crash nobody has
  looked at in a month is not being debugged.
- `alert` is a delivery record, kept longer because it answers "were we told?"
  after an incident review.
- Expired `authsession` rows are dead weight the moment they expire; the auth
  path already refuses them, so deleting them changes nothing but size.

Issues are never purged. The counter on an issue is the product — losing it
would rewrite history — and there is one row per distinct bug, not per event.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlmodel import Session

from backend.models import Alert, AuthSession, Event, SeenEvent

logger = logging.getLogger(__name__)

SEEN_EVENT_DAYS = 1
EVENT_DAYS = 30
ALERT_DAYS = 90


def _cutoff(days: int) -> datetime:
    # Naive UTC: these columns are stored without a timezone on both backends,
    # so an aware comparand would not compare correctly.
    return (datetime.now(timezone.utc) - timedelta(days=days)).replace(tzinfo=None)


def purge(session: Session) -> dict[str, int]:
    """Delete data past its retention window. Returns what was removed."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    removed = {
        "seenevent": session.exec(
            delete(SeenEvent).where(SeenEvent.received_at < _cutoff(SEEN_EVENT_DAYS))
        ).rowcount,
        "event": session.exec(
            delete(Event).where(Event.received_at < _cutoff(EVENT_DAYS))
        ).rowcount,
        "alert": session.exec(
            delete(Alert).where(Alert.created_at < _cutoff(ALERT_DAYS))
        ).rowcount,
        "authsession": session.exec(
            delete(AuthSession).where(AuthSession.expires_at < now)
        ).rowcount,
    }
    session.commit()

    if any(removed.values()):
        logger.info("retention purge removed %s", removed)
    return removed
