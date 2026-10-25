"""Apply CSV labels and follow-up questions to the shared bank, changing nothing else.

A label is replaced only while it still equals the old automatic label built from the id, and
follow-up questions are added only where a need has none, so admin edits are kept.
Dry run by default; --apply writes after a backup.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import shlex
import sys

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.import_questions import auto_label, import_bank
from shared_config import (
    ROOT, SharedConfig, BlobConfigStore, ConfigConflict, EMPTY_REVISION, FileConfigStore, Snapshot, get_config_store,
)

# Last CSV import before the « libelle » column and suivi.csv: such a bank matches the new CSVs once updated.
PREVIOUS_VERSION = "csv-v2-38fc10f5649a"


def nodes(root):
    return [root, *(n for child in root["children"] for n in nodes(child))]


def relabel(config, source):
    bank = import_bank(source)
    csv_nodes = {n["id"]: n for n in nodes(bank["root"])}
    wanted = {i: n for i, n in csv_nodes.items() if n["level"] != "master" and not n.get("personId")}
    new = deepcopy(config)
    updated, kept, follow_ups = [], [], 0
    for node in nodes(new["bank"]["root"]):
        if not node.get("followUps") and csv_nodes.get(node["id"], {}).get("followUps"):
            node["followUps"] = list(csv_nodes[node["id"]]["followUps"])
            follow_ups += len(node["followUps"])
        target = wanted.get(node["id"])
        if not target or node.get("personId") or node["label"] == target["label"]:
            continue
        if node["label"] == auto_label(target["sourceId"]):
            updated.append({"id": node["id"], "from": node["label"], "to": target["label"]})
            node["label"] = target["label"]
        else:
            kept.append({"id": node["id"], "admin": node["label"], "csv": target["label"]})
    # Otherwise a later CSV migration would see a new version and replace the admin’s other edits.
    if new["bank"]["version"] == PREVIOUS_VERSION:
        new["bank"]["version"] = bank["version"]
    return SharedConfig.model_validate(new).export(), updated, kept, follow_ups


class SiteStore:
    """The deployed site, through its own API: only the admin login is needed."""

    def __init__(self, url, auth):
        self.url, self.auth = url.rstrip("/"), auth

    def read(self):
        response = httpx.get(f"{self.url}/api/config", headers={"Cache-Control": "no-cache"}, timeout=30)
        response.raise_for_status()
        data = response.json()
        return Snapshot(data["config"], data["revision"], data["initialized"])

    def write(self, config, revision):
        response = httpx.put(f"{self.url}/api/config", json=config, auth=self.auth, headers={"If-Match": revision}, timeout=30)
        if response.status_code == 409:
            raise ConfigConflict()
        if response.status_code in (401, 403):
            sys.exit("Identifiant ou mot de passe admin incorrect : rien n’a été modifié.")
        if response.status_code == 422:
            sys.exit("Le site refuse les questions de suivi : déployez d’abord le nouveau code, puis relancez. Rien n’a été modifié.")
        response.raise_for_status()


def backup(store, config, stamp):
    if isinstance(store, BlobConfigStore):
        class Archive(BlobConfigStore):
            pathname = f"anna/backups/config-before-texts-{stamp}.json"
        Archive(store.token).write(config, EMPTY_REVISION)
        return Archive.pathname
    path = (store.path.with_name(f"{store.path.stem}.backup-texts-{stamp}{store.path.suffix}") if isinstance(store, FileConfigStore)
            else ROOT / "data" / f"config.local.backup-texts-{stamp}.json")
    path.write_text(json.dumps(config, ensure_ascii=False, indent=1))
    return str(path)


def update(store, source, apply=False):
    snapshot = store.read()
    if not snapshot.initialized:
        return {"status": "not-initialized", "detail": "La banque partagée n’existe pas encore : elle sera créée avec les nouveaux libellés."}
    new, updated, kept, follow_ups = relabel(snapshot.config, source)
    report = {"updated": len(updated), "follow_ups_added": follow_ups, "kept_admin_edits": kept, "examples": updated[:8]}
    if not updated and not follow_ups and new["bank"]["version"] == snapshot.config["bank"]["version"]:
        return {**report, "status": "nothing-to-do"}
    if not apply:
        return {**report, "status": "dry-run"}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    saved = backup(store, snapshot.config, stamp)
    store.write(new, snapshot.revision)
    return {**report, "status": "updated", "backup": saved}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "data/questions")
    parser.add_argument("--env-file", type=Path, help="fichier contenant BLOB_READ_WRITE_TOKEN")
    parser.add_argument("--url", help="site déployé, ex. https://tom-hackathon-2026-anna.vercel.app (demande l’identifiant admin)")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.url:
        store = SiteStore(args.url, (input("Identifiant admin : "), getpass.getpass("Mot de passe admin : ")) if args.apply else None)
    else:
        if args.env_file:
            for line in args.env_file.read_text().splitlines():
                if line.startswith("BLOB_READ_WRITE_TOKEN="):
                    os.environ["BLOB_READ_WRITE_TOKEN"] = shlex.split(line.split("=", 1)[1])[0]
        store = get_config_store()
    print(json.dumps(update(store, args.source, args.apply), ensure_ascii=False, indent=1))
