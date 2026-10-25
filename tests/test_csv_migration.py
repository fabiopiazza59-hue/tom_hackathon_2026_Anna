from pathlib import Path

from scripts.import_questions import ROOT, import_bank
from scripts.migrate_question_bank import migrate
from shared_config import FileConfigStore


def test_csv_migration_archives_bank_and_preserves_settings_history_and_later_admin_edits(tmp_path):
    old = import_bank(ROOT / "data/questions/legacy")
    old["version"] = "old-csv-v1"
    old["root"]["q"] = "Ma question personnalisée ?"
    store = FileConfigStore(tmp_path / "config.json")
    config = {"bank": old, "people": [{"id": "old-person", "name": "Ancien contact", "role": "", "kind": "Amis"}], "patient": {"display_name": "Anna", "daily_plan": "Programme conservé", "settings": {"sens": 1.25, "context": "domicile", "reco": False}}}
    store.write(config, '"empty"')
    history = tmp_path / "activity.json"
    history.write_text('{"history":["à conserver"]}')
    before = store.path.read_bytes()
    assert migrate(store, ROOT / "data/questions")["status"] == "validated-dry-run"
    assert store.path.read_bytes() == before
    report = migrate(store, ROOT / "data/questions", apply=True)
    assert report["status"] == "migrated"
    assert Path(report["backup"]).exists()
    assert FileConfigStore(report["backup"]).read().config["bank"]["counts"]["question"] == 91
    assert FileConfigStore(report["backup"]).read().config["people"][0]["id"] == "old-person"
    new = store.read()
    assert new.config["bank"]["root"]["q"] == "Ma question personnalisée ?"
    assert new.config["bank"]["counts"]["question"] == 99
    assert len(new.config["people"]) == 42
    assert all(p["id"] != "old-person" for p in new.config["people"])
    assert new.config["patient"] == config["patient"]
    assert history.read_text() == '{"history":["à conserver"]}'
    new.config["bank"]["root"]["q"] = "Édition après migration ?"
    store.write(new.config, new.revision)
    assert migrate(store, ROOT / "data/questions", apply=True)["status"] == "already-migrated"
    assert store.read().config["bank"]["root"]["q"] == "Édition après migration ?"


def test_csv_migration_keeps_photos_and_pauses_set_in_the_admin(tmp_path):
    old = import_bank(ROOT / "data/questions/legacy")
    old["version"] = "old-csv-v1"
    store = FileConfigStore(tmp_path / "config.json")
    photo = "data:image/jpeg;base64,/9j/4AAQ"
    store.write({"bank": old, "people": [{"id": "maman", "name": "maman", "kind": "Famille", "photo": photo, "paused": True}]}, '"empty"')
    migrate(store, ROOT / "data/questions", apply=True)
    people = {p["id"]: p for p in store.read().config["people"]}
    assert people["maman"]["photo"] == photo and people["maman"]["paused"] is True
    assert people["papa"]["photo"] == "" and people["papa"]["paused"] is False
