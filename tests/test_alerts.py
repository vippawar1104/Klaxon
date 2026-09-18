import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from backend.models import Alert, AlertRule, Issue, Project
from backend.schemas import EventIngest
from core import alerts
from core.ingest import process_event

CHROME = """TypeError: Cannot read property 'total' of undefined
    at renderCart (https://shop.example.com/assets/cart.js:42:18)
"""

OTHER = """ReferenceError: applyCoupon is not defined
    at applyDiscount (https://shop.example.com/assets/pricing.js:88:12)
"""


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(Project(id=1, name="shop", public_key="pk_test"))
        for rule in alerts.default_rules(1):
            s.add(rule)
        s.commit()
        yield s


def crash(value="boom", stack=CHROME, type_="TypeError"):
    return EventIngest(event_id=str(uuid.uuid4()), type=type_, value=value, stacktrace=stack)


def sent(session):
    return session.exec(select(Alert)).all()


class TestCooldown:
    def test_thousand_crashes_do_not_send_a_thousand_alerts(self, session):
        """The product thesis, as a test.

        The guarantee is that alert volume is bounded by the number of *rules*,
        not the number of events. With the three default rules, 1,000 crashes
        can produce at most 3 notifications — here 2, since `new_issue` and
        `volume` both match and `regression` does not.
        """
        for _ in range(1000):
            process_event(session, 1, crash())

        alerts_sent = sent(session)
        assert len(alerts_sent) <= 3
        assert {a.kind for a in alerts_sent} == {"new_issue", "volume"}
        assert session.exec(select(Issue)).one().times_seen == 1000

    def test_each_kind_fires_at_most_once_per_cooldown(self, session):
        for _ in range(1000):
            process_event(session, 1, crash())

        kinds = [a.kind for a in sent(session)]
        assert len(kinds) == len(set(kinds))

    def test_first_event_alerts_as_new_issue(self, session):
        process_event(session, 1, crash())
        alert = sent(session)[0]
        assert alert.kind == "new_issue"
        assert alert.times_seen_at_fire == 1

    def test_distinct_bugs_alert_separately(self, session):
        """Cooldown is per issue, not global — a second bug must not be muted."""
        process_event(session, 1, crash())
        process_event(session, 1, crash(type_="ReferenceError", stack=OTHER))
        assert len(sent(session)) == 2

    def test_alert_resumes_after_cooldown_expires(self, session):
        process_event(session, 1, crash())
        assert len(sent(session)) == 1

        issue = session.exec(select(Issue)).one()
        issue.last_alert_at = datetime.now(timezone.utc) - timedelta(hours=2)
        session.add(issue)
        session.commit()

        # Volume rule fires once the cooldown has lapsed and the threshold is met.
        for _ in range(150):
            process_event(session, 1, crash())

        assert len(sent(session)) == 2
        assert sent(session)[1].kind == "volume"


class TestRules:
    def test_regression_alerts_despite_recent_new_issue_alert(self, session):
        """Regression must not be swallowed by the issue's new_issue cooldown.

        The original version of this test cleared `last_alert_at` by hand,
        which hid the fact that a single per-issue cooldown suppressed every
        other rule kind. End-to-end testing caught it; the cooldown is now
        scoped per (issue, rule kind).
        """
        issue, _ = process_event(session, 1, crash())
        assert [a.kind for a in sent(session)] == ["new_issue"]

        issue.status = "resolved"
        session.add(issue)
        session.commit()

        # No cooldown cleared — the new_issue alert fired moments ago.
        process_event(session, 1, crash())

        assert "regression" in [a.kind for a in sent(session)]

    def test_disabled_rules_do_not_fire(self, session):
        for rule in session.exec(select(AlertRule)).all():
            rule.enabled = False
            session.add(rule)
        session.commit()

        for _ in range(200):
            process_event(session, 1, crash())

        assert sent(session) == []

    def test_volume_rule_respects_threshold(self, session):
        # Only the volume rule is active, with a high threshold.
        for rule in session.exec(select(AlertRule)).all():
            rule.enabled = rule.kind == "volume"
            rule.threshold = 500
            session.add(rule)
        session.commit()

        for _ in range(100):
            process_event(session, 1, crash())
        assert sent(session) == []

        for _ in range(450):
            process_event(session, 1, crash())
        assert len(sent(session)) == 1


class TestIsolation:
    def test_alert_failure_does_not_lose_the_event(self, session, monkeypatch):
        """A broken notification channel must never drop a crash report."""
        monkeypatch.setattr(
            alerts, "evaluate", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("channel down"))
        )
        issue, _ = process_event(session, 1, crash())
        assert issue.times_seen == 1


def webhook_rule(session, kind="new_issue", target="https://hooks.example.com/x"):
    from backend.models import AlertRule

    for r in session.exec(select(AlertRule)).all():
        if r.project_id == 1 and r.kind == kind:
            session.delete(r)
    session.commit()
    rule = AlertRule(project_id=1, kind=kind, channel="webhook", target=target, cooldown_s=3600)
    session.add(rule)
    session.commit()
    return rule


class TestWebhookDurability:
    """Delivery used to happen inline, during event processing: a slow or dead
    endpoint held up the worker from grouping the *next* crash, and a failed
    send was simply logged and forgotten. These pin the fix — delivery is a
    separate, retried pass, and nothing here makes a real network call.
    """

    def test_evaluate_never_makes_a_network_call(self, session):
        """The regression this guards: if delivery is ever moved back inline,
        this fails immediately rather than only under real network flakiness.
        """
        webhook_rule(session)
        issue, is_new = process_event(session, 1, crash())

        alert = sent(session)[0]
        assert alert.channel == "webhook"
        assert alert.delivered is False
        assert alert.attempts == 0, "evaluate() attempted delivery inline"

    def test_retry_pending_delivers_a_due_alert(self, session, monkeypatch):
        webhook_rule(session)
        process_event(session, 1, crash())

        monkeypatch.setattr("core.webhook.deliver", lambda url, payload: (True, ""))
        handled = alerts.retry_pending(session)

        assert handled == 1
        alert = sent(session)[0]
        assert alert.delivered is True
        assert alert.attempts == 1

    def test_failed_delivery_schedules_a_backoff_retry(self, session, monkeypatch):
        webhook_rule(session)
        process_event(session, 1, crash())

        monkeypatch.setattr("core.webhook.deliver", lambda url, payload: (False, "connection refused"))
        alerts.retry_pending(session)

        alert = sent(session)[0]
        assert alert.delivered is False
        assert alert.attempts == 1
        assert alert.next_attempt_at is not None
        wait = alert.next_attempt_at.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
        assert timedelta(seconds=20) < wait <= timedelta(seconds=alerts.RETRY_BACKOFF_S[0])

    def test_not_yet_due_alert_is_not_retried_early(self, session, monkeypatch):
        webhook_rule(session)
        process_event(session, 1, crash())

        calls = []
        monkeypatch.setattr(
            "core.webhook.deliver",
            lambda url, payload: (calls.append(1), (False, "down"))[1],
        )
        alerts.retry_pending(session)  # attempt 1: fails, scheduled well in the future
        assert len(calls) == 1

        handled = alerts.retry_pending(session)  # immediately again: not due yet
        assert handled == 0
        assert len(calls) == 1, "retried before its backoff window elapsed"

    def test_gives_up_after_max_attempts_but_keeps_the_record(self, session, monkeypatch):
        webhook_rule(session)
        process_event(session, 1, crash())
        alert_id = sent(session)[0].id

        monkeypatch.setattr("core.webhook.deliver", lambda url, payload: (False, "down"))
        for _ in range(alerts.MAX_ATTEMPTS):
            a = session.get(Alert, alert_id)
            a.next_attempt_at = None  # force each iteration to be due immediately
            session.add(a)
            session.commit()
            alerts.retry_pending(session)

        alert = session.get(Alert, alert_id)
        assert alert.attempts == alerts.MAX_ATTEMPTS
        assert alert.delivered is False, "the failed audit trail must not be deleted"
        assert alert.next_attempt_at is None

        # And it's no longer picked up at all — not stuck retrying forever.
        a = session.get(Alert, alert_id)
        a.next_attempt_at = None
        session.add(a)
        session.commit()
        assert alerts.retry_pending(session) == 0

    def test_console_alerts_are_untouched_by_retry(self, session, monkeypatch):
        """Console alerts deliver inline (a log line, not a network call) and
        must never show up as retry candidates."""
        process_event(session, 1, crash())  # default rules are all console

        alert = sent(session)[0]
        assert alert.delivered is True
        assert alert.attempts == 0

        monkeypatch.setattr(
            "core.webhook.deliver", lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not be called"))
        )
        assert alerts.retry_pending(session) == 0
