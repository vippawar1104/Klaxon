import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from backend.db import get_session
from backend.models import User
from backend.routers.auth import current_user
from backend.schemas import CheckoutRequest
from core import billing

logger = logging.getLogger(__name__)
router = APIRouter()


def _require_configured() -> None:
    if not billing.configured():
        # 503, not 500: the service is fine, billing just isn't set up on
        # this instance — the same posture the AI explain feature takes when
        # no provider key is configured.
        raise HTTPException(status_code=503, detail="Billing is not configured on this instance")


@router.get("/status")
def status(user: User = Depends(current_user)):
    # current_user, not require_active_account: an expired account must still
    # be able to see its own status — that is precisely how the frontend
    # learns it is expired and shows the upgrade screen in the first place.
    return {
        "plan": user.plan,
        "trial_ends_at": user.trial_ends_at,
        "expired": billing.is_expired(user),
    }


@router.post("/checkout")
def checkout(
    body: CheckoutRequest,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Returns a Stripe-hosted Checkout URL. The browser redirects there —
    Stripe collects the card, not this server."""
    _require_configured()
    for url in (body.success_url, body.cancel_url):
        if not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="success_url/cancel_url must be absolute")

    try:
        url = billing.create_checkout_session(session, user, body.success_url, body.cancel_url)
    except stripe.error.StripeError as e:
        logger.error("checkout session creation failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not start checkout") from e
    return {"url": url}


@router.post("/portal")
def portal(
    body: CheckoutRequest,  # reused: only .success_url/.cancel_url shape is needed here too
    user: User = Depends(current_user),
):
    """Stripe's own hosted page for changing a card or cancelling."""
    _require_configured()
    if not user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No billing account yet — nothing to manage")
    if not body.success_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="success_url must be absolute")

    try:
        url = billing.create_portal_session(user, body.success_url)
    except stripe.error.StripeError as e:
        logger.error("portal session creation failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not open billing portal") from e
    return {"url": url}


@router.post("/webhook")
async def webhook(request: Request, session: Session = Depends(get_session)):
    """Stripe calls this, not a browser — no auth header, verified instead by
    the request's signature against STRIPE_WEBHOOK_SECRET. This is the only
    path that ever grants or revokes the "pro" plan.
    """
    _require_configured()
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")

    try:
        event = billing.construct_event(payload, signature)
    except (ValueError, stripe.error.SignatureVerificationError) as e:
        # 400, not 401/403: this endpoint has no concept of "who" — only
        # "provably from Stripe" or not.
        raise HTTPException(status_code=400, detail="Invalid webhook signature") from e

    billing.apply_event(session, event)
    return {"received": True}
