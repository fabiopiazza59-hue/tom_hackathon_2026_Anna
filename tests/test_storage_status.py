import httpx
import pytest

import shared_config
from shared_config import blob_token, storage_status

TOKEN = "vercel_blob_rw_StoreId123_secretpart"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in [k for k in __import__("os").environ if k.endswith("READ_WRITE_TOKEN")] + ["VERCEL", "BLOB_STORE_ID", "VERCEL_OIDC_TOKEN"]:
        monkeypatch.delenv(name, raising=False)


def test_a_prefixed_blob_token_is_used_when_the_default_name_is_missing(monkeypatch):
    monkeypatch.setenv("ANNA_BLOB_READ_WRITE_TOKEN", TOKEN)
    assert blob_token() == TOKEN
    monkeypatch.setenv("OTHER_BLOB_READ_WRITE_TOKEN", TOKEN + "2")
    assert blob_token() is None  # Deux magasins : on ne devine pas.
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_Default_x")
    assert blob_token() == "vercel_blob_rw_Default_x"


def test_health_explains_a_missing_token_on_vercel(monkeypatch):
    assert storage_status() == {"mode": "fichier local"}
    monkeypatch.setenv("VERCEL", "1")
    status = storage_status()
    assert status["mode"] == "indisponible" and "connectez un magasin Blob" in status["detail"]


@pytest.mark.parametrize("code,mode,detail", [(200, "blob", "configuration enregistrée"), (404, "blob", "magasin vide"), (403, "indisponible", "refuse la lecture (403)")])
def test_health_reports_what_the_blob_store_answers_without_the_token(monkeypatch, code, mode, detail):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("ANNA_BLOB_READ_WRITE_TOKEN", TOKEN)
    monkeypatch.setattr(shared_config.BlobConfigStore, "request", lambda self, method, url, **kw: httpx.Response(code))
    status = storage_status()
    assert status["mode"] == mode and detail in status["detail"] and status["auth"] == "ANNA_BLOB_READ_WRITE_TOKEN"
    assert "secretpart" not in str(status)


def test_oidc_with_blob_store_id_is_preferred_like_the_official_sdks(monkeypatch):
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", TOKEN)
    assert shared_config.blob_credentials() == (TOKEN, None)
    monkeypatch.setenv("BLOB_STORE_ID", "store_I5FcH1njweW1S4eC")
    monkeypatch.setenv("VERCEL_OIDC_TOKEN", "oidc-from-env")
    assert shared_config.blob_credentials() == ("oidc-from-env", "I5FcH1njweW1S4eC")
    request_token = shared_config.REQUEST_OIDC_TOKEN.set("oidc-from-request")
    try:
        assert shared_config.blob_credentials() == ("oidc-from-request", "I5FcH1njweW1S4eC")
    finally:
        shared_config.REQUEST_OIDC_TOKEN.reset(request_token)


def test_oidc_store_reads_the_private_url_and_names_the_store_on_writes():
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(404) if request.method == "GET" else httpx.Response(200, json={"etag": '"e1"'})

    store = shared_config.BlobConfigStore("oidc-token", transport=httpx.MockTransport(handle), store_id="I5FcH1njweW1S4eC")
    assert store.read().initialized is False
    assert str(calls[0].url).startswith("https://i5fch1njwew1s4ec.private.blob.vercel-storage.com/anna/config.json")
    assert calls[0].headers["authorization"] == "Bearer oidc-token"
    store.write(shared_config.default_config(), '"empty"')
    assert calls[1].headers["x-vercel-blob-store-id"] == "I5FcH1njweW1S4eC"
    assert calls[1].headers["authorization"] == "Bearer oidc-token"


def test_the_request_oidc_token_reaches_the_store_on_vercel(monkeypatch):
    from fastapi.testclient import TestClient
    from app import app
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("BLOB_STORE_ID", "store_I5FcH1njweW1S4eC")
    seen = []
    monkeypatch.setattr(shared_config.BlobConfigStore, "request", lambda self, method, url, **kw: seen.append(kw["headers"]["Authorization"]) or httpx.Response(404))
    status = TestClient(app).get("/api/health", headers={"x-vercel-oidc-token": "per-request"}).json()["storage"]
    assert status == {"mode": "blob", "detail": "magasin vide, banque initiale utilisée", "auth": "OIDC (BLOB_STORE_ID)"}
    assert seen == ["Bearer per-request"]
    # Sans jeton OIDC, le rapport explique quoi vérifier.
    assert "OIDC" in TestClient(app).get("/api/health").json()["storage"]["detail"]
