import shutil

import pytest

from scripts.import_questions import ROOT, import_bank


def test_csv_counts_and_relations():
    bank = import_bank(ROOT / "data/questions")
    assert bank["counts"] == {"category": 6, "subcategory": 27, "question": 91, "subquestion": 117}
    assert bank["root"]["q"] == "Ça va ?"
    assert bank["root"]["children"][0]["children"][0]["children"][0]["sourceId"] == "mal_dos"


def test_empty_order_is_accepted(tmp_path):
    source = tmp_path / "csv"
    shutil.copytree(ROOT / "data/questions", source)
    path = source / "categorie-categorie.csv"
    content = path.read_text(encoding="utf-8-sig").replace("corps;1;1;2;", "corps;;1;2;")
    path.write_text(content)
    assert import_bank(source)["root"]["children"][0]["order"] is None


def test_orphan_is_rejected(tmp_path):
    source = tmp_path / "csv"
    shutil.copytree(ROOT / "data/questions", source)
    path = source / "question-question.csv"
    content = path.read_text(encoding="utf-8-sig").replace("mal_dos;douleur;", "mal_dos;absent;")
    path.write_text(content)
    with pytest.raises(ValueError, match="Parent introuvable"):
        import_bank(source)
