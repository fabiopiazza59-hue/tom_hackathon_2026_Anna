"""Importe la banque et la table des personnes, sans modifier les CSV source."""
import argparse
import csv
import json
import hashlib
import io
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABELS = {
    "corps": "Corps", "ressenti": "Ressenti", "autres": "Personnes", "activites": "Activités",
    "dire": "Échanger", "accord": "Accord", "douleur": "Douleur", "installation": "Position",
    "gene": "Gêne", "manger": "Manger", "boire": "Boire", "repos": "Repos", "bien": "Tout va bien",
    "difficile": "Ressenti difficile", "ennui": "Ennui", "probleme": "Problème", "contacter": "Contacter",
    "voir": "Voir quelqu’un", "parler": "Parler à quelqu’un", "compagnie": "Compagnie", "seule": "Être seule",
    "ecouter_regarder": "Écouter / regarder", "animaux": "Animaux", "detente": "Détente", "ateliers": "Ateliers",
    "balade": "Balade", "sorties": "Sorties", "evenements": "Événements", "vacances": "Vacances",
    "raconter": "Raconter", "savoir": "Savoir", "mes_affaires": "Chez moi", "mon_corps_accord": "Mon corps",
}
ICONS = {"corps": "position", "ressenti": "emotions", "autres": "personnes", "activites": "activites", "dire": "interaction", "accord": "yes"}


def auto_label(source_id):
    """Label used before the CSV « libelle » column existed: a known name, else the id."""
    return LABELS.get(source_id, source_id.replace("_", " ").capitalize())


def number(value):
    if not value.strip():
        return None
    parsed = int(value)
    if parsed < 0:
        raise ValueError("L’ordre doit être positif ou nul")
    return parsed


def decimal(value):
    parsed = float(value.replace(",", ".") or "1")
    if parsed < 0 or not parsed < float("inf"):
        raise ValueError("Le poids doit être un nombre positif ou nul")
    return parsed


def boolean(value, default=True):
    if value is None or not value.strip():
        return default
    normalized = value.strip().upper()
    if normalized not in ("TRUE", "FALSE", "VRAI", "FAUX", "1", "0"):
        raise ValueError(f"Booléen invalide : {value}")
    return normalized in ("TRUE", "VRAI", "1")


def csv_path(source, stem):
    for name in (f"{stem}.csv", f"Anna_bdd - {stem}.csv", f"{stem}-{stem}.csv"):
        if (source / name).exists():
            return source / name
    raise FileNotFoundError(f"CSV manquant : {stem}")


def read_rows(source, stem):
    content = csv_path(source, stem).read_text(encoding="utf-8-sig")
    delimiter = csv.Sniffer().sniff(content[:8192], delimiters=",;").delimiter
    rows = list(csv.DictReader(io.StringIO(content), delimiter=delimiter))
    seen = set()
    for row in rows:
        if None in row or not row.get("id") or row["id"] in seen or any(v is None for v in row.values()):
            raise ValueError(f"Identifiant dupliqué ou ligne invalide dans {stem}")
        seen.add(row["id"])
    return rows


def import_people(source):
    try:
        rows = read_rows(source, "personnes")
    except FileNotFoundError:
        return []
    return [{
        "id": r["id"], "name": r["prenom_dit"], "gender": r["genre"], "role": r["role"],
        "kind": "Famille" if boolean(r["groupe_proche"]) else "Équipe",
        "groupClose": boolean(r["groupe_proche"]), "groupCare": boolean(r["groupe_soins"]),
        "groupCentre": boolean(r["groupe_centre"]), "precision": r["precision"],
        "canContact": boolean(r["contacter"]), "canSee": boolean(r["voir"]), "canTalk": boolean(r["parler"]),
        "days": r["jours"], "weight": decimal(r["poids"]), "referent": boolean(r["referent"], False),
    } for r in rows]


def import_bank(source):
    root = {"id": "master", "level": "master", "label": "Question de départ", "q": "Ça va ?", "children": []}
    people = {p["id"]: p for p in import_people(source)}
    fingerprint = hashlib.sha256()
    for stem in ("categorie", "sous_categorie", "question", "sous_question"):
        fingerprint.update(csv_path(source, stem).read_bytes())
    if people:
        fingerprint.update(csv_path(source, "personnes").read_bytes())
    try:
        follow_up_rows = read_rows(source, "suivi")
        fingerprint.update(csv_path(source, "suivi").read_bytes())
    except FileNotFoundError:
        follow_up_rows = []
    bank = {"version": f"csv-v2-{fingerprint.hexdigest()[:12]}", "schemaVersion": 2, "root": root, "counts": {}}
    parents = {"": root}
    specs = [
        ("categorie", "category", "cat", None),
        ("sous_categorie", "subcategory", "subcat", "categorie_id"),
        ("question", "question", "q", "sous_categorie_id"),
        ("sous_question", "subquestion", "subq", "question_id"),
    ]
    for stem, level, prefix, parent_key in specs:
        rows = read_rows(source, stem)
        next_parents = {}
        for index, row in enumerate(rows):
            if None in row or not row.get("id") or not row.get("question"):
                raise ValueError(f"Ligne invalide dans {stem}, ligne {index + 2}")
            if row["id"] in next_parents:
                raise ValueError(f"Identifiant dupliqué : {row['id']}")
            parent_id = row[parent_key] if parent_key else ""
            if parent_id not in parents:
                raise ValueError(f"Parent introuvable pour {row['id']} : {parent_id}")
            node = {
                "id": f"{prefix}:{row['id']}", "sourceId": row["id"], "level": level,
                "label": (row.get("libelle") or "").strip() or auto_label(row["id"]),
                "q": row["question"], "order": number(row.get("ordre", "")),
                "yesText": row.get("phrase_oui", ""), "noText": row.get("phrase_non", ""),
                "centre": boolean(row.get("centre")), "domicile": boolean(row.get("domicile")),
                "weight": decimal(row.get("poids", "1")), "peakHours": row.get("heures_pic", ""),
                "pinned": boolean(row.get("epingler_pic"), False), "days": row.get("jours", ""),
                "weekendOrder": number(row.get("ordre_weekend", "")),
                "oppositeId": f"{prefix}:{row['contraire_id']}" if row.get("contraire_id") else None,
                "personId": (row.get("personne_id") or None) if people else None,
                "children": [], "csv": row,
            }
            if level == "question" and any(row["id"].startswith(a + "_") for a in ("contacter", "voir", "parler")):
                person_id = row["id"].split("_", 1)[1]
                if person_id in people:
                    node["personId"] = person_id
            if node["personId"]:
                if node["personId"] not in people:
                    raise ValueError(f"Personne introuvable : {node['personId']}")
                node["label"] = people[node["personId"]]["name"]
            if level == "category":
                node.update(orderYes=number(row.get("ordre_si_oui", "")), orderNo=number(row.get("ordre_si_non", "")), icon=ICONS.get(row["id"], "autre"), hue=index * 55 + 10)
            if level == "subcategory":
                node["branch"] = row.get("branche_oui_non") or "les_deux"
                if node["branch"] not in ("oui", "non", "les_deux"):
                    raise ValueError(f"Branche invalide : {node['branch']}")
            parents[parent_id]["children"].append(node)
            next_parents[row["id"]] = node
        parents = next_parents
        bank["counts"][level] = len(rows)
    def flatten(node):
        return [node, *(n for c in node["children"] for n in flatten(c))]
    nodes = {n["id"]: n for n in flatten(root)}
    # Questions de suivi : proposées à l’entourage une fois le besoin trouvé.
    for row in sorted(follow_up_rows, key=lambda r: (number(r.get("ordre", "")) is None, number(r.get("ordre", "")) or 0)):
        if row["element_id"] not in nodes or not row["question"].strip():
            raise ValueError(f"Question de suivi invalide : {row['id']} ({row['element_id']})")
        nodes[row["element_id"]].setdefault("followUps", []).append(row["question"].strip())
    for node in nodes.values():
        opposite = node.get("oppositeId")
        if opposite and (opposite not in nodes or opposite == node["id"] or nodes[opposite]["level"] != node["level"]):
            raise ValueError(f"Contraire invalide pour {node['id']} : {opposite}")
    return bank


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "data/questions")
    parser.add_argument("--output", type=Path, default=ROOT / "static/question-bank.js")
    args = parser.parse_args()
    bank = import_bank(args.source)
    args.output.write_text("// Généré par scripts/import_questions.py à partir des CSV de data/questions.\nexport const QUESTION_BANK = " + json.dumps(bank, ensure_ascii=False, indent=2) + ";\n")
    print(json.dumps(bank["counts"], ensure_ascii=False))
