"""Pre-recorded natural French voice (ElevenLabs), stored next to the shared configuration.

Only phrases sent by the admin are recorded. The public page plays a recording when one exists
and otherwise falls back to the browser voice, so the ElevenLabs key is never used at runtime.
"""
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path

import httpx

from shared_config import ROOT, BlobConfigStore, ConfigUnavailable, blob_credentials

MODEL = "eleven_multilingual_v2"
MAX_PHRASE = 600
KEY = re.compile(r"^[0-9a-f]{24}$")


class VoiceUnavailable(Exception):
    pass


def voice_settings():
    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{1,64}", voice_id):
        voice_id = ""
    return api_key, voice_id, os.environ.get("ELEVENLABS_MODEL", MODEL).strip() or MODEL


def phrase_key(voice_id, model, text):
    # The voice and model are part of the key: changing either records everything again.
    return hashlib.sha256(f"{voice_id}\0{model}\0{text}".encode()).hexdigest()[:24]


def synthesize(text, api_key, voice_id, model, transport=None):
    try:
        with httpx.Client(timeout=30, transport=transport) as client:
            response = client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                params={"output_format": "mp3_44100_64"},
                headers={"xi-api-key": api_key, "Accept": "audio/mpeg"},
                json={"text": text, "model_id": model},
            )
    except httpx.HTTPError:
        raise VoiceUnavailable("ElevenLabs injoignable") from None
    if response.status_code != 200 or not response.content:
        raise VoiceUnavailable(f"ElevenLabs a refusé la demande ({response.status_code})")
    return response.content


class FileVoiceStore:
    """Local development: one folder per voice, with an index of recorded phrases."""

    def __init__(self, folder):
        self.folder = Path(folder)

    def index(self, voice_id):
        try:
            return json.loads((self.folder / voice_id / "index.json").read_text())
        except FileNotFoundError:
            return {}

    def audio(self, voice_id, key):
        try:
            return (self.folder / voice_id / f"{key}.mp3").read_bytes()
        except FileNotFoundError:
            return None

    def save(self, voice_id, recordings):
        folder = self.folder / voice_id
        folder.mkdir(parents=True, exist_ok=True)
        for key, (_, audio) in recordings.items():
            (folder / f"{key}.mp3").write_bytes(audio)
        with (folder / "index.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            index = self.index(voice_id) | {text: key for key, (text, _) in recordings.items()}
            temporary = folder / "index.tmp"
            temporary.write_text(json.dumps(index, ensure_ascii=False))
            temporary.replace(folder / "index.json")
        return index


class BlobVoiceStore:
    """Private Vercel Blob, read through this server like the configuration."""

    def __init__(self, token, transport=None, store_id=None):
        self.blob = BlobConfigStore(token, transport, store_id)
        self.base = self.blob.url.rsplit("/", 2)[0]

    def get(self, pathname):
        response = self.blob.request("GET", f"{self.base}/{pathname}", params={"cache": "0"},
                                     headers={"Authorization": f"Bearer {self.blob.token}", "Accept-Encoding": "identity"})
        if response.status_code == 404:
            return None, None
        if response.status_code != 200:
            raise ConfigUnavailable()
        return response.content, response.headers.get("etag")

    def put(self, pathname, content, content_type, revision=None):
        headers = {"Authorization": f"Bearer {self.blob.token}", "x-vercel-blob-store-id": self.blob.store_id, "x-api-version": "13", "x-vercel-blob-access": "private",
                   "x-add-random-suffix": "0", "x-content-type": content_type, "x-allow-overwrite": "1"}
        if revision:
            headers["x-if-match"] = revision
        response = self.blob.request("PUT", "https://vercel.com/api/blob/", params={"pathname": pathname}, content=content, headers=headers)
        if response.status_code in (409, 412):
            return False
        if response.status_code not in (200, 201):
            raise ConfigUnavailable()
        return True

    def index(self, voice_id):
        content, _ = self.get(f"anna/voices/{voice_id}/index.json")
        return json.loads(content) if content else {}

    def audio(self, voice_id, key):
        return self.get(f"anna/voices/{voice_id}/{key}.mp3")[0]

    def save(self, voice_id, recordings):
        for key, (_, audio) in recordings.items():
            self.put(f"anna/voices/{voice_id}/{key}.mp3", audio, "audio/mpeg")
        # Merge with a concurrent save instead of overwriting it.
        for _ in range(3):
            content, etag = self.get(f"anna/voices/{voice_id}/index.json")
            index = (json.loads(content) if content else {}) | {text: key for key, (text, _) in recordings.items()}
            if self.put(f"anna/voices/{voice_id}/index.json", json.dumps(index, ensure_ascii=False).encode(), "application/json", etag):
                return index
        raise ConfigUnavailable()


def get_voice_store():
    credentials = blob_credentials()
    if credentials:
        return BlobVoiceStore(credentials[0], store_id=credentials[1])
    if os.environ.get("VERCEL"):
        raise ConfigUnavailable()
    return FileVoiceStore(os.environ.get("ANNA_VOICES_DIR", ROOT / "data" / "voices"))


def record(store, phrases, transport=None):
    """Record the phrases not recorded yet; a failed phrase stays on the browser voice."""
    api_key, voice_id, model = voice_settings()
    if not api_key or not voice_id:
        raise VoiceUnavailable("Voix non configurée : ajoutez ELEVENLABS_API_KEY et ELEVENLABS_VOICE_ID.")
    index = store.index(voice_id)
    todo = [p for p in dict.fromkeys(phrases) if p not in index]

    def one(text):
        try:
            return text, synthesize(text, api_key, voice_id, model, transport)
        except VoiceUnavailable as exc:
            return text, exc

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, todo))
    recordings = {phrase_key(voice_id, model, t): (t, audio) for t, audio in results if isinstance(audio, bytes)}
    failed = [{"text": t, "error": str(e)} for t, e in results if not isinstance(e, bytes)]
    if recordings:
        index = store.save(voice_id, recordings)
    return {"recorded": len(recordings), "failed": failed, "total": len(index)}
