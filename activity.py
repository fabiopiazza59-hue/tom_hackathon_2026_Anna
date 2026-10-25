"""Shared, idempotent usage statistics and admin-only conversation history."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from pydantic import Field

from shared_config import (
    BlobConfigStore, FileConfigStore, blob_credentials, ConfigConflict, ConfigUnavailable,
    EMPTY_REVISION, ROOT, Snapshot, StrictModel,
)

MAX_HISTORY = 300
MAX_ANSWERS = 2000
MAX_RECEIPTS = 5000
EventId = Annotated[str, Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]


class Event(StrictModel):
    id: EventId
    conversationId: EventId
    at: int = Field(ge=0, le=32503680000000)


class AnswerEvent(Event):
    kind: Literal["answer"]
    questionId: str = Field(min_length=1, max_length=150)
    question: str = Field(min_length=1, max_length=600)
    theme: str = Field(default="accueil", max_length=150)
    answer: Literal["oui", "non"]
    ms: int = Field(ge=0, le=86400000)


class ConversationEvent(Event):
    kind: Literal["conversation"]
    theme: str = Field(max_length=150)
    path: list[Annotated[str, Field(max_length=600)]] = Field(max_length=30)
    text: str = Field(max_length=2000)
    result: Literal["resolu", "non-trouve", "parole", "message", "intro"]
    nodeId: str | None = Field(default=None, max_length=150)
    n: int = Field(default=0, ge=0, le=10000)
    dur: int = Field(default=0, ge=0, le=86400000)


class InteractionBatch(StrictModel):
    events: list[Annotated[AnswerEvent | ConversationEvent, Field(discriminator="kind")]] = Field(min_length=1, max_length=50)


def empty_activity():
    return {"version": 1, "stats": {}, "history": [], "answers": [], "receipts": []}


class ActivityDocument:
    def initial(self):
        return Snapshot(empty_activity(), EMPTY_REVISION, False)

    def decode(self, data):
        doc = json.loads(data)
        if doc.get("version") != 1 or not isinstance(doc.get("stats"), dict) or not all(isinstance(doc.get(k), list) for k in ("history", "answers", "receipts")):
            raise ConfigUnavailable()
        return doc


class BlobActivityStore(ActivityDocument, BlobConfigStore):
    pathname = "anna/activity.json"


class FileActivityStore(ActivityDocument, FileConfigStore):
    pass


def get_activity_store():
    credentials = blob_credentials()
    if credentials:
        return BlobActivityStore(credentials[0], store_id=credentials[1])
    if os.environ.get("VERCEL"):
        raise ConfigUnavailable()
    return FileActivityStore(Path(os.environ.get("ANNA_ACTIVITY_FILE", ROOT / "data" / "activity.local.json")))


def apply_events(document, events):
    doc = deepcopy(document)
    receipts = set(doc["receipts"])
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    for event in events:
        data = event.model_dump(mode="json")
        if data["id"] in receipts:
            continue
        receipts.add(data["id"])
        doc["receipts"].append(data["id"])
        data["at"] = min(data["at"], now)
        if data["kind"] == "answer":
            stats = doc["stats"].setdefault(data["questionId"], {"a": 0, "y": 0, "n": 0, "rt": 0, "hours": {}})
            stats["a"] += 1
            stats["y" if data["answer"] == "oui" else "n"] += 1
            stats["rt"] += data["ms"]
            if data["answer"] == "oui":
                hour = str(datetime.fromtimestamp(data["at"] / 1000, ZoneInfo("Europe/Paris")).hour)
                stats["hours"][hour] = stats["hours"].get(hour, 0) + 1
            doc["answers"].append(data)
        else:
            # A correction after Retour updates the same conversation instead of duplicating it.
            doc["history"] = [h for h in doc["history"] if h["conversationId"] != data["conversationId"]]
            doc["history"].append(data)
    doc["history"] = sorted(doc["history"], key=lambda e: e["at"])[-MAX_HISTORY:]
    doc["answers"] = doc["answers"][-MAX_ANSWERS:]
    doc["receipts"] = doc["receipts"][-MAX_RECEIPTS:]
    return doc


def append_events(store, events):
    for _ in range(8):
        snapshot = store.read()
        updated = apply_events(snapshot.config, events)
        if updated == snapshot.config:
            return
        try:
            store.write(updated, snapshot.revision)
            return
        except ConfigConflict:
            continue
    raise ConfigUnavailable()
