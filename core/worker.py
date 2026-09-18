"""Background worker draining the ingest queue.

Ingest writes a PendingEvent row and returns 202; this drains the queue and does
the expensive part — parsing, fingerprinting, grouping, alert evaluation — off
the request thread. That split is the point of P3: a traffic spike costs queue
depth instead of ingest latency.

Runs as a daemon thread inside the API process, which suits a single-node
deployment. The same `drain_once` is what a separate worker process would call.
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import or_
from sqlmodel import Session, select

from backend.db import IS_SQLITE, engine
from backend.models import PendingEvent
from backend.schemas import EventIngest
from core import alerts, notify, retention
from core.ingest import process_event

logger = logging.getLogger(__name__)

BATCH_SIZE = 50
IDLE_SLEEP = 0.25
MAX_ATTEMPTS = 3
# Hourly. Retention windows are measured in days, so this only has to be
# frequent enough that nothing accumulates between runs.
PURGE_INTERVAL_S = 3600
# A row locked longer than this is assumed abandoned (worker died mid-batch)
# and becomes claimable again.
LOCK_TIMEOUT = timedelta(minutes=5)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _claim(session: Session, limit: int) -> list[PendingEvent]:
    # Naive UTC: both backends store these columns without a timezone (SQLite
    # has no such type, and Postgres is pinned to UTC at connect time), so an
    # aware comparand would serialise with an offset and not compare correctly.
    stale_before = (_utcnow() - LOCK_TIMEOUT).replace(tzinfo=None)

    # The lock test belongs in the WHERE clause, not in Python. Filtering after
    # the LIMIT meant rows another worker held still consumed the budget: with
    # 60 queued rows and the first 50 locked, a second worker claimed nothing
    # and kept claiming nothing until the holder finished, rather than picking
    # up the 10 that were free.
    query = (
        select(PendingEvent)
        .where(
            PendingEvent.attempts < MAX_ATTEMPTS,
            or_(
                PendingEvent.locked_at.is_(None),  # type: ignore[union-attr]
                PendingEvent.locked_at < stale_before,  # type: ignore[operator]
            ),
        )
        .order_by(PendingEvent.id)  # type: ignore[arg-type]
        .limit(limit)
    )
    if not IS_SQLITE:
        # Postgres only. Without this the read and the write are separate, so
        # two workers can both see a row unlocked and both process it. SQLite
        # has no row locks, but it also serialises writers, which bounds the
        # damage to the single-process case this falls back to.
        query = query.with_for_update(skip_locked=True)

    rows = session.exec(query).all()

    claimed = []
    now = _utcnow()
    for row in rows:
        row.locked_at = now
        session.add(row)
        claimed.append(row)

    if claimed:
        session.commit()
    return claimed


def drain_once(limit: int = BATCH_SIZE) -> int:
    """Process up to `limit` queued events. Returns how many were handled."""
    handled = 0
    with Session(engine) as session:
        for row in _claim(session, limit):
            try:
                payload = EventIngest.model_validate_json(row.payload)
                process_event(session, row.project_id, payload)
                session.delete(row)
                session.commit()
                handled += 1
            except Exception:
                # Keep the row and let it retry; drop it once attempts run out
                # so one poisoned payload cannot block the queue forever.
                logger.exception("failed to process pending event %s", row.event_id)
                session.rollback()
                row.attempts += 1
                row.locked_at = None
                if row.attempts >= MAX_ATTEMPTS:
                    # Nothing ever claims a row past the attempt limit, so
                    # keeping it means it sits in the queue forever: the table
                    # grows without bound and the backlog gauge never returns
                    # to zero, which is the number an operator watches.
                    logger.error(
                        "dropping pending event %s after %d attempts", row.event_id, row.attempts
                    )
                    session.delete(row)
                else:
                    session.add(row)
                session.commit()
    return handled


def queue_depth() -> int:
    with Session(engine) as session:
        return len(session.exec(select(PendingEvent.id)).all())


class IngestWorker:
    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    def _run(self) -> None:
        # Retention, alert retries and notification delivery all run on this
        # thread rather than a cron or a second process, so a single-node
        # deployment cannot forget to schedule any of them. Draining the crash
        # queue always takes priority — the other three only run once there is
        # nothing waiting, so a webhook that is slow or down never delays the
        # event a real user is waiting to see grouped.
        next_purge = time.monotonic()
        while not self._stop.is_set():
            try:
                if drain_once() == 0:
                    if time.monotonic() >= next_purge:
                        next_purge = time.monotonic() + PURGE_INTERVAL_S
                        with Session(engine) as session:
                            retention.purge(session)
                    with Session(engine) as session:
                        alerts.retry_pending(session)
                    with Session(engine) as session:
                        notify.deliver_pending(session)
                    # Nothing waiting — back off rather than spin the CPU.
                    self._stop.wait(IDLE_SLEEP)
            except Exception:
                logger.exception("worker loop error")
                self._stop.wait(1.0)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="klaxon-worker", daemon=True)
        self._thread.start()
        logger.info("ingest worker started")

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=timeout)
        logger.info("ingest worker stopped")


worker = IngestWorker()


def wait_until_drained(timeout: float = 30.0) -> bool:
    """Block until the queue empties. For tests and scripts, not request paths."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if queue_depth() == 0:
            return True
        time.sleep(0.05)
    return False
