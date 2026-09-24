import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from backend.db import get_session
from backend.deps import get_ai_router, owned_issue, owned_project, require_active_account
from backend.models import Event, Issue, User
from backend.routers.auth import current_user
from core.ai_router import (
    PROVIDER_ENV,
    PROVIDER_LABEL,
    AIModelRouter,
    AIModelUnavailable,
)
from core.triage import TriageFailed, run_triage

router = APIRouter()

OPEN_STATUSES = ("unresolved", "regressed")


@router.get("")
def list_issues(
    project_id: int,
    status: str = "open",
    limit: int = 50,
    session: Session = Depends(get_session),
    user: User = Depends(require_active_account),
):
    # Crash reports carry request URLs, user context and stack traces from
    # someone's production traffic: they are readable only by the account that
    # owns the project, never by anyone who can guess a project id.
    owned_project(session, user, project_id)

    query = select(Issue).where(Issue.project_id == project_id)
    if status == "open":
        query = query.where(Issue.status.in_(OPEN_STATUSES))  # type: ignore[attr-defined]
    elif status != "all":
        query = query.where(Issue.status == status)

    issues = session.exec(query.order_by(Issue.last_seen.desc()).limit(limit)).all()  # type: ignore[attr-defined]
    return [
        {
            "id": i.id,
            "type": i.type,
            "value": i.value,
            "culprit": i.culprit,
            "level": i.level,
            "status": i.status,
            "times_seen": i.times_seen,
            "first_seen": i.first_seen,
            "last_seen": i.last_seen,
            "ai_severity": i.ai_severity,
        }
        for i in issues
    ]


@router.get("/{issue_id}")
def get_issue(
    issue_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_active_account),
):
    issue = owned_issue(session, user, issue_id)

    latest = session.exec(
        select(Event)
        .where(Event.issue_id == issue_id)
        .order_by(Event.received_at.desc())  # type: ignore[attr-defined]
        .limit(1)
    ).first()

    return {
        "id": issue.id,
        "fingerprint": issue.fingerprint,
        "type": issue.type,
        "value": issue.value,
        "culprit": issue.culprit,
        "level": issue.level,
        "status": issue.status,
        "times_seen": issue.times_seen,
        "first_seen": issue.first_seen,
        "last_seen": issue.last_seen,
        "latest_event": json.loads(latest.payload) if latest else None,
        "triage": _stored_triage(issue),
    }


def _stored_triage(issue: Issue) -> dict | None:
    if not issue.ai_explained_at:
        return None
    return {
        "root_cause": issue.ai_root_cause,
        "severity": issue.ai_severity,
        "suggested_fix": issue.ai_fix,
        "confidence": issue.ai_confidence,
        "model": issue.ai_model,
        "cached": True,
    }


@router.post("/{issue_id}/explain")
def explain_issue(
    issue_id: int,
    refresh: bool = False,
    session: Session = Depends(get_session),
    user: User = Depends(require_active_account),
    ai_router: AIModelRouter = Depends(get_ai_router),
):
    """Ask the configured LLM to explain the stack trace.

    Strictly off the ingest path — an optional triage aid, never a dependency
    of grouping or alerting.
    """
    # Owner-only: this ships someone else's stack trace to a third-party model
    # on a paid API key, so it must not be callable for an arbitrary issue id.
    issue = owned_issue(session, user, issue_id)

    # A verdict already on the row costs nothing to return; only an explicit
    # ?refresh=true pays for another model call.
    stored = _stored_triage(issue)
    if stored and not refresh:
        return {"issue_id": issue_id, **stored}

    latest = session.exec(
        select(Event)
        .where(Event.issue_id == issue_id)
        .order_by(Event.received_at.desc())  # type: ignore[attr-defined]
        .limit(1)
    ).first()

    payload = json.loads(latest.payload) if latest else {}
    trace = payload.get("stacktrace") or "(no stack trace captured)"
    crumbs = "\n".join(
        f"  {c.get('category')}: {c.get('message')}" for c in payload.get("breadcrumbs", [])[-10:]
    )

    prompt = (
        f"A production JavaScript error fired {issue.times_seen:,} times.\n\n"
        f"Type: {issue.type}\nMessage: {issue.value}\nCulprit: {issue.culprit}\n\n"
        f"Stack trace:\n{trace}\n\n"
        f"Breadcrumbs leading up to it:\n{crumbs or '  (none)'}\n\n"
        "Give the most likely root cause and the single change most likely to fix "
        "it, each in under 60 words. If the trace is insufficient, say what is "
        "missing in the root cause and lower the confidence."
    )

    model = ai_router.default_model()
    try:
        verdict = run_triage(ai_router, prompt)
    except AIModelUnavailable as e:
        # 503 rather than 500: the service is fine, the optional model is not.
        raise HTTPException(status_code=503, detail=str(e)) from e
    except TriageFailed as e:
        # 502: the upstream answered, but with something we refuse to store.
        raise HTTPException(status_code=502, detail=str(e)) from e

    env = PROVIDER_ENV[model][0] if model else ""
    label = PROVIDER_LABEL.get(env, "AI")
    issue.ai_severity = verdict.severity
    issue.ai_confidence = verdict.confidence
    issue.ai_root_cause = verdict.root_cause
    issue.ai_fix = verdict.suggested_fix
    # Reported so the UI never has to guess which provider answered.
    issue.ai_model = f"{label} · {model.value}" if model else label
    issue.ai_explained_at = datetime.now(timezone.utc)
    session.add(issue)
    session.commit()
    return {"issue_id": issue_id, **_stored_triage(issue), "cached": False}


@router.post("/{issue_id}/status")
def set_status(
    issue_id: int,
    status: str,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    if status not in ("unresolved", "resolved", "ignored"):
        raise HTTPException(status_code=400, detail="Unknown status")

    issue = owned_issue(session, user, issue_id)
    issue.status = status
    session.add(issue)
    session.commit()
    return {"id": issue.id, "status": issue.status}
