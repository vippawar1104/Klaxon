import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db import init_db
from backend.routers import alerts, auth, billing, feedback, ingest, issues, loader, models_router, vcs
from core.worker import worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Set KLAXON_WORKER=0 to run the API without an in-process worker, when a
    # dedicated worker process drains the queue instead.
    run_worker = os.getenv("KLAXON_WORKER", "1") != "0"
    if run_worker:
        worker.start()
    try:
        yield
    finally:
        if run_worker:
            worker.stop()



app = FastAPI(title="Klaxon API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # The ingest endpoint is called from arbitrary customer origins by the
    # browser SDK, so it cannot be locked to the dashboard origin.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    # Cross-origin JS can only read CORS-safelisted response headers unless they
    # are named here. Without this the SDK's 429 handler cannot see Retry-After
    # and falls back to a fixed 60s mute, ignoring the backoff we just sent.
    expose_headers=["Retry-After", "X-Klaxon-Accepted"],
)


# Mounted at the root, not under /api: this URL is pasted into other people's
# HTML, so it stays as short as possible.
app.include_router(loader.router, tags=["loader"])

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(ingest.router, prefix="/api", tags=["ingest"])
app.include_router(issues.router, prefix="/api/issues", tags=["issues"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["alerts"])
app.include_router(models_router.router, prefix="/api/models", tags=["models"])
app.include_router(vcs.router, prefix="/api/vcs", tags=["vcs"])
app.include_router(feedback.router, prefix="/api/feedback", tags=["feedback"])
app.include_router(billing.router, prefix="/api/billing", tags=["billing"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
