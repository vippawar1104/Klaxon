import os

from dotenv import load_dotenv
from fastapi import Depends, HTTPException
from sqlmodel import Session

# Must run before AIModelRouter is constructed below: it reads provider API keys
# via os.getenv() at construction time.
load_dotenv()

from backend.models import Issue, Project, User  # noqa: E402
from backend.routers.auth import current_user  # noqa: E402
from core import billing  # noqa: E402
from core.ai_router import AIModelRouter  # noqa: E402
from core.vcs import VersionControlIntegration  # noqa: E402

# Single process-lifetime instances. Used by the AI triage layer (explaining a
# stack trace) and by culprit-to-commit lookups; neither is on the ingest path.
ai_router = AIModelRouter()
vcs = VersionControlIntegration(".", ai_router)


def get_ai_router() -> AIModelRouter:
    return ai_router


def get_vcs() -> VersionControlIntegration:
    return vcs


def require_active_account(user: User = Depends(current_user)) -> User:
    """current_user, plus: refuses a free account whose trial is over.

    402 Payment Required — the status code that exists for exactly this,
    rather than reusing 403 (which means "you may never have this",
    not "not yet, until you pay"). Applied only to the dashboard's read
    endpoints (issues, alerts): ingest keeps accepting events regardless, so
    a lapsed trial never loses crash data, and billing/auth/projects stay
    reachable so the account can actually see the DSN and upgrade.
    """
    if billing.is_expired(user):
        raise HTTPException(status_code=402, detail="Your free trial has ended")
    return user


def owned_project(session: Session, user: User, project_id: int) -> Project:
    """The caller's project, or 404.

    404 rather than 403 for a project that exists but belongs to someone else:
    a distinct status is itself an oracle for which project ids are real.
    A project with no owner (created before accounts existed, on an install
    with more than one account) matches no user id, so it is reachable by
    nobody until `scripts/claim_projects.py` assigns it.
    """
    project = session.get(Project, project_id)
    if not project or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def require_site_owner(user: User) -> None:
    """The feedback inbox has no per-project scoping to fall back on — it isn't
    tied to a project at all — so access is keyed off KLAXON_OWNER_EMAIL rather
    than "account id 1": on an instance with any real signup history (test
    accounts, a demo run, anyone else signing up first) the earliest row is
    not reliably the operator. Refused as 404, not 403, so the endpoint's
    existence isn't confirmed to an account that isn't allowed to use it.
    """
    owner_email = os.getenv("KLAXON_OWNER_EMAIL", "")
    if not owner_email or user.email.lower() != owner_email.lower():
        raise HTTPException(status_code=404, detail="Not found")


def owned_issue(session: Session, user: User, issue_id: int) -> Issue:
    """The issue, only if the caller owns the project it belongs to."""
    issue = session.get(Issue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    project = session.get(Project, issue.project_id)
    if not project or project.owner_id != user.id:
        # Same 404 as a missing issue, for the same reason.
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue
