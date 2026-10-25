import json

import httpx
import pytest
from fastapi.testclient import TestClient

import voices
from app import app
from voices import BlobVoiceStore, FileVoiceStore, get_voice_store, phrase_key

AUTH = ("admin-test", "password-test")


@pytest.fixture
def voice_env(tmp_path, monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", AUTH[0])
    monkeypatch.setenv("ADMIN_PASSWORD", AUTH[1])
    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk_test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice123")
    sent = []

    def fake(text, api_key, voice_id, model, transport=None):
        sent.append(text)
        if "refusée" in text:
            raise voices.VoiceUnavailable("ElevenLabs a refusé la demande (400)")
        return f"mp3:{text}".encode()

    monkeypatch.setattr(voices, "synthesize", fake)
    store = FileVoiceStore(tmp_path / "voices")
    app.dependency_overrides[get_voice_store] = lambda: store
    yield sent
    app.dependency_overrides.clear()


def test_admin_records_only_missing_phrases_and_the_public_page_plays_them(voice_env):
    client = TestClient(app)
    assert client.get("/api/voices").json() == {"configured": True, "phrases": {}}
    assert client.post("/api/voices/record", json={"phrases": ["Ça va ?"]}).status_code == 401
    report = client.post("/api/voices/record", json={"phrases": ["Ça va ?", "Oui", "Phrase refusée"]}, auth=AUTH).json()
    assert report["recorded"] == 2 and report["total"] == 2
    assert report["failed"] == [{"text": "Phrase refusée", "error": "ElevenLabs a refusé la demande (400)"}]
    again = client.post("/api/voices/record", json={"phrases": ["Ça va ?", "Non"]}, auth=AUTH).json()
    assert again["recorded"] == 1 and voice_env.count("Ça va ?") == 1  # Déjà enregistrée : pas de nouvel appel.
    phrases = client.get("/api/voices").json()["phrases"]
    assert set(phrases) == {"Ça va ?", "Oui", "Non"}
    audio = client.get(f"/api/voices/{phrases['Ça va ?']}.mp3")
    assert audio.content == "mp3:Ça va ?".encode() and audio.headers["content-type"] == "audio/mpeg"
    assert "immutable" in audio.headers["cache-control"]


def test_voice_files_are_only_served_by_key(voice_env):
    client = TestClient(app)
    for key in ["../config", "0" * 24, "index"]:
        assert client.get(f"/api/voices/{key}.mp3").status_code == 404


def test_without_elevenlabs_settings_the_browser_voice_is_kept(voice_env, monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY")
    client = TestClient(app)
    assert client.get("/api/voices").json()["configured"] is False
    response = client.post("/api/voices/record", json={"phrases": ["Oui"]}, auth=AUTH)
    assert response.status_code == 503 and "ELEVENLABS_API_KEY" in response.json()["detail"]


def test_changing_the_voice_records_everything_again():
    assert phrase_key("a", "m", "Oui") != phrase_key("b", "m", "Oui") != phrase_key("a", "m2", "Oui")


def test_elevenlabs_request_uses_the_multilingual_model_and_mp3():
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, content=b"ID3audio")

    assert voices.synthesize("Bonjour", "k", "voice123", voices.MODEL, httpx.MockTransport(handle)) == b"ID3audio"
    request = seen[0]
    assert request.url.path == "/v1/text-to-speech/voice123" and request.url.params["output_format"] == "mp3_44100_64"
    assert request.headers["xi-api-key"] == "k"
    assert json.loads(request.content) == {"text": "Bonjour", "model_id": "eleven_multilingual_v2"}


def test_blob_store_merges_the_index_instead_of_overwriting_a_concurrent_save():
    files, puts = {"anna/voices/v/index.json": json.dumps({"Oui": "a" * 24}).encode()}, []
    stale = {"left": 1}

    def handle(request):
        path = request.url.path.lstrip("/") if request.method == "GET" else request.url.params["pathname"]
        if request.method == "GET":
            return httpx.Response(200, content=files[path], headers={"etag": '"e1"'}) if path in files else httpx.Response(404)
        puts.append((path, request.headers.get("x-if-match")))
        if path.endswith("index.json") and stale["left"]:
            stale["left"] -= 1
            return httpx.Response(412)
        files[path] = request.content
        return httpx.Response(200, json={"etag": '"e2"'})

    store = BlobVoiceStore("vercel_blob_rw_store_test_secret", transport=httpx.MockTransport(handle))
    index = store.save("v", {"b" * 24: ("Non", b"mp3")})
    assert index == {"Oui": "a" * 24, "Non": "b" * 24}
    assert files["anna/voices/v/" + "b" * 24 + ".mp3"] == b"mp3"
    assert [p for p in puts if p[0].endswith("index.json")] == [("anna/voices/v/index.json", '"e1"')] * 2


def test_a_busy_elevenlabs_is_retried_then_its_reason_is_shown():
    answers = iter([httpx.Response(429, json={"detail": {"status": "too_many_concurrent_requests"}}), httpx.Response(200, content=b"ID3ok")])
    waits = []
    assert voices.synthesize("Oui", "k", "v", voices.MODEL, httpx.MockTransport(lambda r: next(answers)), wait=waits.append) == b"ID3ok"
    assert waits == [1.5]

    refused = httpx.MockTransport(lambda r: httpx.Response(401, json={"detail": {"status": "quota_exceeded", "message": "You have 12 credits remaining."}}))
    with pytest.raises(voices.VoiceUnavailable, match=r"\(401 : quota_exceeded : You have 12 credits remaining\.\)"):
        voices.synthesize("Oui", "k", "v", voices.MODEL, refused)


def test_never_more_parallel_requests_than_the_free_plan_allows(voice_env, monkeypatch, tmp_path):
    import threading
    running, peak, lock = 0, 0, threading.Lock()

    def slow(text, *args, **kwargs):
        nonlocal running, peak
        with lock:
            running += 1; peak = max(peak, running)
        __import__("time").sleep(0.05)
        with lock:
            running -= 1
        return b"mp3"

    monkeypatch.setattr(voices, "synthesize", slow)
    report = voices.record(FileVoiceStore(tmp_path / "v"), [f"Phrase {i}" for i in range(8)])
    assert report["recorded"] == 8 and peak <= 2


def test_a_key_id_pasted_instead_of_the_secret_key_is_explained(voice_env, monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "a1b2c3d4e5f6")
    response = TestClient(app).post("/api/voices/record", json={"phrases": ["Oui"]}, auth=AUTH)
    assert response.status_code == 503 and "sk_" in response.json()["detail"]
    assert voice_env == []  # ElevenLabs n’est même pas appelé.
