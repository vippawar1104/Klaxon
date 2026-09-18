import uuid

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from backend.models import Event, Issue, Project
from backend.schemas import EventIngest
from core.ingest import process_event

CHROME = """TypeError: Cannot read property 'total' of undefined
    at renderCart (https://shop.example.com/assets/cart.js:42:18)
    at checkout (https://shop.example.com/assets/checkout.js:118:5)
"""


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(Project(id=1, name="shop", public_key="pk_test"))
        s.commit()
        yield s


def crash(value="Cannot read property 'total' of undefined", stack=CHROME, event_id=None):
    return EventIngest(
        event_id=event_id or str(uuid.uuid4()),
        type="TypeError",
        value=value,
        stacktrace=stack,
    )


def test_first_event_creates_issue(session):
    issue, is_new = process_event(session, 1, crash())
    assert is_new
    assert issue.times_seen == 1
    assert issue.culprit == "cart.js:42"
    assert issue.status == "unresolved"


def test_thousand_crashes_become_one_issue(session):
    """The product thesis, as a test."""
    for _ in range(1000):
        process_event(session, 1, crash())

    issues = session.exec(select(Issue)).all()
    assert len(issues) == 1
    assert issues[0].times_seen == 1000


def test_payloads_are_sampled_not_stored_in_full(session):
    for _ in range(1000):
        process_event(session, 1, crash())

    stored = len(session.exec(select(Event)).all())
    # 10 kept in full + every 100th thereafter — nowhere near 1000.
    assert stored < 30


def test_retried_event_id_does_not_inflate_count(session):
    repeated = str(uuid.uuid4())
    process_event(session, 1, crash(event_id=repeated))
    process_event(session, 1, crash(event_id=repeated))
    process_event(session, 1, crash(event_id=repeated))

    issue = session.exec(select(Issue)).one()
    assert issue.times_seen == 1


def test_retry_is_deduped_even_when_the_payload_was_sampled_out(session):
    """Dedup must not quietly stop working above the sampling threshold.

    It used to: the check was a lookup in `event`, and past
    FULL_RETENTION_BELOW no row is written there, so a retried submission on a
    busy issue counted twice. The test above never caught it because it only
    ever replayed the *first* event, which is always stored.

    This is the case that matters in production — the SDK retries after a
    timeout, and timeouts happen when an issue is firing hard.
    """
    sampled_out = str(uuid.uuid4())
    for i in range(12):
        # The 11th event is past FULL_RETENTION_BELOW and not on the sampling
        # interval, so no Event row is kept for it.
        process_event(session, 1, crash(event_id=sampled_out if i == 10 else None))

    issue = session.exec(select(Issue)).one()
    assert issue.times_seen == 12
    assert session.exec(select(Event).where(Event.event_id == sampled_out)).first() is None

    # The SDK retries that same event after a timeout.
    process_event(session, 1, crash(event_id=sampled_out))

    session.refresh(issue)
    assert issue.times_seen == 12, "a replayed event inflated the count"


def test_duplicate_returns_the_issue_it_originally_counted_towards(session):
    """A caller must still get a usable issue back on a duplicate."""
    repeated = str(uuid.uuid4())
    first, _ = process_event(session, 1, crash(event_id=repeated))
    again, is_new = process_event(session, 1, crash(event_id=repeated))

    assert not is_new
    assert again is not None
    assert again.id == first.id


def test_different_bugs_stay_separate(session):
    other = """ReferenceError: total is not defined
    at applyDiscount (https://shop.example.com/assets/pricing.js:8:3)
"""
    process_event(session, 1, crash())
    process_event(session, 1, crash(value="total is not defined", stack=other))

    assert len(session.exec(select(Issue)).all()) == 2


def test_resolved_issue_regresses_when_it_returns(session):
    issue, _ = process_event(session, 1, crash())
    issue.status = "resolved"
    session.add(issue)
    session.commit()

    issue, is_new = process_event(session, 1, crash())
    assert not is_new
    assert issue.status == "regressed"
