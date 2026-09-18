from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class Breadcrumb(BaseModel):
    timestamp: Optional[float] = None
    category: Optional[str] = None
    message: Optional[str] = None
    level: str = "info"


class EventIngest(BaseModel):
    """The payload an SDK submits. Kept permissive: a crash report that fails
    validation is a crash report you lost."""

    event_id: str = Field(min_length=8, max_length=64)
    type: str = "Error"
    value: str = ""
    stacktrace: Optional[str] = None
    level: str = "error"
    environment: str = "production"
    release: Optional[str] = None
    url: Optional[str] = None
    breadcrumbs: List[Breadcrumb] = Field(default_factory=list, max_length=50)
    tags: Dict[str, str] = Field(default_factory=dict)
    user: Optional[Dict[str, Any]] = None


class IngestAccepted(BaseModel):
    event_id: str
    status: str = "queued"


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class Credentials(BaseModel):
    # Pattern rather than EmailStr so the project stays free of the
    # email-validator dependency.
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=200)


class AuthResponse(BaseModel):
    token: str
    email: str
    user_id: int


class CheckoutRequest(BaseModel):
    # The frontend's own origin — the API has no reliable way to know where
    # the dashboard is actually served from (dev vs. prod are different
    # origins), so the client, which does know, supplies where Stripe should
    # send the browser back to.
    success_url: str = Field(min_length=1, max_length=500)
    cancel_url: str = Field(min_length=1, max_length=500)


class FeedbackCreate(BaseModel):
    # No email pattern enforced, unlike Credentials: a malformed address here
    # just means no reply is possible, never a security boundary, and
    # rejecting a typo'd address would lose a real bug report over nothing.
    email: Optional[str] = Field(default=None, max_length=254)
    message: str = Field(min_length=1, max_length=4000)
    page_url: Optional[str] = Field(default=None, max_length=500)


class AlertRuleCreate(BaseModel):
    kind: str = "new_issue"  # new_issue | regression | volume
    threshold: int = Field(default=100, ge=1)
    window_s: int = Field(default=300, ge=10)
    cooldown_s: int = Field(default=3600, ge=0)
    channel: str = "console"  # console | webhook
    target: Optional[str] = None
    enabled: bool = True
