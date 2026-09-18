from types import SimpleNamespace

import pytest
from sqlmodel import Session, SQLModel, create_engine

from backend.models import User
from core import billing


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def user(session, email="dev@example.com", **kw):
    u = User(email=email, password_hash="x", **kw)
    session.add(u)
    session.commit()
    session.refresh(u)
    return u


class FakeStripeObject(dict):
    """A real Stripe Event's nested object supports [] and .to_dict(), but
    NOT .get() — this caught a live 500 the first time apply_event() ran
    against a genuine webhook, because every test here used a plain dict,
    which happily supports .get() and hid the bug completely. This double
    is deliberately awkward in the same way, so the regression can't
    reappear silently.
    """

    def get(self, *a, **k):
        raise AttributeError("'get' is a dict method, but a Session is not a dict.")

    def to_dict(self):
        return dict(self)


def stripe_event(kind: str, obj: dict) -> dict:
    """A Stripe Event behaves like a dict (event["type"], event["data"]...);
    building the real shape, with the nested object wrapped as
    FakeStripeObject rather than a plain dict, keeps apply_event exercised
    exactly as it runs against a genuine webhook payload."""
    return {"type": kind, "data": {"object": FakeStripeObject(obj)}}


class TestCustomerReuse:
    def test_creates_a_customer_once_and_reuses_it(self, session, monkeypatch):
        created = []
        monkeypatch.setattr(
            "core.billing.stripe.Customer.create",
            lambda **kw: created.append(kw) or SimpleNamespace(id="cus_123"),
        )
        u = user(session)

        first = billing._customer_id_for(session, u)
        second = billing._customer_id_for(session, u)

        assert first == second == "cus_123"
        assert len(created) == 1, "a second checkout attempt created a duplicate Stripe customer"


class TestApplyEvent:
    def test_checkout_completed_upgrades_by_client_reference_id(self, session):
        u = user(session)
        event = stripe_event(
            "checkout.session.completed",
            {"id": "cs_1", "client_reference_id": str(u.id), "customer": "cus_1", "subscription": "sub_1"},
        )

        billing.apply_event(session, event)

        session.refresh(u)
        assert u.plan == "pro"
        assert u.stripe_customer_id == "cus_1"
        assert u.stripe_subscription_id == "sub_1"

    def test_checkout_completed_falls_back_to_customer_id_lookup(self, session):
        """client_reference_id could be missing or stale; the customer id on
        the User row is the second way to resolve who this event is about."""
        u = user(session, stripe_customer_id="cus_2")
        event = stripe_event(
            "checkout.session.completed",
            {"id": "cs_2", "client_reference_id": None, "customer": "cus_2", "subscription": "sub_2"},
        )

        billing.apply_event(session, event)

        session.refresh(u)
        assert u.plan == "pro"

    def test_unresolvable_checkout_event_does_not_raise(self, session):
        """No matching user at all — must not 500 the webhook endpoint over
        a payload that can never be more than logged and dropped."""
        event = stripe_event(
            "checkout.session.completed",
            {"id": "cs_3", "client_reference_id": None, "customer": "cus_nobody", "subscription": "sub_3"},
        )
        billing.apply_event(session, event)  # must not raise

    def test_subscription_canceled_downgrades_to_free(self, session):
        u = user(session, plan="pro", stripe_customer_id="cus_3", stripe_subscription_id="sub_3")
        event = stripe_event(
            "customer.subscription.deleted", {"customer": "cus_3", "status": "canceled"}
        )

        billing.apply_event(session, event)

        session.refresh(u)
        assert u.plan == "free"

    def test_subscription_past_due_downgrades_to_free(self, session):
        """Any status short of active/trialing means the account should not
        be billed as Pro — enumerating every non-active Stripe status one by
        one would silently leave a new one on Pro forever."""
        u = user(session, plan="pro", stripe_customer_id="cus_4")
        event = stripe_event(
            "customer.subscription.updated", {"customer": "cus_4", "status": "past_due"}
        )

        billing.apply_event(session, event)

        session.refresh(u)
        assert u.plan == "free"

    def test_subscription_reactivated_upgrades_to_pro(self, session):
        u = user(session, plan="free", stripe_customer_id="cus_5")
        event = stripe_event(
            "customer.subscription.updated", {"customer": "cus_5", "status": "active"}
        )

        billing.apply_event(session, event)

        session.refresh(u)
        assert u.plan == "pro"

    def test_unrelated_event_types_are_ignored(self, session):
        u = user(session, plan="free")
        event = stripe_event("invoice.paid", {"customer": "cus_whatever"})
        billing.apply_event(session, event)  # must not raise
        session.refresh(u)
        assert u.plan == "free"
