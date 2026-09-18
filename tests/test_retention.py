from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from backend.models import Alert, AuthSession, Event, Issue, Project, SeenEvent, User
from core import retention


def days_ago(n: int) -> datetime:
    # Naive UTC, matching how these columns are stored.
    return (datetime.now(timezone.utc) - timedelta(days=n)).replace(tzinfo=None)


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(Project(id=1, name="shop", public_key="pk_test"))
        s.add(User(id=1, email="a@b.test", password_hash="x"))
        s.add(Issue(id=1, project_id=1, fingerprint="fp", type="TypeError", value="boom"))
        s.commit()
        yield s


class TestPurge:
    def test_old_dedup_ledger_rows_go(self, session):
        """The ledger is one row per event — by far the largest table."""
        session.add(SeenEvent(project_id=1, event_id="old", fingerprint="fp",
                              received_at=days_ago(3)))
        session.add(SeenEvent(project_id=1, event_id="new", fingerprint="fp",
                              received_at=days_ago(0)))
        session.commit()

        retention.purge(session)

        left = [r.event_id for r in session.exec(select(SeenEvent)).all()]
        assert left == ["new"]

    def test_recent_ledger_rows_survive_so_dedup_still_works(self, session):
        """Purging inside the retry window would re-open the bug it guards.

        An SDK retry must still be recognised as a duplicate; that only holds
        while its ledger row is present.
        """
        session.add(SeenEvent(project_id=1, event_id="justnow", fingerprint="fp",
                              received_at=days_ago(0)))
        session.commit()

        retention.purge(session)

        assert session.exec(select(SeenEvent)).one().event_id == "justnow"

    def test_old_payloads_go_but_recent_ones_stay(self, session):
        session.add(Event(issue_id=1, project_id=1, event_id="old", payload="{}",
                          received_at=days_ago(40)))
        session.add(Event(issue_id=1, project_id=1, event_id="recent", payload="{}",
                          received_at=days_ago(2)))
        session.commit()

        retention.purge(session)

        assert [e.event_id for e in session.exec(select(Event)).all()] == ["recent"]

    def test_expired_sessions_go_valid_ones_stay(self, session):
        session.add(AuthSession(user_id=1, token="dead", expires_at=days_ago(1)))
        session.add(AuthSession(user_id=1, token="live",
                                expires_at=days_ago(-7)))  # 7 days in the future
        session.commit()

        retention.purge(session)

        assert [s.token for s in session.exec(select(AuthSession)).all()] == ["live"]

    def test_issues_are_never_purged(self, session):
        """The counter on an issue is the product; deleting it rewrites history.

        There is one row per distinct bug rather than per event, so they do not
        drive growth in the first place.
        """
        old = Issue(project_id=1, fingerprint="ancient", type="TypeError", value="old bug",
                    times_seen=5000, first_seen=days_ago(400), last_seen=days_ago(400))
        session.add(old)
        session.commit()

        retention.purge(session)

        assert session.exec(select(Issue).where(Issue.fingerprint == "ancient")).one()

    def test_purge_reports_what_it_removed(self, session):
        session.add(SeenEvent(project_id=1, event_id="old", fingerprint="fp",
                              received_at=days_ago(3)))
        session.commit()

        removed = retention.purge(session)

        assert removed["seenevent"] == 1
        assert removed["event"] == 0

    def test_purge_on_an_empty_database_is_a_no_op(self, session):
        assert retention.purge(session) == {
            "seenevent": 0, "event": 0, "alert": 0, "authsession": 0
        }
