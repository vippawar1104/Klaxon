"""One-line SDK install.

Serves the browser SDK with init() already applied for a given project, so
integrating Klaxon is a single script tag with nothing to configure:

    <script src="https://your-klaxon.app/js/1/pk_xxx.js"></script>

Hosting the SDK here rather than making each customer copy klaxon.js into their
own static assets removes the step most likely to stop someone, and closes the
gap between the script loading and init() running — errors thrown in that gap
were silently uncapturable.
"""

import json
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session

from backend.db import get_session
from backend.models import Project
from core.projects import dsn_for, origin_from_request

router = APIRouter()

SDK_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "sdk",
    "klaxon.js",
)

# Long enough that the SDK is not refetched on every page view, short enough
# that a fix ships within the hour. The URL is stable, so it cannot be busted
# by a version in the path.
CACHE_SECONDS = 3600

_sdk_source: str | None = None


def _sdk() -> str:
    """Read once and hold it. The file does not change while the server runs."""
    global _sdk_source
    if _sdk_source is None:
        with open(SDK_PATH, encoding="utf-8") as f:
            _sdk_source = f.read()
    return _sdk_source


@router.get("/js/{project_id}/{public_key}.js")
def sdk_for_project(
    project_id: int,
    public_key: str,
    request: Request,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    # Bytes, not str: compare_digest raises TypeError on non-ASCII text, and
    # this key comes straight out of the URL path.
    if not project or not secrets.compare_digest(
        project.public_key.encode(), public_key.encode()
    ):
        # Same response for both, so the route cannot be used to enumerate
        # project ids — matching the ingest endpoint's behaviour.
        raise HTTPException(status_code=404, detail="Not found")

    dsn = dsn_for(project, origin_from_request(request))

    # json.dumps rather than interpolation: the DSN reaches the browser as a
    # string literal that cannot terminate early and inject script.
    bootstrap = (
        "\n;(function () {\n"
        "  if (typeof window === 'undefined' || !window.Klaxon) return;\n"
        f"  window.Klaxon.init({{ dsn: {json.dumps(dsn)} }});\n"
        "})();\n"
    )

    return Response(
        content=_sdk() + bootstrap,
        media_type="application/javascript; charset=utf-8",
        headers={
            "Cache-Control": f"public, max-age={CACHE_SECONDS}",
            # Loaded cross-origin from customer sites by definition.
            "Access-Control-Allow-Origin": "*",
        },
    )
