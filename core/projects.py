"""Project provisioning.

Shared by signup and the projects endpoint so a project is never created
without its alert rules — an account whose first project had no rules would
collect issues silently and never notify anyone.
"""

import os
import secrets

from sqlmodel import Session

from backend.models import Project
from core import alerts

DEFAULT_PROJECT_NAME = "my-app"


def new_public_key() -> str:
    """Generated server-side so a caller cannot choose a guessable key."""
    return f"pk_{secrets.token_urlsafe(24)}"


def default_origin() -> str:
    return os.getenv("KLAXON_INGEST_ORIGIN", "http://localhost:8000").rstrip("/")


def origin_from_request(request) -> str:
    """Where the browser SDK should post, as seen from outside.

    Derived from the request the dashboard just made, so a tunnel or a proxy
    works with no configuration: the forwarded headers already carry the public
    scheme and host. KLAXON_INGEST_ORIGIN still wins when set, for deployments
    that terminate somewhere the headers do not describe.
    """
    explicit = os.getenv("KLAXON_INGEST_ORIGIN")
    if explicit:
        return explicit.rstrip("/")

    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if not host:
        return default_origin()
    # A proxy chain lists each hop; the first is what the client actually used.
    scheme = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
    return f"{scheme}://{host}"


def dsn_for(project: Project, origin: str | None = None) -> str:
    """The string Klaxon.init() takes — identifies the project and where to post."""
    scheme, _, host = (origin or default_origin()).rstrip("/").partition("://")
    return f"{scheme}://{project.public_key}@{host}/{project.id}"


def loader_url_for(project: Project, origin: str | None = None) -> str:
    """Self-configuring script tag src — the whole integration, in one URL."""
    base = (origin or default_origin()).rstrip("/")
    return f"{base}/js/{project.id}/{project.public_key}.js"


def provision_project(session: Session, name: str, owner_id: int) -> Project:
    project = Project(name=name, public_key=new_public_key(), owner_id=owner_id)
    session.add(project)
    session.commit()
    session.refresh(project)

    for rule in alerts.default_rules(project.id):
        session.add(rule)
    session.commit()

    return project
