import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlmodel import Session, select

from backend.db import get_session
from backend.models import PendingEvent, Project, User
from backend.routers.auth import current_user
from backend.schemas import EventIngest, IngestAccepted, ProjectCreate
from core.projects import dsn_for, loader_url_for, origin_from_request, provision_project
from core.ratelimit import limiter
from core.worker import queue_depth

router = APIRouter()


def _project_from_key(session: Session, project_id: int, key: str) -> Project:
    project = session.get(Project, project_id)
    # Compared as bytes: compare_digest raises TypeError on a str with any
    # non-ASCII character, and the key arrives from a header or query string
    # the caller controls — a 500 where a 403 belongs.
    matches = project and key and secrets.compare_digest(project.public_key.encode(), key.encode())
    if not matches:
        # Same response for "no such project" and "wrong key", so the endpoint
        # cannot be used to enumerate project ids.
        raise HTTPException(status_code=403, detail="Invalid project or key")
    return project


@router.post("/{project_id}/store", response_model=IngestAccepted, status_code=202)
def store_event(
    project_id: int,
    payload: EventIngest,
    response: Response,
    key: str = "",
    x_klaxon_key: str = Header(default=""),
    session: Session = Depends(get_session),
):
    """Accept one crash report.

    Returns 202 rather than 200: the event is accepted for processing. The key
    arrives as a header normally, or as a query param from the SDK's sendBeacon
    path, which cannot set headers.
    """
    _project_from_key(session, project_id, x_klaxon_key or key)

    allowed, retry_after = limiter.allow(project_id)
    if not allowed:
        # A well-behaved client backs off on this instead of retry-storming a
        # service that is already under load.
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(retry_after)},
        )

    # The only work on the request thread: one insert. Parsing, fingerprinting,
    # grouping and alerting all happen on the worker.
    session.add(
        PendingEvent(
            project_id=project_id,
            event_id=payload.event_id,
            payload=payload.model_dump_json(),
        )
    )
    session.commit()

    response.headers["X-Klaxon-Accepted"] = payload.event_id
    return IngestAccepted(event_id=payload.event_id)


@router.get("/queue")
def queue_status(user: User = Depends(current_user)):
    """Backlog waiting on the worker — the number that grows under a spike
    instead of ingest latency.

    Signed-in only: the depth is a live read on how much traffic this
    deployment is taking, which is not anonymous-readable.
    """
    return {"pending": queue_depth()}


@router.get("/projects")
def list_projects(
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Only the caller's own projects.

    This response carries public_key, which authorises writing events. Before
    scoping, it returned every project to anyone — handing out the ingest keys
    of every other account.
    """
    origin = origin_from_request(request)
    projects = session.exec(select(Project).where(Project.owner_id == user.id)).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "public_key": p.public_key,
            "created_at": p.created_at,
            "dsn": dsn_for(p, origin),
            "loader_url": loader_url_for(p, origin),
        }
        for p in projects
    ]


@router.post("/projects", status_code=201)
def create_project(
    body: ProjectCreate,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Create a project and its default alert rules.

    The key is generated here rather than supplied, so a caller cannot choose a
    guessable one.
    """
    origin = origin_from_request(request)
    project = provision_project(session, body.name, user.id)

    return {
        "id": project.id,
        "name": project.name,
        "public_key": project.public_key,
        "created_at": project.created_at,
        "dsn": dsn_for(project, origin),
        "loader_url": loader_url_for(project, origin),
    }
