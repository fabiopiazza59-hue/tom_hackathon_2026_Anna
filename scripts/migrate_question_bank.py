"""Validate and explicitly migrate a CSV bank; archive before the atomic replacement."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shlex
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.import_questions import import_bank, import_people
from shared_config import ROOT, SharedConfig, BlobConfigStore, FileConfigStore, EMPTY_REVISION, get_config_store


def replacement(current, source):
    bank = import_bank(source)
    # The master question has no CSV row, so retain its admin edits.
    bank["root"].update({k: v for k, v in current["bank"]["root"].items() if k != "children"})
    # Photos and pauses are only set in the admin, so keep them for people still in the CSV.
    kept = {p["id"]: p for p in current.get("people", [])}
    people = [p | {k: kept[p["id"]][k] for k in ("photo", "paused") if k in kept.get(p["id"], {})} for p in import_people(source)]
    # The five supplied CSVs are the new authoritative dataset; the archive retains older rows.
    return SharedConfig.model_validate({**current, "bank": bank, "people": people}).export()


def migrate(store, source, apply=False):
    snapshot = store.read()
    new = replacement(snapshot.config, source)
    report = {"before": snapshot.config["bank"].get("counts", {}), "after": new["bank"]["counts"], "people": len(new["people"]), "version": new["bank"]["version"]}
    if snapshot.config["bank"]["version"] == new["bank"]["version"]:
        return {**report, "status": "already-migrated"}
    if not apply:
        return {**report, "status": "validated-dry-run"}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    if isinstance(store, BlobConfigStore):
        class Archive(BlobConfigStore):
            pathname = f"anna/backups/config-before-{new['bank']['version']}-{stamp}.json"
        archive = Archive(store.token)
        archive.write(snapshot.config, EMPTY_REVISION)
        backup = archive.pathname
    else:
        backup = store.path.with_name(f"{store.path.stem}.backup-{stamp}{store.path.suffix}")
        FileConfigStore(backup).write(snapshot.config, EMPTY_REVISION)
        backup = str(backup)
    store.write(new, snapshot.revision)
    return {**report, "status": "migrated", "backup": backup}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "data/questions")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.env_file:
        for line in args.env_file.read_text().splitlines():
            if line.startswith("BLOB_READ_WRITE_TOKEN="):
                os.environ["BLOB_READ_WRITE_TOKEN"] = shlex.split(line.split("=", 1)[1])[0]
    print(json.dumps(migrate(get_config_store(), args.source, args.apply), ensure_ascii=False))
