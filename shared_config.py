"""Shared question configuration, stored separately from interaction history."""
from contextvars import ContextVar
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Annotated, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator

ROOT = Path(__file__).parent
EMPTY_REVISION = '"empty"'
# Photos are small JPEGs resized in the browser, kept in the config so they follow the same versioned writes.
MAX_PHOTO = 60_000
MAX_PHOTOS_TOTAL = 3_000_000
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
    followUps: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(default_factory=list, max_length=20)
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
    paused: bool = False
    photo: str = Field(default="", max_length=MAX_PHOTO, pattern=r"^(data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2})?$")
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
        if sum(len(p.photo) for p in self.people) > MAX_PHOTOS_TOTAL:
            raise ValueError("Photos trop volumineuses : retirez-en quelques-unes")
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

    def __init__(self, token, transport=None, store_id=None):
        self.token = token
        if store_id is None:
            parts = token.split("_")
            store_id = parts[3] if len(parts) >= 5 else ""
        if not store_id.isalnum():
            raise ConfigUnavailable()
        # Sent with every API call: an OIDC token doesn't name the store, unlike a read-write token.
        self.store_id = store_id
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
            "Authorization": f"Bearer {self.token}", "x-vercel-blob-store-id": self.store_id, "x-api-version": "13",
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


def blob_token_variables():
    """Names of the Blob tokens Vercel added: BLOB_READ_WRITE_TOKEN, or another prefix chosen when connecting the store."""
    return sorted(k for k, v in os.environ.items() if k.endswith("READ_WRITE_TOKEN") and v.strip().startswith("vercel_blob_rw_"))


# Vercel sends a short-lived OIDC token with each request (x-vercel-oidc-token); app.py keeps it here.
REQUEST_OIDC_TOKEN = ContextVar("REQUEST_OIDC_TOKEN", default="")


def blob_credentials():
    """(token, store_id), like the official SDKs: Vercel OIDC with BLOB_STORE_ID first, else a read-write token."""
    store_id = os.environ.get("BLOB_STORE_ID", "").strip().removeprefix("store_")
    oidc = REQUEST_OIDC_TOKEN.get().strip() or os.environ.get("VERCEL_OIDC_TOKEN", "").strip()
    if oidc and store_id:
        return oidc, store_id
    token = blob_token()
    return (token, None) if token else None


def blob_token():
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if token:
        return token
    names = blob_token_variables()
    # Only when there is no doubt about which store to use.
    return os.environ[names[0]].strip() if len(names) == 1 else None


def storage_status():
    """What /api/health reports about the shared storage: variable names and Blob answers, never the token."""
    credentials = blob_credentials()
    store_id_set = bool(os.environ.get("BLOB_STORE_ID", "").strip())
    if not credentials:
        if not os.environ.get("VERCEL"):
            return {"mode": "fichier local"}
        detail = ("BLOB_STORE_ID présent mais aucun jeton OIDC reçu : vérifiez que OIDC Federation est activé (Settings → Security)."
                  if store_id_set else "Aucun magasin Blob : connectez un magasin Blob privé au projet (Production) puis redéployez.")
        return {"mode": "indisponible", "detail": detail, "variables": blob_token_variables() + (["BLOB_STORE_ID"] if store_id_set else [])}
    token, store_id = credentials
    try:
        store = BlobConfigStore(token, store_id=store_id)
    except ConfigUnavailable:
        return {"mode": "indisponible", "detail": "Identifiant de magasin Blob non reconnu.", "variables": blob_token_variables()}
    try:
        response = store.request("GET", store.url, params={"cache": "0"}, headers={"Authorization": f"Bearer {token}"})
    except ConfigUnavailable:
        return {"mode": "indisponible", "detail": "Magasin Blob injoignable."}
    answers = {200: "configuration enregistrée", 404: "magasin vide, banque initiale utilisée"}
    return {"mode": "blob" if response.status_code in answers else "indisponible",
            "detail": answers.get(response.status_code, f"Le magasin Blob refuse la lecture ({response.status_code})."),
            "auth": "OIDC (BLOB_STORE_ID)" if store_id else "BLOB_READ_WRITE_TOKEN" if os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip() else blob_token_variables()[0]}


def get_config_store():
    credentials = blob_credentials()
    if credentials:
        return BlobConfigStore(credentials[0], store_id=credentials[1])
    if os.environ.get("VERCEL"):
        raise ConfigUnavailable()
    return FileConfigStore(os.environ.get("ANNA_CONFIG_FILE", ROOT / "data" / "config.local.json"))
