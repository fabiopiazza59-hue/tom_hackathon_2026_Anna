from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from app import app
from shared_config import BlobConfigStore, ConfigConflict, FileConfigStore, default_config, get_config_store

AUTH = ("admin-test", "password-test")


@pytest.fixture
def shared_store(tmp_path, monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", AUTH[0])
    monkeypatch.setenv("ADMIN_PASSWORD", AUTH[1])
    path = tmp_path / "config.json"
    # Chaque requête reçoit une nouvelle instance, comme des fonctions Vercel distinctes.
    app.dependency_overrides[get_config_store] = lambda: FileConfigStore(path)
    yield path
    app.dependency_overrides.clear()


def test_admin_edits_are_visible_to_an_independent_public_client_and_after_restart(shared_store):
    admin, public = TestClient(app), TestClient(app)
    initial = admin.get("/api/config").json()
    assert initial["initialized"] is False
    config = initial["config"]
    config["bank"]["root"]["q"] = "Tu vas bien aujourd’hui ?"
    saved = admin.put("/api/config", auth=AUTH, json=config, headers={"If-Match": initial["revision"]})
    assert saved.status_code == 200
    visible = public.get("/api/config")
    assert visible.json()["config"]["bank"]["root"]["q"] == "Tu vas bien aujourd’hui ?"
    assert visible.json()["initialized"] is True
    assert visible.headers["cache-control"] == "no-store"
    assert FileConfigStore(shared_store).read().config == config
    assert public.get("/api/config", headers={"If-None-Match": saved.json()["revision"]}).status_code == 304


def test_stale_admin_and_simultaneous_initialization_cannot_overwrite(shared_store):
    a, b = TestClient(app), TestClient(app)
    initial = a.get("/api/config").json()
    config = initial["config"]
    config["bank"]["root"]["q"] = "Première édition ?"
    first = a.put("/api/config", json=config, auth=AUTH, headers={"If-Match": initial["revision"]})
    stale = deepcopy(config)
    stale["bank"]["root"]["q"] = "Édition périmée ?"
    assert b.put("/api/config", json=stale, auth=AUTH, headers={"If-Match": initial["revision"]}).status_code == 409
    revision = first.json()["revision"]
    config["patient"]["daily_plan"] = "Atelier"
    assert a.put("/api/config", json=config, auth=AUTH, headers={"If-Match": revision}).status_code == 200
    assert b.put("/api/config", json=stale, auth=AUTH, headers={"If-Match": revision}).status_code == 409
    assert b.get("/api/config").json()["config"] == config


def test_only_authenticated_admin_can_write_and_revision_is_required(shared_store):
    client = TestClient(app)
    data = client.get("/api/config").json()
    assert client.put("/api/config", json=data["config"]).status_code == 401
    assert client.put("/api/config", auth=("admin-test", "wrong"), json=data["config"]).status_code == 401
    assert client.put("/api/config", auth=AUTH, json=data["config"]).status_code == 428
    assert client.put("/api/config", auth=AUTH, json=data["config"], headers={"If-Match": "*"}).status_code == 428
    assert not shared_store.exists()


def test_configuration_always_includes_default_settings_and_people(shared_store):
    client = TestClient(app)
    data = client.get("/api/config").json()
    bank = deepcopy(data["config"]["bank"])
    bank["root"]["children"] = []
    response = client.put("/api/config", json={"bank": bank}, auth=AUTH, headers={"If-Match": data["revision"]})
    assert response.status_code == 200
    config = client.get("/api/config").json()["config"]
    assert config["patient"]["settings"]["context"] == "tous"
    assert config["people"] == []


@pytest.mark.parametrize("field", ["events", "conversations", "notes", "history", "stats", "answers", "interactions"])
def test_configuration_endpoint_cannot_collect_interactions(shared_store, field):
    client = TestClient(app)
    data = client.get("/api/config").json()
    data["config"][field] = ["interaction"]
    assert client.put("/api/config", auth=AUTH, json=data["config"], headers={"If-Match": data["revision"]}).status_code == 422
    assert not shared_store.exists()


@pytest.mark.parametrize("invalid", ["duplicate", "level", "order"])
def test_invalid_tree_is_rejected_without_changing_shared_bank(shared_store, invalid):
    client = TestClient(app)
    data = client.get("/api/config").json()
    category = data["config"]["bank"]["root"]["children"][0]
    if invalid == "duplicate":
        category["id"] = "master"
    elif invalid == "level":
        category["level"] = "subquestion"
    else:
        category["order"] = -1
    assert client.put("/api/config", auth=AUTH, json=data["config"], headers={"If-Match": data["revision"]}).status_code == 422
    assert not shared_store.exists()


def test_production_without_storage_does_not_fall_back_to_ephemeral_disk(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("BLOB_READ_WRITE_TOKEN", raising=False)
    response = TestClient(app).get("/api/config")
    assert response.status_code == 503


def test_blob_reads_bypass_cdn_and_writes_use_atomic_preconditions():
    calls = []

    def handle(request):
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=default_config(), headers={"etag": 'W/"v1"'})
        if request.headers.get("x-if-match") == '"stale"':
            return httpx.Response(412)
        return httpx.Response(200, json={"etag": '"v2"'})

    store = BlobConfigStore("vercel_blob_rw_test_secret", transport=httpx.MockTransport(handle))
    snapshot = store.read()
    assert calls[-1].url.params["cache"] == "0"
    assert snapshot.revision == '"v1"'
    assert ".private.blob.vercel-storage.com" in str(calls[-1].url)
    store.write(snapshot.config, snapshot.revision)
    assert calls[-1].headers["x-if-match"] == '"v1"'
    assert calls[-1].headers["x-allow-overwrite"] == "1"
    with pytest.raises(ConfigConflict):
        store.write(snapshot.config, '"stale"')
    store.write(snapshot.config, '"empty"')
    assert calls[-1].headers["x-allow-overwrite"] == "0"
    assert "x-if-match" not in calls[-1].headers


def test_blob_initialization_race_is_reported_as_a_conflict():
    def handle(request):
        return httpx.Response(400, json={"error": {"code": "bad_request", "message": "This blob already exists, use allowOverwrite"}})

    store = BlobConfigStore("vercel_blob_rw_test_secret", transport=httpx.MockTransport(handle))
    with pytest.raises(ConfigConflict):
        store.write(default_config(), '"empty"')


@pytest.mark.parametrize("field,value", [("days", "n’importe quand"), ("peakHours", "25-30"), ("weight", -1.5), ("personId", "unknown-person"), ("oppositeId", "q:missing")])
def test_invalid_new_question_rules_cannot_be_saved(shared_store, field, value):
    client = TestClient(app)
    data = client.get("/api/config").json()
    node = data["config"]["bank"]["root"]["children"][0]["children"][0]["children"][0]
    node[field] = value
    response = client.put("/api/config", json=data["config"], auth=AUTH, headers={"If-Match": data["revision"]})
    assert response.status_code == 422
    assert not shared_store.exists()
