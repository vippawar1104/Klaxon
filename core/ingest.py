"""Turn a raw crash report into a grouped issue.

P1 runs this inline on the request. P3 moves the call behind a queue without
changing what it does — which is why it takes a session and a payload and
touches nothing global.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Tuple

from sqlalchemy import text
from sqlmodel import Session, select

from backend.models import Event, Issue
from core import alerts
from core.fingerprint import compute_fingerprint, culprit
from core.stacktrace import parse_event

logger = logging.getLogger(__name__)

# Keep the first occurrences of a group, then sample. A crash loop must not grow
# the database linearly; the issue row already carries the true count.
FULL_RETENTION_BELOW = 10
SAMPLE_EVERY = 100


def should_store_payload(times_seen: int) -> bool:
    return times_seen <= FULL_RETENTION_BELOW or times_seen % SAMPLE_EVERY == 0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def process_event(session: Session, project_id: int, payload) -> Tuple[Issue, bool]:
    """Group one event. Returns the issue and whether it was newly created.

    Raises nothing on duplicates — a replayed event_id is silently ignored so
    an SDK retry after a timeout cannot inflate the count.
    """
    parsed = parse_event(payload.type, payload.value, payload.stacktrace)
    fingerprint = compute_fingerprint(parsed)
    now = _utcnow()

    # Claim the event_id BEFORE incrementing anything. The unique constraint is
    # what makes this correct: a preceding SELECT leaves a window in which two
    # workers both see "not seen" and both count the same event. Whoever loses
    # the insert race gets rowcount 0 and stops here.
    #
    # A crash between this insert and the upsert below loses one event's count
    # instead of double-counting it — the safer direction, and a far smaller
    # window than the previous one.
    claimed = session.exec(
        text(
            """
            INSERT INTO seenevent (project_id, event_id, fingerprint, received_at)
            VALUES (:pid, :eid, :fp, :now)
            ON CONFLICT (project_id, event_id) DO NOTHING
            """
        ),
        params={"pid": project_id, "eid": payload.event_id, "fp": fingerprint, "now": now},
    )
    if claimed.rowcount == 0:
        # Already counted. Resolve the issue via the fingerprint rather than a
        # stored issue_id, so this works even for the racing writer.
        issue = session.exec(
            select(Issue).where(
                Issue.project_id == project_id, Issue.fingerprint == fingerprint
            )
        ).first()
        return issue, False

    # One statement so concurrent workers cannot lose an increment to a
    # read-modify-write race. Supported by SQLite 3.24+ and Postgres 9.5+.
    session.exec(
        text(
            """
            INSERT INTO issue (project_id, fingerprint, type, value, culprit, level,
                               status, times_seen, first_seen, last_seen)
            VALUES (:pid, :fp, :type, :value, :culprit, :level, 'unresolved', 1, :now, :now)
            ON CONFLICT (project_id, fingerprint) DO UPDATE
               SET times_seen = issue.times_seen + 1,
                   last_seen  = :now,
                   status     = CASE WHEN issue.status = 'resolved'
                                     THEN 'regressed' ELSE issue.status END
            """
        ),
        params={
            "pid": project_id,
            "fp": fingerprint,
            "type": parsed.type,
            "value": parsed.value[:500],
            "culprit": culprit(parsed),
            "level": payload.level,
            "now": now,
        },
    )

    # populate_existing: the upsert above went through raw SQL, so the ORM has
    # no idea the row changed. Without it a re-select returns the copy already
    # in this session's identity map — the count from the *previous* event in
    # the batch — and the second event of a new issue reports is_new again.
    issue = session.exec(
        select(Issue)
        .where(Issue.project_id == project_id, Issue.fingerprint == fingerprint)
        .execution_options(populate_existing=True)
    ).one()
    is_new = issue.times_seen == 1

    if should_store_payload(issue.times_seen):
        session.add(
            Event(
                issue_id=issue.id,
                project_id=project_id,
                event_id=payload.event_id,
                payload=json.dumps(payload.model_dump(mode="json")),
                release=payload.release,
                environment=payload.environment,
                received_at=now,
            )
        )

    session.commit()
    session.refresh(issue)

    # Alerting sits after the upsert so it can use the counts it just returned.
    # Never let a notification failure lose the event that triggered it.
    try:
        alerts.evaluate(session, issue, is_new)
    except Exception:
        logger.exception("alert evaluation failed for issue %s", issue.id)
        # Postgres refuses every further statement on a transaction that hit an
        # error, so without this the caller's next commit — the worker deleting
        # the queue row it just finished — fails too, and the event is replayed
        # and counted twice. The grouping above is already committed.
        session.rollback()

    return issue, is_new
