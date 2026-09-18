import logging
import os

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "klaxon.db")


def _database_url() -> str:
    """Postgres in production, SQLite for local development.

    SQLite cannot back a real deployment here for two reasons: most hosts give
    a container an ephemeral filesystem, so the file vanishes on every deploy,
    and its single-writer lock is already the measured throughput ceiling on
    the ingest path.
    """
    url = os.getenv("DATABASE_URL")
    if not url:
        return f"sqlite:///{DB_PATH}"
    # Several hosts still hand out the legacy "postgres://" scheme, which
    # SQLAlchemy 2 rejects, and psycopg3 needs naming explicitly.
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


DATABASE_URL = _database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite")

# Every timestamp column is TIMESTAMP WITHOUT TIME ZONE, and the code writes
# aware UTC datetimes into them. Postgres resolves that by converting to the
# session's TimeZone and dropping the offset, so on a server whose timezone is
# not UTC every stored time is silently shifted — while `_aware()` on the way
# back out still labels it UTC. That skews alert cooldowns, volume windows,
# session expiry and the worker's stale-lock timeout by the server's offset.
# Pinning the session to UTC makes the conversion a no-op, which is what the
# rest of the code already assumes.
_CONNECT_ARGS: dict = (
    # check_same_thread is a SQLite-only argument; the worker runs in its own
    # thread and would otherwise be refused the connection.
    {"check_same_thread": False}
    if IS_SQLITE
    else {"options": "-c timezone=UTC"}
)

engine = create_engine(
    DATABASE_URL,
    connect_args=_CONNECT_ARGS,
    # Hosted Postgres drops idle connections; without pre-ping the first query
    # after an idle period fails instead of transparently reconnecting.
    pool_pre_ping=not IS_SQLITE,
)

# Columns added to tables that may already exist in a database created by an
# earlier version. `create_all` only creates missing *tables*, so evolving an
# existing one needs an explicit ALTER. Listed rather than reflected, so every
# schema change stays visible in review.
_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    ("project", "owner_id", "INTEGER"),
    # Retry state added when alert delivery moved off the ingest path onto its
    # own retried pass. Existing installs' `alert` table predates both columns
    # — create_all only creates missing tables, never alters one that already
    # exists, so without this every read of an old row 500s.
    ("alert", "attempts", "INTEGER DEFAULT 0 NOT NULL"),
    ("alert", "next_attempt_at", "TIMESTAMP"),
    # Billing. Same reasoning as the two above — an existing `user` table
    # predates these and create_all() will not add them on its own.
    ("user", "plan", "VARCHAR DEFAULT 'free' NOT NULL"),
    ("user", "stripe_customer_id", "VARCHAR"),
    ("user", "stripe_subscription_id", "VARCHAR"),
    # Nullable, no DEFAULT: every account that exists before this migration
    # runs is backfilled as NULL ("never expires") rather than retroactively
    # starting a 14-day clock on people who already signed up — only a fresh
    # signup after this ships gets a real trial_ends_at set.
    ("user", "trial_ends_at", "TIMESTAMP"),
]


def _migrate(connection) -> None:
    # SQLAlchemy's inspector rather than PRAGMA: PRAGMA is SQLite-only and
    # silently returns nothing on Postgres, which would make every migration
    # look already-applied.
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    # "user" is a reserved word in Postgres (and every migration so far has
    # targeted `project` or `alert`, so this never mattered until now). Quote
    # every identifier through the dialect's own preparer rather than special
    # casing "user" — SQLite accepts quoted identifiers too, so this is a
    # no-op there and a real fix on Postgres.
    quote = connection.dialect.identifier_preparer.quote
    for table, column, ddl in _COLUMN_MIGRATIONS:
        if table not in tables:
            continue  # create_all builds it with the column already
        if column in {c["name"] for c in inspector.get_columns(table)}:
            continue
        connection.execute(text(f"ALTER TABLE {quote(table)} ADD COLUMN {quote(column)} {ddl}"))


def _adopt_ownerless_projects(connection) -> None:
    """Give pre-auth projects to the earliest account.

    Projects created before ownership existed have owner_id NULL, so once the
    projects endpoint is scoped to the caller they belong to nobody and vanish
    from every dashboard. Assigning them to the first user is right for the
    single-account installs that can actually have such rows; with several
    accounts already registered there is no basis to choose, so they are left
    alone rather than handed to the wrong person.
    """
    inspector = inspect(connection)
    if not {"user", "project"} <= set(inspector.get_table_names()):
        return
    # "user" is a reserved word in Postgres, so it must stay quoted.
    rows = connection.execute(text('SELECT id FROM "user" ORDER BY id')).fetchall()
    if len(rows) != 1:
        return
    connection.execute(
        text("UPDATE project SET owner_id = :uid WHERE owner_id IS NULL"),
        {"uid": rows[0][0]},
    )


def _ensure_alert_rules(connection) -> None:
    """Give every project the default rules if it has none.

    A project with no rules collects issues and notifies nobody — the one
    failure an error tracker must not have, and a silent one: the dashboard
    looks healthy because the issues are all there. Projects created before
    provisioning existed (or whose rules were deleted) end up in that state,
    so this repairs them on startup rather than leaving it to be noticed the
    day an outage goes unreported.
    """
    inspector = inspect(connection)
    if not {"project", "alertrule"} <= set(inspector.get_table_names()):
        return

    rows = connection.execute(
        text(
            """
            SELECT p.id FROM project p
            WHERE NOT EXISTS (SELECT 1 FROM alertrule a WHERE a.project_id = p.id)
            """
        )
    ).fetchall()
    if not rows:
        return

    from core import alerts  # deferred: core.alerts imports backend.models

    # Persisted through the ORM rather than a hand-written INSERT: spelling the
    # column list out here means it silently drifts from the model, and a
    # missing column takes the whole application down at startup rather than
    # failing in isolation.
    with Session(bind=connection) as session:
        for (project_id,) in rows:
            for rule in alerts.default_rules(project_id):
                session.add(rule)
            logger.warning("project %s had no alert rules; created defaults", project_id)
        session.commit()


def init_db() -> None:
    # Import models so their tables are registered on SQLModel.metadata before create_all.
    from backend import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    with engine.begin() as connection:
        _migrate(connection)
        _adopt_ownerless_projects(connection)
        _ensure_alert_rules(connection)


def get_session():
    with Session(engine) as session:
        yield session
