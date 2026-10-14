"""Shared question configuration, stored separately from interaction history."""
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator

ROOT = Path(__file__).parent
EMPTY_REVISION = '"empty"'
LEVELS = ("master", "category", "subcategory", "question", "subquestion")


def valid_days(value):
    normalized = "".join(c for c in unicodedata.normalize("NFD", value.lower()) if not unicodedata.combining(c))
    allowed = {"weekend", "week-end", "semaine", "tous", "tous les jours", "lundi", "lun", "monday", "mardi", "mar", "tuesday", "mercredi", "mer", "wednesday", "jeudi", "jeu", "thursday", "vendredi", "ven", "friday", "samedi", "sam", "saturday", "dimanche", "dim", "sunday", "1", "2", "3", "4", "5", "6", "7"}
    if value and any(v.strip() not in allowed for v in re.split(r"[;,|]+", normalized)):
        raise ValueError("Jours invalides : utilisez weekend, semaine ou les noms des jours")
    return value


def valid_peak_hours(value):
    for period in value.split(";") if value else []:
        match = re.fullmatch(r"\s*((?:[01]?\d|2[0-3])(?::[0-5]\d)?)\s*-\s*((?:[01]?\d|2[0-3])(?::[0-5]\d)?|24(?::00)?)\s*", period)
        def minute(part):
            bits = part.split(":")
            return int(bits[0]) * 60 + (int(bits[1]) if len(bits) > 1 else 0)
        if not match or minute(match[1]) == minute(match[2]):
            raise ValueError("Créneaux invalides : utilisez par exemple 8-10;12-13")
    return value


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class QuestionNode(StrictModel):
    id: str = Field(min_length=1, max_length=150)
    level: Literal["master", "category", "subcategory", "question", "subquestion"]
    q: str = Field(min_length=1, max_length=600)
    label: str = Field(min_length=1, max_length=100)
    children: list["QuestionNode"] = Field(default_factory=list, max_length=1000)
    order: int | None = Field(default=None, ge=0)
    orderYes: int | None = Field(default=None, ge=0)
    orderNo: int | None = Field(default=None, ge=0)
    yesText: str = Field(default="", max_length=600)
    noText: str = Field(default="", max_length=600)
    centre: bool = True
    domicile: bool = True
    branch: Literal["oui", "non", "les_deux"] = "les_deux"
    sourceId: str | None = Field(default=None, max_length=150)
    icon: str = Field(default="autre", max_length=80)
    hue: int | float = 180
    csv: dict[str, str] = Field(default_factory=dict)
    weight: float = Field(default=1, ge=0)
    peakHours: str = Field(default="", max_length=200)
    pinned: bool = False
    days: str = Field(default="", max_length=120)
    weekendOrder: int | None = Field(default=None, ge=0)
    oppositeId: str | None = Field(default=None, max_length=150)
    personId: str | None = Field(default=None, max_length=150)
    _days_valid = field_validator("days")(valid_days)
    _hours_valid = field_validator("peakHours")(valid_peak_hours)


class Bank(StrictModel):
    version: str = Field(max_length=100)
    root: QuestionNode
    counts: dict[str, int] = Field(default_factory=dict)
    schemaVersion: int = Field(default=1, ge=1, le=2)

    @model_validator(mode="after")
    def valid_tree(self):
        seen = {}

        def walk(node, depth):
            if depth >= len(LEVELS) or node.level != LEVELS[depth]:
                raise ValueError("Niveau de question invalide")
            if node.id in seen:
                raise ValueError("Identifiant de question en double")
            seen[node.id] = node
            if len(seen) > 5000:
                raise ValueError("Banque trop volumineuse")
            for child in node.children:
                walk(child, depth + 1)

        walk(self.root, 0)
        for node in seen.values():
            if node.oppositeId and (node.oppositeId not in seen or node.oppositeId == node.id or seen[node.oppositeId].level != node.level):
                raise ValueError("Lien de contraire invalide")
        return self


class Settings(StrictModel):
    sens: float = Field(default=1, ge=0.5, le=1.6)
    context: Literal["tous", "centre", "domicile"] = "tous"
    reco: Literal[False] = False


class Patient(StrictModel):
    display_name: str = Field(default="Anna", min_length=1, max_length=100)
    daily_plan: str = Field(default="", max_length=4000)
    settings: Settings = Field(default_factory=Settings)


class Person(StrictModel):
    id: str = Field(min_length=1, max_length=150)
    name: str = Field(min_length=1, max_length=60)
    role: str = Field(default="", max_length=80)
    kind: Literal["Famille", "Amis", "Équipe", "Rencontres"]
    gender: Literal["", "F", "H"] = ""
    groupClose: bool = False
    groupCare: bool = False
    groupCentre: bool = False
    precision: str = Field(default="", max_length=150)
    canContact: bool = True
    canSee: bool = True
    canTalk: bool = True
    days: str = Field(default="", max_length=120)
    weight: float = Field(default=1, ge=0)
    referent: bool = False
    _days_valid = field_validator("days")(valid_days)


class SharedConfig(StrictModel):
    bank: Bank
    patient: Patient = Field(default_factory=Patient)
    people: list[Person] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def valid_people_links(self):
        people = {p.id for p in self.people}
        if len(people) != len(self.people):
            raise ValueError("Identifiant de personne en double")
        def walk(node):
            if node.personId and node.personId not in people:
                raise ValueError("Personne liée introuvable")
            for child in node.children:
                walk(child)
        walk(self.bank.root)
        return self

    def export(self):
        # Every reader needs complete settings, even when an API caller omits them.
        return self.model_dump(exclude_unset=True) | {
            "patient": self.patient.model_dump(), "people": [p.model_dump() for p in self.people],
        }


def default_config():
    source = (ROOT / "static" / "question-bank.js").read_text()
    bank = json.loads(source.split("=", 1)[1].strip().removesuffix(";"))
    from scripts.import_questions import import_people
    return SharedConfig(bank=bank, people=import_people(ROOT / "data/questions")).export()


class ConfigConflict(Exception):
    pass


class ConfigUnavailable(Exception):
    pass


@dataclass
class Snapshot:
    config: dict
    revision: str
    initialized: bool = True


def seed_snapshot():
    return Snapshot(default_config(), EMPTY_REVISION, False)


class FileConfigStore:
    """Durable local development store, also used in multi-client tests."""

    def __init__(self, path):
        self.path = Path(path)

    def initial(self):
        return seed_snapshot()

    def decode(self, data):
        return SharedConfig.model_validate_json(data).export()

    def read(self, revision=None):
        try:
            data = self.path.read_bytes()
        except FileNotFoundError:
            snapshot = self.initial()
        else:
            config = self.decode(data)
            snapshot = Snapshot(config, '"' + hashlib.sha256(data).hexdigest() + '"')
        return None if snapshot.revision == revision else snapshot

    def write(self, config, revision):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.with_suffix(".lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if self.read().revision != revision:
                raise ConfigConflict()
            data = json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode()
            temporary = self.path.with_suffix(".tmp")
            temporary.write_bytes(data)
            temporary.replace(self.path)
            return Snapshot(config, '"' + hashlib.sha256(data).hexdigest() + '"')


class BlobConfigStore:
    """Private Vercel Blob with uncached reads and atomic conditional writes.

    REST headers follow vercel/storage packages/blob/src/{get,put-helpers,api}.ts.
    The Python SDK currently lacks the ifMatch write option.
    """
    pathname = "anna/config.json"

    def __init__(self, token, transport=None):
        self.token = token
        parts = token.split("_")
        if len(parts) < 5 or not parts[3].isalnum():
            raise ConfigUnavailable()
        store_id = parts[3]
        self.url = f"https://{store_id.lower()}.private.blob.vercel-storage.com/{self.pathname}"
        self.transport = transport

    def request(self, method, url, **kwargs):
        try:
            with httpx.Client(timeout=20, transport=self.transport) as client:
                return client.request(method, url, **kwargs)
        except httpx.HTTPError:
            raise ConfigUnavailable() from None

    def initial(self):
        return seed_snapshot()

    def decode(self, data):
        return SharedConfig.model_validate_json(data).export()

    def read(self, revision=None):
        headers = {"Authorization": f"Bearer {self.token}", "Accept-Encoding": "identity"}
        if revision and revision != EMPTY_REVISION:
            headers["If-None-Match"] = revision
        response = self.request("GET", self.url, params={"cache": "0"}, headers=headers)
        if response.status_code == 304:
            return None
        if response.status_code == 404:
            return None if revision == EMPTY_REVISION else self.initial()
        if response.status_code != 200 or not response.headers.get("etag"):
            raise ConfigUnavailable()
        try:
            config = self.decode(response.content)
        except ValueError:
            raise ConfigUnavailable() from None
        # The CDN can add W/ when compressing a response; writes need the storage ETag.
        return Snapshot(config, response.headers["etag"].removeprefix("W/"))

    def write(self, config, revision):
        headers = {
            "Authorization": f"Bearer {self.token}", "x-api-version": "13",
            "x-vercel-blob-access": "private", "x-add-random-suffix": "0",
            "x-content-type": "application/json", "Content-Type": "application/json",
            "x-cache-control-max-age": "60",
            "x-allow-overwrite": "0" if revision == EMPTY_REVISION else "1",
        }
        if revision != EMPTY_REVISION:
            headers["x-if-match"] = revision
        response = self.request(
            "PUT", "https://vercel.com/api/blob/", params={"pathname": self.pathname},
            content=json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode(), headers=headers,
        )
        if response.status_code in (409, 412):
            raise ConfigConflict()
        if response.status_code not in (200, 201):
            # Blob also reports an existing file / failed condition as an API error.
            try:
                error = response.json().get("error", {})
            except ValueError:
                error = {}
            if error.get("code") == "precondition_failed" or (
                revision == EMPTY_REVISION and error.get("code") == "bad_request"
                and error.get("message", "").startswith("This blob already exists")
            ):
                raise ConfigConflict()
            raise ConfigUnavailable()
        try:
            etag = response.json()["etag"]
            if not etag:
                raise ValueError()
        except (KeyError, ValueError):
            raise ConfigUnavailable() from None
        return Snapshot(config, etag)


def get_config_store():
    token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if token:
        return BlobConfigStore(token)
    if os.environ.get("VERCEL"):
        raise ConfigUnavailable()
    return FileConfigStore(os.environ.get("ANNA_CONFIG_FILE", ROOT / "data" / "config.local.json"))
