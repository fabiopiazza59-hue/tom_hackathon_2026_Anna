import httpx
import pytest

import shared_config
from shared_config import blob_token, storage_status

TOKEN = "vercel_blob_rw_StoreId123_secretpart"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in [k for k in __import__("os").environ if k.endswith("READ_WRITE_TOKEN")] + ["VERCEL"]:
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
    assert status["mode"] == mode and detail in status["detail"] and status["variable"] == "ANNA_BLOB_READ_WRITE_TOKEN"
    assert "secretpart" not in str(status)
