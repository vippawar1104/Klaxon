from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from backend.models import PendingNotification
from core import notify


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


class TestEnqueue:
    def test_returns_immediately_without_delivering(self, session, monkeypatch):
        """The whole point: a request handler that enqueues must never wait on
        the network."""
        monkeypatch.setattr(
            "core.webhook.deliver", lambda *a, **k: (_ for _ in ()).throw(AssertionError("delivered inline"))
        )
        row = notify.enqueue(session, "https://hooks.example.com/x", {"text": "hi"})
        assert row.delivered is False
        assert row.attempts == 0


class TestDeliverPending:
    def test_delivers_a_due_notification(self, session, monkeypatch):
        notify.enqueue(session, "https://hooks.example.com/x", {"text": "hi"})
        monkeypatch.setattr("core.webhook.deliver", lambda url, payload: (True, ""))

        handled = notify.deliver_pending(session)

        assert handled == 1
        row = session.exec(select(PendingNotification)).first()
        assert row.delivered is True
        assert row.attempts == 1

    def test_failed_delivery_backs_off(self, session, monkeypatch):
        notify.enqueue(session, "https://hooks.example.com/x", {"text": "hi"})
        monkeypatch.setattr("core.webhook.deliver", lambda url, payload: (False, "timeout"))

        notify.deliver_pending(session)

        row = session.exec(select(PendingNotification)).first()
        assert row.delivered is False
        assert row.attempts == 1
        assert row.next_attempt_at is not None

    def test_not_yet_due_is_skipped(self, session, monkeypatch):
        row = notify.enqueue(session, "https://hooks.example.com/x", {"text": "hi"})
        row.next_attempt_at = datetime.now(timezone.utc) + timedelta(minutes=5)
        session.add(row)
        session.commit()

        monkeypatch.setattr(
            "core.webhook.deliver", lambda *a, **k: (_ for _ in ()).throw(AssertionError("retried early"))
        )
        assert notify.deliver_pending(session) == 0

    def test_gives_up_after_max_attempts(self, session, monkeypatch):
        row = notify.enqueue(session, "https://hooks.example.com/x", {"text": "hi"})
        monkeypatch.setattr("core.webhook.deliver", lambda url, payload: (False, "down"))

        for _ in range(notify.MAX_ATTEMPTS):
            r = session.get(PendingNotification, row.id)
            r.next_attempt_at = None
            session.add(r)
            session.commit()
            notify.deliver_pending(session)

        r = session.get(PendingNotification, row.id)
        assert r.attempts == notify.MAX_ATTEMPTS
        assert r.delivered is False

        r.next_attempt_at = None
        session.add(r)
        session.commit()
        assert notify.deliver_pending(session) == 0

    def test_empty_queue_is_a_no_op(self, session):
        assert notify.deliver_pending(session) == 0
