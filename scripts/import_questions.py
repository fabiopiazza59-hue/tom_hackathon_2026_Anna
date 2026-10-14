"""Importe les quatre CSV liés, sans modifier les fichiers source."""
import argparse
import csv
import json
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


def number(value):
    if not value.strip():
        return None
    parsed = int(value)
    if parsed < 0:
        raise ValueError("L’ordre doit être positif ou nul")
    return parsed


def import_bank(source):
    root = {"id": "master", "level": "master", "label": "Question de départ", "q": "Ça va ?", "children": []}
    bank = {"version": "csv-2026-10-14-v1", "root": root, "counts": {}}
    parents = {"": root}
    specs = [
        ("categorie", "category", "cat", None),
        ("sous_categorie", "subcategory", "subcat", "categorie_id"),
        ("question", "question", "q", "sous_categorie_id"),
        ("sous_question", "subquestion", "subq", "question_id"),
    ]
    for stem, level, prefix, parent_key in specs:
        with (source / f"{stem}-{stem}.csv").open(encoding="utf-8-sig", newline="") as file:
            rows = list(csv.DictReader(file, delimiter=";"))
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
                "label": LABELS.get(row["id"], row["id"].replace("_", " ").capitalize()),
                "q": row["question"], "order": number(row.get("ordre", "")),
                "yesText": row.get("phrase_oui", ""), "noText": row.get("phrase_non", ""),
                "centre": row.get("centre", "VRAI") == "VRAI", "domicile": row.get("domicile", "VRAI") == "VRAI",
                "children": [], "csv": row,
            }
            if level == "category":
                node.update(orderYes=number(row.get("ordre_si_oui", "")), orderNo=number(row.get("ordre_si_non", "")), icon=ICONS[row["id"]], hue=index * 55 + 10)
            if level == "subcategory":
                node["branch"] = row.get("branche_oui_non") or "les_deux"
                if node["branch"] not in ("oui", "non", "les_deux"):
                    raise ValueError(f"Branche invalide : {node['branch']}")
            parents[parent_id]["children"].append(node)
            next_parents[row["id"]] = node
        parents = next_parents
        bank["counts"][level] = len(rows)
    return bank


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "data/questions")
    parser.add_argument("--output", type=Path, default=ROOT / "static/question-bank.js")
    args = parser.parse_args()
    bank = import_bank(args.source)
    args.output.write_text("// Généré par scripts/import_questions.py à partir des CSV de data/questions.\nexport const QUESTION_BANK = " + json.dumps(bank, ensure_ascii=False, indent=2) + ";\n")
    print(json.dumps(bank["counts"], ensure_ascii=False))
