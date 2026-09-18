"""Password hashing and session tokens.

Uses only the standard library: PBKDF2-HMAC-SHA256 for passwords and opaque
random tokens stored server-side for sessions. Opaque beats JWT here because
logout and revocation are a row delete rather than a blocklist.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlmodel import Session as DBSession
from sqlmodel import select

from backend.models import AuthSession, User

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 260_000
SESSION_TTL = timedelta(days=14)
MIN_PASSWORD_LENGTH = 8


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"{ALGORITHM}${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, expected = encoded.split("$")
        if algorithm != ALGORITHM:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    # Constant-time: a timing difference here leaks the hash prefix.
    return hmac.compare_digest(digest.hex(), expected)


def normalise_email(email: str) -> str:
    return email.strip().lower()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    """SQLite returns naive datetimes; treat them as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def create_session(db: DBSession, user: User) -> AuthSession:
    session = AuthSession(
        token=secrets.token_urlsafe(32),
        user_id=user.id,
        expires_at=_utcnow() + SESSION_TTL,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def user_for_token(db: DBSession, token: str) -> Optional[User]:
    if not token:
        return None

    session = db.exec(select(AuthSession).where(AuthSession.token == token)).first()
    if not session:
        return None

    if _aware(session.expires_at) < _utcnow():
        # Expired sessions are deleted on use rather than swept on a timer.
        db.delete(session)
        db.commit()
        return None

    return db.get(User, session.user_id)


def revoke(db: DBSession, token: str) -> None:
    session = db.exec(select(AuthSession).where(AuthSession.token == token)).first()
    if session:
        db.delete(session)
        db.commit()
