import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from backend.db import get_session
from backend.main import app
from backend.models import Project


@pytest.fixture
def client():
    # StaticPool: every connection must be the *same* in-memory database.
    # Without it each new connection gets a fresh, empty one, and TestClient
    # serves requests from a different thread than the fixture.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Project(id=1, name="shop", public_key="pk_realkey", owner_id=1))
        session.commit()

        app.dependency_overrides[get_session] = lambda: session
        yield TestClient(app)
        app.dependency_overrides.clear()


class TestLoader:
    def test_serves_sdk_with_init_applied(self, client):
        """The whole point: the served file configures itself."""
        res = client.get("/js/1/pk_realkey.js")
        assert res.status_code == 200
        assert "javascript" in res.headers["content-type"]

        body = res.text
        assert "window.Klaxon.init(" in body
        # The SDK itself must be there, not just the bootstrap.
        assert "captureException" in body

    def test_embeds_a_dsn_for_this_project(self, client):
        body = client.get("/js/1/pk_realkey.js").text
        assert "pk_realkey@" in body
        assert body.rstrip().endswith("})();")

    def test_wrong_key_is_404(self, client):
        assert client.get("/js/1/pk_wrongkey.js").status_code == 404

    def test_unknown_project_is_404(self, client):
        """Same status as a wrong key, so ids cannot be enumerated."""
        assert client.get("/js/999/pk_realkey.js").status_code == 404

    def test_loadable_cross_origin(self, client):
        """Customer sites are a different origin by definition."""
        res = client.get("/js/1/pk_realkey.js")
        assert res.headers["access-control-allow-origin"] == "*"
        assert "max-age" in res.headers["cache-control"]

    def test_origin_follows_the_request_host(self, client):
        """A tunnel or proxy must need no configuration.

        The DSN is built from the forwarded headers, so the SDK posts back to
        the address the browser actually used rather than to localhost.
        """
        body = client.get(
            "/js/1/pk_realkey.js",
            headers={"x-forwarded-proto": "https", "x-forwarded-host": "abc.ngrok-free.app"},
        ).text
        assert "https://pk_realkey@abc.ngrok-free.app/1" in body

    def test_dsn_is_a_safe_string_literal(self, client):
        """Embedded via json.dumps so it cannot break out of the literal."""
        body = client.get("/js/1/pk_realkey.js").text
        line = next(ln for ln in body.splitlines() if "window.Klaxon.init(" in ln)
        assert line.count('"') == 2
