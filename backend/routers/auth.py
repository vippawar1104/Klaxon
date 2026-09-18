import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlmodel import Session, select

from backend.db import get_session
from backend.models import User
from backend.schemas import AuthResponse, Credentials
from core import auth, billing
from core.projects import DEFAULT_PROJECT_NAME, provision_project
from core.ratelimit import auth_limiter

router = APIRouter()


def _throttle_credentials(request: Request) -> None:
    """Bound how fast one source can try passwords.

    Without this the only cost of guessing is the PBKDF2 work factor, which is
    a per-attempt cost the attacker pays in parallel, not a limit on attempts.
    Keyed on the source address so hammering one account cannot lock its owner
    out — the bucket belongs to the caller, not the target.
    """
    source = request.client.host if request.client else "unknown"
    allowed, retry_after = auth_limiter.allow(f"auth:{source}")
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )


def _token_from_header(authorization: str) -> str:
    scheme, _, token = authorization.partition(" ")
    return token if scheme.lower() == "bearer" else ""


def current_user(
    authorization: str = Header(default=""),
    session: Session = Depends(get_session),
) -> User:
    """Dependency for routes that require a signed-in user."""
    user = auth.user_for_token(session, _token_from_header(authorization))
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.post("/signup", response_model=AuthResponse, status_code=201)
def signup(body: Credentials, request: Request, session: Session = Depends(get_session)):
    _throttle_credentials(request)
    email = auth.normalise_email(body.email)

    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=409, detail="That email is already registered")

    # Every new signup starts a real trial clock — only accounts that existed
    # before this feature shipped are grandfathered as "never expires" by the
    # backfill migration.
    user = User(
        email=email,
        password_hash=auth.hash_password(body.password),
        trial_ends_at=billing.start_trial(),
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    # A first project, so the new account lands on setup instructions with a
    # real DSN rather than an empty dashboard and no way to create one.
    provision_project(session, DEFAULT_PROJECT_NAME, user.id)

    token = auth.create_session(session, user).token
    return AuthResponse(token=token, email=user.email, user_id=user.id)


@router.post("/login", response_model=AuthResponse)
def login(body: Credentials, request: Request, session: Session = Depends(get_session)):
    _throttle_credentials(request)
    email = auth.normalise_email(body.email)
    user = session.exec(select(User).where(User.email == email)).first()

    # Hash even when the user does not exist, so response time does not reveal
    # which emails are registered.
    stored = user.password_hash if user else auth.hash_password(secrets.token_urlsafe(16))
    if not auth.verify_password(body.password, stored) or not user:
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = auth.create_session(session, user).token
    return AuthResponse(token=token, email=user.email, user_id=user.id)


@router.post("/logout", status_code=204)
def logout(authorization: str = Header(default=""), session: Session = Depends(get_session)):
    auth.revoke(session, _token_from_header(authorization))


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"user_id": user.id, "email": user.email, "created_at": user.created_at}
