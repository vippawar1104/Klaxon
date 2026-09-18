import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from backend.db import get_session
from backend.main import app
from core.ratelimit import auth_limiter, feedback_limiter


@pytest.fixture
def client(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    # Both limiters are process-global singletons shared across every test file
    # in the run, and this file's tests do real signups — without resetting
    # auth_limiter too, budget left over from test_auth.py (or this file's own
    # earlier tests) eventually 429s a signup call here.
    feedback_limiter.reset()
    auth_limiter.reset()
    monkeypatch.setenv("KLAXON_OWNER_EMAIL", "owner@example.com")

    def override():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestSubmit:
    def test_accepted_without_an_account(self, client):
        res = client.post("/api/feedback", json={"message": "the dashboard is blank on Safari"})
        assert res.status_code == 201

    def test_email_is_optional(self, client):
        res = client.post("/api/feedback", json={"message": "no repro, just flagging"})
        assert res.status_code == 201

    def test_empty_message_rejected(self, client):
        res = client.post("/api/feedback", json={"message": ""})
        assert res.status_code == 422

    def test_missing_message_rejected(self, client):
        res = client.post("/api/feedback", json={"email": "a@b.com"})
        assert res.status_code == 422

    def test_oversized_message_rejected(self, client):
        res = client.post("/api/feedback", json={"message": "x" * 5000})
        assert res.status_code == 422

    def test_repeated_submissions_are_throttled(self, client):
        codes = [
            client.post("/api/feedback", json={"message": f"attempt {i}"}).status_code
            for i in range(10)
        ]
        assert 429 in codes, "unlimited feedback submissions from one source were allowed"
        assert codes[0] == 201, "a single normal submission must not be throttled"


class TestInbox:
    def test_requires_auth(self, client):
        assert client.get("/api/feedback").status_code == 401

    def test_non_owner_gets_404_not_403(self, client):
        signup = client.post(
            "/api/auth/signup", json={"email": "someone@example.com", "password": "hunter2hunter2"}
        )
        token = signup.json()["token"]
        res = client.get("/api/feedback", headers={"Authorization": f"Bearer {token}"})
        # 404, not 403: the endpoint's existence isn't confirmed to a caller
        # who isn't allowed to use it.
        assert res.status_code == 404

    def test_owner_can_read_submissions(self, client):
        client.post("/api/feedback", json={"message": "found a bug", "email": "reporter@x.com"})
        signup = client.post(
            "/api/auth/signup", json={"email": "owner@example.com", "password": "hunter2hunter2"}
        )
        token = signup.json()["token"]

        res = client.get("/api/feedback", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        body = res.json()
        assert len(body) == 1
        assert body[0]["message"] == "found a bug"
        assert body[0]["email"] == "reporter@x.com"

    def test_owner_email_match_is_case_insensitive(self, client, monkeypatch):
        monkeypatch.setenv("KLAXON_OWNER_EMAIL", "Owner@Example.com")
        signup = client.post(
            "/api/auth/signup", json={"email": "owner@example.com", "password": "hunter2hunter2"}
        )
        token = signup.json()["token"]
        res = client.get("/api/feedback", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200

    def test_unset_owner_email_locks_everyone_out(self, client, monkeypatch):
        monkeypatch.delenv("KLAXON_OWNER_EMAIL", raising=False)
        signup = client.post(
            "/api/auth/signup", json={"email": "owner@example.com", "password": "hunter2hunter2"}
        )
        token = signup.json()["token"]
        res = client.get("/api/feedback", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 404
