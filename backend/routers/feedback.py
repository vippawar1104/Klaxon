import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from backend.db import get_session
from backend.deps import require_site_owner
from backend.models import Feedback, User
from backend.routers.auth import current_user
from backend.schemas import FeedbackCreate
from core import notify
from core.ratelimit import feedback_limiter

router = APIRouter()


@router.post("", status_code=201)
def submit_feedback(
    body: FeedbackCreate,
    request: Request,
    session: Session = Depends(get_session),
):
    """Public — no account needed. The whole point is that a visitor who hit a
    bug on the marketing site, and isn't signed in, can still report it."""
    source = request.client.host if request.client else "unknown"
    allowed, retry_after = feedback_limiter.allow(f"feedback:{source}")
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many submissions. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )

    feedback = Feedback(
        email=body.email or None,
        message=body.message,
        page_url=body.page_url,
        user_agent=request.headers.get("user-agent", "")[:300] or None,
    )
    session.add(feedback)
    session.commit()

    # Optional — without this set, a report still lands in the database and
    # is visible at the inbox; this is only "also ping someone right away".
    webhook_url = os.getenv("FEEDBACK_WEBHOOK_URL", "")
    if webhook_url:
        summary = f"🐞 New feedback: {feedback.message[:200]}"
        notify.enqueue(
            session,
            webhook_url,
            {
                # `text`/`content` cover Slack and Discord incoming webhooks
                # without any per-provider configuration; a custom endpoint
                # gets the structured fields below either way.
                "text": summary,
                "content": summary,
                "email": feedback.email,
                "message": feedback.message,
                "page_url": feedback.page_url,
                "created_at": feedback.created_at.isoformat(),
            },
        )

    return {"status": "received"}


@router.get("")
def list_feedback(
    limit: int = 100,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """The inbox side — restricted to KLAXON_OWNER_EMAIL, see require_site_owner."""
    require_site_owner(user)

    rows = session.exec(
        select(Feedback).order_by(Feedback.created_at.desc()).limit(limit)  # type: ignore[attr-defined]
    ).all()
    return [
        {
            "id": f.id,
            "email": f.email,
            "message": f.message,
            "page_url": f.page_url,
            "created_at": f.created_at,
        }
        for f in rows
    ]
