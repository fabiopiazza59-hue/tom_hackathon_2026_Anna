# Parler avec Anna

Interface de communication reprise de la maquette `localhost:3000` : catégories, questions Oui / Non, demande de parole, épellation, programme et espace admin.

## Ouvrir le site

- [Page publique](https://tom-hackathon-2026-anna.vercel.app/)
- [Interface avec pictogrammes](https://tom-hackathon-2026-anna.vercel.app/parler), accessible depuis le bouton « Poser la question » de l’accueil.
- [Administration](https://tom-hackathon-2026-anna.vercel.app/admin) — accès protégé par les identifiants configurés dans Vercel.

[![QR code de la page publique](docs/anna-qr-code.png)](https://tom-hackathon-2026-anna.vercel.app/)

## Utilisation

L’accueil conserve la photo d’Anna. « Poser la question » ouvre le parcours avec **« Ça va ? »**, puis **catégorie → sous-catégorie → question → sous-question**. Répondre par **Oui / Non** au toucher, au clavier (**O / N**) ou avec la tête après activation de la caméra. « Je veux parler » reste une commande d’assistance indépendante.

Oui descend au niveau suivant ; Non passe à l’élément suivant du même niveau. Une phrase Non explicitement renseignée, notamment un refus d’autorisation, est restituée comme réponse et termine la branche. En fin de branche, la phrase Oui du dernier élément retenu sert de résumé. Retour permet de corriger la dernière réponse ; Accueil ouvre les pictogrammes.

Les catégories suivent `ordre_si_oui` ou `ordre_si_non` après la réponse à « Ça va ? », avec repli sur `ordre`. Les sous-catégories respectent `branche_oui_non`. Chaque niveau suit ensuite son `ordre` ; les valeurs vides viennent après les valeurs renseignées et conservent l’ordre d’import. Les égalités gardent également l’ordre d’import.

Les quatre CSV originaux sont dans `data/questions/` : **6 catégories, 27 sous-catégories, 91 questions, 117 sous-questions**. L’import vérifie les identifiants et les parents, et produit la banque initiale :

```sh
python3 scripts/import_questions.py
```

Les champs supplémentaires (`poids`, `heures_pic`, `jours`, `contraire_id`, `personne_id`, etc.) sont conservés dans les métadonnées de chaque élément. Ils n’ajoutent pas de tri ou de filtre temporel automatique. Le lieu choisi dans Réglages filtre les indicateurs `centre` / `domicile` ; par défaut, tous les lieux sont affichés.

Le bouton **Caméra** demande l’autorisation du navigateur, puis utilise MediaPipe localement : hocher = oui, tourner = non, pencher une seconde = parler. Les images restent dans le navigateur. La reconnaissance doit être calibrée avec Anna ; les boutons et le clavier restent disponibles.

## Administration et données

L’admin propose **Questions** et **Réglages**, et s’ouvre directement sur la banque. L’onglet Questions montre les cinq niveaux de la hiérarchie, avec recherche, ajout, modification et suppression. On peut modifier le texte, le libellé, le parent, les ordres, les phrases Oui/Non, la branche et les lieux autorisés. Supprimer un élément supprime aussi ses descendants après confirmation. La question de départ est modifiable mais ne peut pas être supprimée.

Les questions, les personnes et les réglages sont conservés dans un **stockage privé Vercel Blob**, commun à tous les utilisateurs et durable entre déploiements. L’admin n’annonce un enregistrement qu’après sa sauvegarde sur le serveur. Les pages publiques ouvertes vérifient les mises à jour toutes les 15 secondes et à leur retour au premier plan. Si la banque change pendant le parcours, celui-ci reprend au départ avec un message.

Au premier chargement de l’admin, si le stockage partagé est vide, la banque personnalisée de cet ancien navigateur est automatiquement importée, avec ses personnes et réglages. Ouvrir l’admin dans le navigateur qui contient les modifications à conserver. Une banque partagée déjà initialisée n’est jamais écrasée par les anciennes données locales d’un autre appareil. Les anciennes banques locales restent disponibles en sauvegarde ; la préférence vocale reste propre à chaque appareil.

Les réponses, demandes de parole, messages épelés, temps de réponse et statistiques ne sont ni enregistrés ni envoyés. Le parcours et le retour en arrière restent seulement en mémoire jusqu’au rechargement ou à la fermeture de la page. Au chargement, les anciennes interactions sont retirées du stockage local principal et de la sauvegarde de migration ; l’ancienne file d’attente est supprimée. Les questions et réglages sont conservés.

Le serveur Python ne reçoit pas les réponses. Il sert les fichiers, expose la configuration par `GET /api/config`, et protège `/admin`, `/api/admin-session` et `PUT /api/config` par HTTP Basic. Chaque écriture exige la version affichée (`If-Match`) ; une modification concurrente est refusée avec un message demandant de recharger. La structure de la banque est validée et les champs d’interactions sont refusés. Les lectures contournent le cache du stockage pour refléter immédiatement les enregistrements.

Définir `ADMIN_USERNAME`, `ADMIN_PASSWORD` et `BLOB_READ_WRITE_TOKEN` dans les variables de production Vercel. La connexion au magasin privé `anna-shared-questions` fournit le jeton Blob. Les valeurs ne sont jamais dans GitHub ni envoyées au navigateur. Sans stockage configuré en production, le serveur renvoie une erreur au lieu de prétendre enregistrer dans un fichier temporaire. Le navigateur peut conserver l’authentification jusqu’à sa fermeture.

Les polices viennent de Google Fonts et le modèle de caméra de MediaPipe/Google. La synthèse vocale utilise les voix disponibles sur l’appareil. Vercel conserve ses métadonnées habituelles de requêtes.

## Développement

Python 3.12, [uv](https://docs.astral.sh/uv/) et Node.js pour les tests JavaScript.

```sh
uv sync
export ADMIN_USERNAME="votre-identifiant"
export ADMIN_PASSWORD="votre-mot-de-passe"
uv run uvicorn app:app --reload
```

Ouvrir http://127.0.0.1:8000. Sans jeton Blob, le serveur local conserve la configuration dans `data/config.local.json` (ignoré par Git), avec verrou et remplacement atomique. `ANNA_CONFIG_FILE` permet de choisir un autre fichier. Si la configuration uv locale utilise un proxy indisponible : `uv --no-config sync`.

```sh
uv run pytest
npm test
npm run check
```

Aucune dépendance npm n’est nécessaire. Le backend reste FastAPI, avec dépendances verrouillées dans `uv.lock`.

## Publication

Le dépôt est relié à Vercel : chaque push sur `main` déclenche un déploiement de production. Le preset **FastAPI** et le point d’entrée `app.py` sont déclarés à la racine. Le magasin Blob doit être relié au projet et à l’environnement de production ; `.env.local` et `.vercel/` sont ignorés par Git.
