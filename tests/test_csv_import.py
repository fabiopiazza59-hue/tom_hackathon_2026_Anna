import shutil

import pytest

from scripts.import_questions import ROOT, import_bank, import_people


def test_csv_counts_and_relations():
    bank = import_bank(ROOT / "data/questions")
    assert bank["counts"] == {"category": 6, "subcategory": 27, "question": 99, "subquestion": 120}
    assert bank["root"]["q"] == "Ça va ?"
    assert bank["root"]["children"][0]["children"][0]["children"][0]["sourceId"] == "mal_dos"


def test_empty_order_is_accepted(tmp_path):
    source = tmp_path / "csv"
    shutil.copytree(ROOT / "data/questions", source)
    path = source / "categorie.csv"
    content = path.read_text(encoding="utf-8-sig").replace("corps,1,1,2,", "corps,,1,2,")
    path.write_text(content)
    assert import_bank(source)["root"]["children"][0]["order"] is None


def test_orphan_is_rejected(tmp_path):
    source = tmp_path / "csv"
    shutil.copytree(ROOT / "data/questions", source)
    path = source / "question.csv"
    content = path.read_text(encoding="utf-8-sig").replace("mal_dos,douleur,", "mal_dos,absent,")
    path.write_text(content)
    with pytest.raises(ValueError, match="Parent introuvable"):
        import_bank(source)


def test_new_flags_decimal_weights_and_person_relations():
    bank = import_bank(ROOT / "data/questions")
    def walk(node):
        return [node, *(n for c in node["children"] for n in walk(c))]
    nodes = {n["id"]: n for n in walk(bank["root"])}
    people = import_people(ROOT / "data/questions")
    assert len(people) == 42
    assert nodes["q:chocolat"]["weight"] == 0.5
    assert nodes["q:chocolat"]["centre"] is False
    assert nodes["q:repas"]["pinned"] is True
    assert nodes["q:repas"]["peakHours"] == "8-10;12-13;16-17;18-20"
    assert nodes["q:trop_chaud"]["oppositeId"] == "q:trop_froid"
    assert nodes["subq:contacter_roxane"]["weekendOrder"] == 1
    assert nodes["subq:contacter_roxane"]["personId"] == "roxane"
    assert nodes["q:contacter_maman"]["personId"] == "maman"
    assert next(p for p in people if p["id"] == "roxane")["weight"] == 1.2


def test_previous_semicolon_and_french_booleans_remain_readable():
    bank = import_bank(ROOT / "data/questions/legacy")
    assert bank["counts"]["question"] == 91
    assert bank["root"]["children"][0]["centre"] is True
