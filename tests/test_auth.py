import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from backend.db import get_session
from backend.main import app
from core import auth
from core.ratelimit import auth_limiter


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    # The credential throttle is process-global and every test arrives from the
    # same client address, so without this each test inherits the token budget
    # the previous ones spent and the suite fails by position rather than by
    # behaviour.
    auth_limiter.reset()

    def override():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


CREDS = {"email": "dev@example.com", "password": "hunter2hunter2"}


class TestPasswordHashing:
    def test_roundtrip(self):
        encoded = auth.hash_password("correct horse battery staple")
        assert auth.verify_password("correct horse battery staple", encoded)

    def test_wrong_password_rejected(self):
        encoded = auth.hash_password("one")
        assert not auth.verify_password("two", encoded)

    def test_hash_is_salted(self):
        """Two users with the same password must not share a hash."""
        assert auth.hash_password("same") != auth.hash_password("same")

    def test_plaintext_never_stored(self):
        encoded = auth.hash_password("s3cret-value")
        assert "s3cret-value" not in encoded

    def test_malformed_hash_rejected(self):
        assert not auth.verify_password("x", "not-a-real-hash")


class TestSignup:
    def test_creates_account_and_returns_token(self, client):
        res = client.post("/api/auth/signup", json=CREDS)
        assert res.status_code == 201
        assert res.json()["token"]
        assert res.json()["email"] == "dev@example.com"

    def test_duplicate_email_rejected(self, client):
        client.post("/api/auth/signup", json=CREDS)
        assert client.post("/api/auth/signup", json=CREDS).status_code == 409

    def test_email_is_case_insensitive(self, client):
        client.post("/api/auth/signup", json=CREDS)
        dupe = {**CREDS, "email": "DEV@Example.COM"}
        assert client.post("/api/auth/signup", json=dupe).status_code == 409

    def test_short_password_rejected(self, client):
        res = client.post("/api/auth/signup", json={**CREDS, "password": "short"})
        assert res.status_code == 422

    def test_invalid_email_rejected(self, client):
        res = client.post("/api/auth/signup", json={**CREDS, "email": "not-an-email"})
        assert res.status_code == 422


class TestLogin:
    def test_valid_credentials(self, client):
        client.post("/api/auth/signup", json=CREDS)
        assert client.post("/api/auth/login", json=CREDS).status_code == 200

    def test_wrong_password_rejected(self, client):
        client.post("/api/auth/signup", json=CREDS)
        res = client.post("/api/auth/login", json={**CREDS, "password": "wrongwrongwrong"})
        assert res.status_code == 401

    def test_unknown_email_rejected(self, client):
        res = client.post("/api/auth/login", json={**CREDS, "email": "nobody@example.com"})
        assert res.status_code == 401

    def test_error_does_not_reveal_whether_email_exists(self, client):
        client.post("/api/auth/signup", json=CREDS)
        wrong_pw = client.post("/api/auth/login", json={**CREDS, "password": "wrongwrongwrong"})
        no_user = client.post("/api/auth/login", json={**CREDS, "email": "nobody@example.com"})
        assert wrong_pw.json()["detail"] == no_user.json()["detail"]


class TestSession:
    def test_me_requires_token(self, client):
        assert client.get("/api/auth/me").status_code == 401

    def test_me_returns_user(self, client):
        token = client.post("/api/auth/signup", json=CREDS).json()["token"]
        res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["email"] == "dev@example.com"

    def test_garbage_token_rejected(self, client):
        res = client.get("/api/auth/me", headers={"Authorization": "Bearer nonsense"})
        assert res.status_code == 401

    def test_logout_revokes_the_token(self, client):
        token = client.post("/api/auth/signup", json=CREDS).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/auth/me", headers=headers).status_code == 200

        client.post("/api/auth/logout", headers=headers)
        assert client.get("/api/auth/me", headers=headers).status_code == 401


class TestCredentialThrottle:
    """Without a limit, the only cost of guessing is the hashing work factor —
    which the attacker pays in parallel and the server pays serially."""

    def test_repeated_wrong_passwords_are_eventually_refused(self, client):
        client.post("/api/auth/signup", json=CREDS)
        wrong = {"email": CREDS["email"], "password": "not-the-password"}

        codes = [client.post("/api/auth/login", json=wrong).status_code for _ in range(40)]

        assert 429 in codes, "unlimited password attempts were allowed"
        # The wall arrives after the burst, not on the first mistake: someone
        # mistyping their own password must never be thrown a 429.
        assert codes[0] == 401

    def test_a_throttled_response_says_when_to_retry(self, client):
        client.post("/api/auth/signup", json=CREDS)
        wrong = {"email": CREDS["email"], "password": "not-the-password"}

        last = None
        for _ in range(40):
            last = client.post("/api/auth/login", json=wrong)
            if last.status_code == 429:
                break

        assert last is not None and last.status_code == 429
        assert int(last.headers["Retry-After"]) >= 1

    def test_signup_is_throttled_too(self, client):
        """Otherwise the same budget is simply spent on the other endpoint."""
        codes = [
            client.post("/api/auth/signup", json={"email": f"u{i}@x.test",
                                                  "password": "hunter2hunter2"}).status_code
            for i in range(40)
        ]
        assert 429 in codes
