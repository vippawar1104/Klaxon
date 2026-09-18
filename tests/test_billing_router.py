from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from backend.db import get_session
from backend.main import app
from core.ratelimit import auth_limiter


@pytest.fixture
def client():
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
        yield c
    app.dependency_overrides.clear()


CREDS = {"email": "dev@example.com", "password": "hunter2hunter2"}
URLS = {"success_url": "http://localhost:5173/billing/success", "cancel_url": "http://localhost:5173/pricing"}


def signed_in(client):
    return client.post("/api/auth/signup", json=CREDS).json()["token"]


class TestNotConfigured:
    """A fresh clone with no Stripe env vars — must fail clearly, not with a
    raw SDK exception."""

    def test_checkout_503s_without_stripe_configured(self, client, monkeypatch):
        monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "")
        token = signed_in(client)
        res = client.post(
            "/api/billing/checkout", json=URLS, headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code == 503


class TestAuth:
    def test_checkout_requires_signin(self, client):
        assert client.post("/api/billing/checkout", json=URLS).status_code == 401

    def test_status_requires_signin(self, client):
        assert client.get("/api/billing/status").status_code == 401

    def test_status_defaults_to_free(self, client):
        token = signed_in(client)
        res = client.get("/api/billing/status", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["plan"] == "free"


class TestCheckout:
    def test_creates_a_session_and_returns_its_url(self, client, monkeypatch):
        monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "price_test")
        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
        monkeypatch.setattr(
            "core.billing.stripe.Customer.create", lambda **kw: SimpleNamespace(id="cus_1")
        )
        monkeypatch.setattr(
            "core.billing.stripe.checkout.Session.create",
            lambda **kw: SimpleNamespace(url="https://checkout.stripe.com/pay/cs_test_1"),
        )

        token = signed_in(client)
        res = client.post(
            "/api/billing/checkout", json=URLS, headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code == 200
        assert res.json()["url"].startswith("https://checkout.stripe.com/")

    def test_rejects_a_relative_success_url(self, client, monkeypatch):
        monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "price_test")
        token = signed_in(client)
        res = client.post(
            "/api/billing/checkout",
            json={"success_url": "/not-absolute", "cancel_url": URLS["cancel_url"]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 400


class TestPortal:
    def test_requires_an_existing_customer(self, client, monkeypatch):
        monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "price_test")
        token = signed_in(client)
        res = client.post(
            "/api/billing/portal", json=URLS, headers={"Authorization": f"Bearer {token}"}
        )
        # Never checked out yet — no Stripe customer to manage.
        assert res.status_code == 400


class TestWebhook:
    def test_bad_signature_is_refused(self, client, monkeypatch):
        monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "price_test")
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
        res = client.post(
            "/api/billing/webhook",
            content=b'{"type": "checkout.session.completed"}',
            headers={"stripe-signature": "not-a-real-signature"},
        )
        assert res.status_code == 400

    def test_verified_event_is_applied(self, client, monkeypatch):
        monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "price_test")
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")

        token = signed_in(client)
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
        user_id = me["user_id"]

        event = {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_1", "client_reference_id": str(user_id),
                    "customer": "cus_1", "subscription": "sub_1",
                }
            },
        }
        # Bypasses real HMAC verification (no genuine Stripe secret in a unit
        # test) while still exercising the router's parsing and apply_event
        # call exactly as a real, verified webhook would.
        monkeypatch.setattr("core.billing.construct_event", lambda payload, sig: event)

        res = client.post(
            "/api/billing/webhook",
            content=b"irrelevant, construct_event is mocked",
            headers={"stripe-signature": "whatever"},
        )
        assert res.status_code == 200

        status = client.get(
            "/api/billing/status", headers={"Authorization": f"Bearer {token}"}
        ).json()
        assert status["plan"] == "pro"
