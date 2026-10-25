from scripts.import_questions import ROOT, auto_label, import_bank, import_people
from scripts.migrate_question_bank import migrate
from scripts.update_bank_texts import PREVIOUS_VERSION, nodes, update
from shared_config import FileConfigStore

SOURCE = ROOT / "data/questions"


def old_config():
    """The shared bank as it was before the « libelle » column and suivi.csv, with a few admin edits."""
    bank = import_bank(SOURCE)
    bank["version"] = PREVIOUS_VERSION
    for node in nodes(bank["root"]):
        if node.get("csv", {}).get("libelle"):
            node["label"] = auto_label(node["sourceId"])
            node["csv"] = {k: v for k, v in node["csv"].items() if k != "libelle"}
    for node in nodes(bank["root"]):
        node.pop("followUps", None)
    by_id = {n["id"]: n for n in nodes(bank["root"])}
    by_id["subcat:boire"]["followUps"] = ["Question écrite dans l’admin ?"]
    by_id["q:avec_moi"]["label"] = "ensemble"
    by_id["q:mal_dos"]["q"] = "Question modifiée dans l’admin ?"
    return {"bank": bank, "people": import_people(SOURCE)}


def test_csv_libelle_column_gives_readable_labels():
    labels = {n["id"]: n["label"] for n in nodes(import_bank(SOURCE)["root"])}
    assert labels["q:mal_tete"] == "Mal à la tête"
    assert labels["subq:tele_lit"] == "Télé au lit"
    assert labels["q:contacter_maman"] == "maman"  # Les personnes gardent leur nom.
    assert labels["subcat:installation"] == "Position"


def test_labels_update_only_touches_automatic_labels_and_keeps_admin_edits(tmp_path):
    store = FileConfigStore(tmp_path / "config.json")
    store.write(old_config(), '"empty"')
    before = store.path.read_bytes()
    report = update(store, SOURCE)
    assert report["status"] == "dry-run" and report["updated"] == 100
    assert report["follow_ups_added"] == 106 - 3  # Boire garde sa question écrite dans l’admin.
    assert report["kept_admin_edits"] == [{"id": "q:avec_moi", "admin": "ensemble", "csv": "Parler avec toi"}]
    assert store.path.read_bytes() == before

    report = update(store, SOURCE, apply=True)
    assert report["status"] == "updated"
    bank = store.read().config["bank"]
    by_id = {n["id"]: n for n in nodes(bank["root"])}
    assert by_id["q:mal_tete"]["label"] == "Mal à la tête"
    assert by_id["q:avec_moi"]["label"] == "ensemble"
    assert by_id["q:mal_dos"]["q"] == "Question modifiée dans l’admin ?"
    assert by_id["subcat:douleur"]["followUps"][0] == "C'est une douleur forte ?"
    assert by_id["subcat:boire"]["followUps"] == ["Question écrite dans l’admin ?"]
    assert FileConfigStore(report["backup"]).read().config["bank"]["version"] == PREVIOUS_VERSION

    assert update(store, SOURCE, apply=True)["status"] == "nothing-to-do"
    # The bank now matches the CSVs: a later migration must not replace the admin’s edits.
    assert bank["version"] == import_bank(SOURCE)["version"]
    assert migrate(store, SOURCE, apply=True)["status"] == "already-migrated"
    assert {n["id"]: n for n in nodes(store.read().config["bank"]["root"])}["q:mal_dos"]["q"] == "Question modifiée dans l’admin ?"
