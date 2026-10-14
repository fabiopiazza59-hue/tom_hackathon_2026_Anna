from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4
import time

from fastapi.testclient import TestClient
import pytest

from app import app
from activity import FileActivityStore, InteractionBatch, append_events, get_activity_store

AUTH = ("admin-test", "password-test")


def answer(conversation_id=None):
    return {"kind": "answer", "id": str(uuid4()), "conversationId": conversation_id or str(uuid4()),
            "at": int(time.time() * 1000), "questionId": "q:mal_dos", "question": "Tu as mal au dos ?",
            "theme": "subcat:douleur", "answer": "oui", "ms": 1200}


def conversation(conversation_id):
    return {"kind": "conversation", "id": str(uuid4()), "conversationId": conversation_id,
            "at": int(time.time() * 1000), "theme": "subcat:douleur", "path": ["Corps", "Douleur", "Dos"],
            "text": "J’ai mal au dos.", "result": "resolu", "nodeId": "q:mal_dos", "n": 1, "dur": 1200}


@pytest.fixture
def activity_store(tmp_path, monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", AUTH[0])
    monkeypatch.setenv("ADMIN_PASSWORD", AUTH[1])
    path = tmp_path / "activity.json"
    app.dependency_overrides[get_activity_store] = lambda: FileActivityStore(path)
    yield path
    app.dependency_overrides.clear()


def test_public_answers_feed_shared_usage_but_history_is_admin_only(activity_store):
    public, admin = TestClient(app), TestClient(app)
    event = answer()
    batch = {"events": [event, conversation(event["conversationId"])]}
    assert public.post("/api/interactions", json=batch).status_code == 200
    usage = public.get("/api/usage")
    assert usage.json()["stats"]["q:mal_dos"] == {"a": 1, "y": 1, "n": 0, "rt": 1200, "hours": {next(iter(usage.json()["stats"]["q:mal_dos"]["hours"])): 1}}
    assert "mal au dos" not in usage.text
    assert "history" not in usage.json()
    assert public.get("/api/history").status_code == 401
    assert admin.get("/api/history", auth=(AUTH[0], "wrong")).status_code == 401
    history = admin.get("/api/history", auth=AUTH)
    assert history.headers["cache-control"] == "private, no-store"
    assert history.json()["history"][0]["text"] == "J’ai mal au dos."
    assert history.json()["answers"][0]["answer"] == "oui"
    assert FileActivityStore(activity_store).read().config["stats"]["q:mal_dos"]["a"] == 1
    assert public.get("/api/usage", headers={"If-None-Match": usage.headers["etag"]}).status_code == 304


def test_network_retries_are_idempotent_and_corrections_replace_the_conversation(activity_store):
    client = TestClient(app)
    event = answer(); result = conversation(event["conversationId"])
    batch = {"events": [event, result]}
    for _ in range(3):
        assert client.post("/api/interactions", json=batch).status_code == 200
    assert client.get("/api/usage").json()["stats"]["q:mal_dos"]["a"] == 1
    result = {**result, "id": str(uuid4()), "text": "Après correction", "result": "non-trouve"}
    assert client.post("/api/interactions", json={"events": [result]}).status_code == 200
    history = client.get("/api/history", auth=AUTH).json()["history"]
    assert len(history) == 1
    assert history[0]["text"] == "Après correction"


def test_two_simultaneous_users_do_not_lose_answers(tmp_path):
    path, barrier = tmp_path / "activity.json", Barrier(2)

    class RacingStore(FileActivityStore):
        first_read = True

        def read(self, revision=None):
            result = super().read(revision)
            if self.first_read:
                self.first_read = False
                barrier.wait(timeout=5)
            return result

    def submit():
        event = answer()
        events = InteractionBatch.model_validate({"events": [event, conversation(event["conversationId"])]}).events
        append_events(RacingStore(path), events)

    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda _: submit(), range(2)))
    doc = FileActivityStore(path).read().config
    assert doc["stats"]["q:mal_dos"]["a"] == 2
    assert len(doc["history"]) == 2
    assert len(doc["answers"]) == 2


def test_invalid_batches_and_cross_origin_posts_do_not_create_data(activity_store):
    client = TestClient(app)
    event = answer()
    for changes in ({"answer": "peut-être"}, {"ms": -1}, {"question": "x" * 601}, {"id": "not-a-uuid"}, {"extra": "unwanted"}):
        assert client.post("/api/interactions", json={"events": [{**event, **changes}]}).status_code == 422
    assert client.post("/api/interactions", json={"events": [event]}, headers={"Origin": "https://other.example"}).status_code == 403
    assert not activity_store.exists()
