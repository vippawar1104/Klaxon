"""Stripe, isolated to one module.

Checkout is hosted by Stripe entirely — no card field ever touches this
server, so there is no PCI scope to worry about, and Google Pay / Apple Pay
show up in the Checkout button automatically whenever the browser supports
them, with no extra code here.

The webhook is the only thing that ever grants "pro" — never the client-side
redirect after checkout, which a signed-in user fully controls and could
revisit, bookmark, or replay. A user is on Pro because Stripe told the server
so, not because their browser landed on a success page.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

import stripe

from backend.models import User

TRIAL_DAYS = 14


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def start_trial() -> datetime:
    """Called once, at signup — see routers/auth.py."""
    return _utcnow() + timedelta(days=TRIAL_DAYS)


def is_expired(user: User) -> bool:
    """True only for a free account past its trial. A paying account never
    expires here regardless of trial_ends_at (Stripe, via the webhook, is
    the only thing that revokes "pro" — see apply_event below). NULL means
    "never expires", not "already expired" — the backfill migration leaves
    every pre-existing account this way, and an operator can grant the same
    by clearing the column directly in the database.
    """
    if user.plan == "pro":
        return False
    if user.trial_ends_at is None:
        return False
    return _utcnow() >= _aware(user.trial_ends_at)

logger = logging.getLogger(__name__)

def _sync_api_key() -> None:
    """Stripe's SDK reads its key off stripe.api_key, a module-level global
    it expects the caller to set. Refreshed on every call here rather than
    once at import time: a module-level `stripe.api_key = os.getenv(...)`
    bakes in whatever the environment was at the INSTANT this module first
    got imported, permanently, for the life of the process — if that happens
    before .env is loaded (import order is easy to get wrong, and this
    genuinely reordered itself under pytest depending on which test file
    happened to be collected first), Stripe silently runs unauthenticated
    forever. Re-reading `os.getenv` each call costs nothing and removes the
    dependency on import order entirely.
    """
    stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")


def _pro_price_id() -> str:
    return os.getenv("STRIPE_PRO_PRICE_ID", "")


def _webhook_secret() -> str:
    return os.getenv("STRIPE_WEBHOOK_SECRET", "")


def configured() -> bool:
    """False on a fresh clone with no Stripe env vars — callers use this to
    fail with a clear 503 rather than a confusing Stripe SDK error."""
    _sync_api_key()
    return bool(stripe.api_key and _pro_price_id())


def _customer_id_for(session, user: User) -> str:
    """Reuse the same Stripe Customer across repeated checkout attempts,
    rather than creating a new one every time someone clicks "upgrade" —
    duplicate customers is the single most common Stripe integration mistake,
    and it fragments a person's billing history across several records."""
    if user.stripe_customer_id:
        return user.stripe_customer_id

    customer = stripe.Customer.create(email=user.email, metadata={"klaxon_user_id": user.id})
    user.stripe_customer_id = customer.id
    session.add(user)
    session.commit()
    return customer.id


def create_checkout_session(session, user: User, success_url: str, cancel_url: str) -> str:
    """Returns the Checkout URL to redirect the browser to."""
    _sync_api_key()
    customer_id = _customer_id_for(session, user)
    checkout = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": _pro_price_id(), "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        # Belt and suspenders alongside customer=: the webhook handler looks
        # this up too, so a Customer record that somehow drifted from the
        # user row (manually edited in the Stripe dashboard, say) still
        # resolves to the right account.
        client_reference_id=str(user.id),
    )
    return checkout.url


def create_portal_session(user: User, return_url: str) -> str:
    """Stripe's own hosted page for updating a card or cancelling — nothing
    to build here beyond handing back the URL."""
    _sync_api_key()
    portal = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id, return_url=return_url
    )
    return portal.url


def construct_event(payload: bytes, signature: str) -> "stripe.Event":
    """Verifies the payload actually came from Stripe. Raises on a bad
    signature — the caller turns that into a 400, refusing anything that
    is not provably from Stripe rather than trusting the request body."""
    return stripe.Webhook.construct_event(payload, signature, _webhook_secret())


def apply_event(session, event: "stripe.Event") -> None:
    """The only place plan/subscription state is ever written."""
    from sqlmodel import select

    kind = event["type"]
    obj = event["data"]["object"]
    # A real Stripe Event's nested object is a typed StripeObject (e.g.
    # stripe.checkout.Session), not a plain dict — it supports attribute and
    # [] access but not .get(), so caught live the first time this ran
    # against an actual webhook rather than a hand-built test payload.
    # .to_dict() normalises both a real event and a plain-dict test double to
    # the same shape, so the rest of this function doesn't need to know which
    # one it received.
    if hasattr(obj, "to_dict"):
        obj = obj.to_dict()

    if kind == "checkout.session.completed":
        user_id = obj.get("client_reference_id")
        customer_id = obj.get("customer")
        user = None
        if user_id:
            user = session.get(User, int(user_id))
        if not user and customer_id:
            user = session.exec(select(User).where(User.stripe_customer_id == customer_id)).first()
        if not user:
            logger.error("checkout.session.completed for an unresolvable user: %s", obj.get("id"))
            return
        user.plan = "pro"
        user.stripe_customer_id = customer_id or user.stripe_customer_id
        user.stripe_subscription_id = obj.get("subscription")
        session.add(user)
        session.commit()

    elif kind in ("customer.subscription.deleted", "customer.subscription.updated"):
        customer_id = obj.get("customer")
        user = session.exec(select(User).where(User.stripe_customer_id == customer_id)).first()
        if not user:
            return
        status = obj.get("status")
        # Any status other than a genuinely active/trialing subscription
        # means the account should not be billed as Pro — canceled, unpaid,
        # incomplete_expired all fall back to free rather than being
        # enumerated one by one and risking a new Stripe status leaving an
        # account on Pro for free indefinitely.
        if status in ("active", "trialing"):
            user.plan = "pro"
        else:
            user.plan = "free"
        session.add(user)
        session.commit()

    else:
        # Stripe sends far more event types than this integration acts on —
        # ignoring the rest is correct, not a gap.
        pass
