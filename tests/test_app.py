from fastapi.testclient import TestClient
import pytest
from app import app

client = TestClient(app)


def test_page_and_assets():
    response = client.get("/")
    assert response.status_code == 200
    assert '/static/anna.jpeg' in response.text
    assert 'href="/parler"' in response.text
    assert 'Poser la question' in response.text
    response = client.get("/parler")
    assert response.status_code == 200
    assert '<title>Parler avec Anna</title>' in response.text
    assert 'id="bYes"' in response.text
    for path in ("/static/app.js", "/static/style.css", "/static/home.css", "/static/home.js"):
        assert client.get(path).status_code == 200


def test_health():
    assert client.get("/api/health").json() == {"status": "ok", "app": "anna"}


def test_no_answer_collection_endpoint():
    assert client.post("/api/answers", json={"answer": "private"}).status_code == 404


@pytest.fixture
def admin_environment(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "test-admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "test-password")


@pytest.mark.parametrize("path", ["/admin", "/admin/"])
def test_admin_requires_authentication(path, admin_environment):
    response = client.get(path)
    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Basic")
    assert "Anna · Administration" not in response.text


@pytest.mark.parametrize("auth", [("test-admin", "wrong"), ("wrong", "test-password"), ("é", "é")])
def test_admin_rejects_invalid_credentials(auth, admin_environment):
    assert client.get("/admin", auth=auth).status_code == 401


def test_admin_success(admin_environment):
    response = client.get("/admin", auth=("test-admin", "test-password"))
    assert response.status_code == 200
    assert "Anna · Administration" in response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert "noindex" in response.headers["x-robots-tag"]


def test_admin_fails_closed_without_configuration(monkeypatch):
    monkeypatch.delenv("ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    assert client.get("/admin", auth=("test-admin", "test-password")).status_code == 503
    assert client.get("/").status_code == 200


@pytest.mark.parametrize("path", ["/private/admin.html", "/static/admin.html"])
def test_private_template_is_not_public(path):
    assert client.get(path).status_code == 404


def test_admin_session_requires_credentials(admin_environment):
    assert client.get("/api/admin-session").status_code == 401
    assert client.get("/api/admin-session", auth=("test-admin", "wrong")).status_code == 401
    response = client.get("/api/admin-session", auth=("test-admin", "test-password"))
    assert response.json() == {"isAdmin": True}
    assert response.headers["cache-control"] == "private, no-store"


def test_camera_is_allowed_only_for_this_site():
    response = client.get("/")
    assert response.headers["permissions-policy"] == "camera=(self), microphone=()"
