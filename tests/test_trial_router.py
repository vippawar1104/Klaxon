from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from backend.db import get_session
from backend.main import app
from backend.models import User
from core.ratelimit import auth_limiter


@pytest.fixture
def client_and_engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    auth_limiter.reset()

    def override():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as c:
        yield c, engine
    app.dependency_overrides.clear()


@pytest.fixture
def client(client_and_engine):
    c, _ = client_and_engine
    return c


CREDS = {"email": "dev@example.com", "password": "hunter2hunter2"}


def signed_in(client):
    r = client.post("/api/auth/signup", json=CREDS)
    return r.json()["token"], r.json()["user_id"]


def set_trial_ends_at(engine, user_id: int, when) -> None:
    """Exactly the DB-level control the feature promises: an operator editing
    trial_ends_at directly, no API involved — and the very next request
    respects it, because nothing caches this."""
    with Session(engine) as s:
        user = s.get(User, user_id)
        user.trial_ends_at = when
        s.add(user)
        s.commit()


def set_plan(engine, user_id: int, plan: str) -> None:
    with Session(engine) as s:
        user = s.get(User, user_id)
        user.plan = plan
        s.add(user)
        s.commit()


class TestFreshSignup:
    def test_a_new_signup_can_use_the_dashboard_immediately(self, client):
        token, _ = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        pid = client.get("/api/projects", headers=headers).json()[0]["id"]

        assert client.get(f"/api/issues?project_id={pid}", headers=headers).status_code == 200
        assert client.get(f"/api/alerts?project_id={pid}", headers=headers).status_code == 200
        assert client.get(f"/api/alerts/rules?project_id={pid}", headers=headers).status_code == 200


class TestExpiredTrial:
    def test_issues_list_is_blocked_with_402_after_a_direct_db_edit(self, client_and_engine):
        client, engine = client_and_engine
        token, user_id = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        pid = client.get("/api/projects", headers=headers).json()[0]["id"]

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) - timedelta(days=1))

        res = client.get(f"/api/issues?project_id={pid}", headers=headers)
        assert res.status_code == 402

    def test_blocked_across_every_dashboard_read_endpoint(self, client_and_engine):
        client, engine = client_and_engine
        token, user_id = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        pid = client.get("/api/projects", headers=headers).json()[0]["id"]

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) - timedelta(days=1))

        assert client.get(f"/api/issues?project_id={pid}", headers=headers).status_code == 402
        assert client.get("/api/issues/1", headers=headers).status_code == 402
        assert client.get(f"/api/alerts?project_id={pid}", headers=headers).status_code == 402
        assert client.get(f"/api/alerts/rules?project_id={pid}", headers=headers).status_code == 402

    def test_ingest_keeps_accepting_events_for_an_expired_account(self, client_and_engine):
        """No crash data is ever lost to a lapsed trial — only the dashboard
        that reads it is gated."""
        client, engine = client_and_engine
        token, user_id = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        project = client.get("/api/projects", headers=headers).json()[0]

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) - timedelta(days=1))

        res = client.post(
            f"/api/{project['id']}/store?key={project['public_key']}",
            json={"event_id": "e" * 16, "type": "T", "value": "v"},
        )
        assert res.status_code == 202

    def test_billing_status_stays_reachable_when_expired(self, client_and_engine):
        """The one endpoint that MUST still work — it's how the frontend
        learns it's expired at all, and the way back to checkout."""
        client, engine = client_and_engine
        token, user_id = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) - timedelta(days=1))

        res = client.get("/api/billing/status", headers=headers)
        assert res.status_code == 200
        assert res.json()["expired"] is True

    def test_auth_me_stays_reachable_when_expired(self, client_and_engine):
        client, engine = client_and_engine
        token, user_id = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) - timedelta(days=1))

        assert client.get("/api/auth/me", headers=headers).status_code == 200


class TestDbControl:
    """The explicit ask: an operator must be able to change this by editing
    the database, without going anywhere near Stripe."""

    def test_a_pro_account_is_never_blocked_even_with_a_past_trial_date(self, client_and_engine):
        client, engine = client_and_engine
        token, user_id = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        pid = client.get("/api/projects", headers=headers).json()[0]["id"]

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) - timedelta(days=1))
        set_plan(engine, user_id, "pro")

        assert client.get(f"/api/issues?project_id={pid}", headers=headers).status_code == 200

    def test_clearing_trial_ends_at_un_expires_a_free_account(self, client_and_engine):
        """The comp lever: NULL means "never expires", editable directly."""
        client, engine = client_and_engine
        token, user_id = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        pid = client.get("/api/projects", headers=headers).json()[0]["id"]

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) - timedelta(days=1))
        assert client.get(f"/api/issues?project_id={pid}", headers=headers).status_code == 402

        set_trial_ends_at(engine, user_id, None)
        assert client.get(f"/api/issues?project_id={pid}", headers=headers).status_code == 200

    def test_extending_trial_ends_at_un_expires_a_free_account(self, client_and_engine):
        client, engine = client_and_engine
        token, user_id = signed_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        pid = client.get("/api/projects", headers=headers).json()[0]["id"]

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) - timedelta(days=1))
        assert client.get(f"/api/issues?project_id={pid}", headers=headers).status_code == 402

        set_trial_ends_at(engine, user_id, datetime.now(timezone.utc) + timedelta(days=30))
        assert client.get(f"/api/issues?project_id={pid}", headers=headers).status_code == 200
