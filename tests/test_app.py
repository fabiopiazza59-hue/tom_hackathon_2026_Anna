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
    # A login form, not the browser's Basic box: many phone and in-app browsers never show that box.
    assert "www-authenticate" not in response.headers
    assert 'id="login"' in response.text
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


def test_admin_tolerates_pasted_newlines_and_phone_capitalisation(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "anna\n")
    monkeypatch.setenv("ADMIN_PASSWORD", "tom\n")
    for auth in [("anna", "tom"), ("Anna ", "tom"), ("ANNA", "tom ")]:
        assert client.get("/api/admin-session", auth=auth).status_code == 200, auth
    assert client.get("/api/admin-session", auth=("anna", "Tom")).status_code == 401
    assert client.get("/api/admin-session", auth=("anna", "")).status_code == 401


def test_login_form_opens_a_session_that_unlocks_admin(admin_environment):
    browser = TestClient(app)
    assert browser.post("/api/admin-login", json={"username": "test-admin", "password": "wrong"}).status_code == 401
    assert "anna_admin" not in browser.cookies
    response = browser.post("/api/admin-login", json={"username": "Test-Admin ", "password": "test-password"})
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert "Anna · Administration" in browser.get("/admin").text
    assert browser.get("/api/admin-session").json() == {"isAdmin": True}
    browser.post("/api/admin-logout")
    assert browser.get("/api/admin-session").status_code == 401


def test_session_cookie_cannot_be_forged_and_ends_when_the_password_changes(admin_environment, monkeypatch):
    browser = TestClient(app)
    browser.post("/api/admin-login", json={"username": "test-admin", "password": "test-password"})
    token = browser.cookies["anna_admin"]
    expires, signature = token.split(".")
    for forged in [f"{int(expires) + 999999}.{signature}", f"{expires}.{'0' * 64}", "nope", ""]:
        assert TestClient(app, cookies={"anna_admin": forged}).get("/api/admin-session").status_code == 401
    monkeypatch.setenv("ADMIN_PASSWORD", "new-password")
    assert browser.get("/api/admin-session").status_code == 401


def test_login_from_another_site_is_refused(admin_environment):
    response = client.post("/api/admin-login", json={"username": "test-admin", "password": "test-password"}, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


def test_admin_page_has_every_element_the_script_needs_at_startup():
    # app.js runs on both pages; a button missing from admin.html stops the admin at « Chargement… ».
    import re
    from pathlib import Path
    root = Path(__file__).parent.parent
    public, admin = (root / "static/index.html").read_text(), (root / "private/admin.html").read_text()
    script = (root / "static/app.js").read_text()
    used = set(re.findall(r"\$\('#([A-Za-z]+)'\)", script)) & set(re.findall(r'id="([A-Za-z]+)"', public))
    missing = sorted(i for i in used if f'id="{i}"' not in admin)
    assert not missing, missing


def test_scripts_and_styles_are_always_revalidated():
    for path in ("/static/app.js", "/static/hierarchy.js", "/static/style.css"):
        response = client.get(path)
        assert response.headers["cache-control"] == "no-cache"
        assert client.get(path, headers={"If-None-Match": response.headers["etag"]}).status_code == 304
