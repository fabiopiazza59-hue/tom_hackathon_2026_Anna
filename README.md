# Parler avec Anna

Interface de communication reprise de la maquette `localhost:3000` : catégories, questions Oui / Non, demande de parole, épellation, programme et espace admin.

## Ouvrir le site

- [Page publique](https://tom-hackathon-2026-anna.vercel.app/)
- [Interface avec pictogrammes](https://tom-hackathon-2026-anna.vercel.app/parler), accessible depuis le bouton « Poser la question » de l’accueil.
- [Administration](https://tom-hackathon-2026-anna.vercel.app/admin) — accès protégé par les identifiants configurés dans Vercel.

[![QR code de la page publique](docs/anna-qr-code.png)](https://tom-hackathon-2026-anna.vercel.app/)

## Utilisation

L’accueil conserve la photo d’Anna. « Poser la question » ouvre la nouvelle interface : **« Coucou, est-ce que tu veux parler ? »**, puis la question de départ de la banque (**« Ça va ? »**). La réponse détermine l’ordre des thèmes et les branches disponibles. « Non, pas maintenant » affiche un écran calme avec un bouton Reprendre. On peut aussi passer directement aux thèmes.

La grille reprend la maquette `localhost:3000` : une ligne Top 3, puis une ligne par sous-catégorie avec trois pictogrammes et Voir plus. La pagination donne accès à tous les thèmes. Un pictogramme ouvre directement la question correspondante ; Tout parcourir conserve le parcours **catégorie → sous-catégorie → question → sous-question**. Les textes viennent de la banque partagée, sans réimporter les questions de démonstration.

Répondre par **Oui / Non** au toucher, au clavier (**O / N**) ou avec la tête après activation de la caméra. « Je veux parler » reste une commande d’assistance indépendante.

Oui descend au niveau suivant ; Non passe à l’élément suivant du même niveau. Une phrase Non explicitement renseignée, notamment un refus d’autorisation, est restituée comme réponse et termine la branche. En fin de branche, la phrase Oui du dernier élément retenu est affichée. Retour permet de corriger la dernière réponse ; Accueil revient à l’ouverture.

Les catégories suivent `ordre_si_oui` ou `ordre_si_non` après la réponse à « Ça va ? », avec repli sur `ordre`. Les sous-catégories respectent `branche_oui_non`. Chaque niveau suit ensuite son `ordre` ; les valeurs vides viennent après les valeurs renseignées et conservent l’ordre d’import. Les égalités gardent également l’ordre d’import.

Les quatre CSV originaux sont dans `data/questions/` : **6 catégories, 27 sous-catégories, 91 questions, 117 sous-questions**. L’import vérifie les identifiants et les parents, et produit la banque initiale :

```sh
python3 scripts/import_questions.py
```

Les champs supplémentaires (`poids`, `heures_pic`, `jours`, `contraire_id`, `personne_id`, etc.) sont conservés dans les métadonnées de chaque élément. Ils n’ajoutent pas de tri ou de filtre temporel automatique. Le lieu choisi dans Réglages filtre les indicateurs `centre` / `domicile` ; par défaut, tous les lieux sont affichés.

Le bouton **Caméra** demande l’autorisation du navigateur, puis utilise MediaPipe localement, comme la maquette : tête vers sa gauche = oui, vers sa droite = non, pencher une seconde = parler. La caméra arrière est privilégiée pour qu’un accompagnant tienne le téléphone face à Anna. Les images restent dans le navigateur. La reconnaissance doit être calibrée avec Anna ; les boutons et le clavier restent disponibles.

## Administration et données

L’admin propose **Résumé**, **Questions** et **Réglages**, et s’ouvre directement sur la banque. Résumé affiche l’historique partagé et les réponses détaillées, avec filtre par thème et actualisation. L’onglet Questions montre les cinq niveaux de la hiérarchie, avec recherche, ajout, modification et suppression. On peut modifier le texte, le libellé, le parent, les ordres, les phrases Oui/Non, la branche et les lieux autorisés. Supprimer un élément supprime aussi ses descendants après confirmation. La question de départ est modifiable mais ne peut pas être supprimée. Pendant une sauvegarde, le bouton affiche « Enregistrement en cours… » et empêche les doubles envois.

Les questions, les personnes et les réglages sont conservés dans un **stockage privé Vercel Blob**, commun à tous les utilisateurs et durable entre déploiements. L’admin n’annonce un enregistrement qu’après sa sauvegarde sur le serveur. Les pages publiques ouvertes vérifient les mises à jour toutes les 15 secondes et à leur retour au premier plan. Si la banque change pendant le parcours, celui-ci reprend au départ avec un message.

Au premier chargement de l’admin, si le stockage partagé est vide, la banque personnalisée de cet ancien navigateur est automatiquement importée, avec ses personnes et réglages. Ouvrir l’admin dans le navigateur qui contient les modifications à conserver. Une banque partagée déjà initialisée n’est jamais écrasée par les anciennes données locales d’un autre appareil. Les anciennes banques locales restent disponibles en sauvegarde ; la préférence vocale reste propre à chaque appareil.

À partir de cette version, les réponses Oui/Non, les temps de réponse et les résultats des échanges (y compris demandes de parole et messages épelés) sont enregistrés dans **`anna/activity.json`**, séparément de la configuration **`anna/config.json`**. Il n’y a aucun identifiant permanent de personne ou d’appareil. Les identifiants aléatoires des échanges et envois permettent les corrections et la déduplication. Les réponses en attente restent sur l’appareil jusqu’à confirmation du serveur et sont renvoyées après reconnexion. La fenêtre de déduplication conserve les 5 000 derniers identifiants. Les échanges supprimés par l’ancienne version ne sont pas reconstitués.

L’historique conserve les **300 derniers échanges** et les **2 000 dernières réponses détaillées**. Les statistiques par question sont cumulatives : nombre de réponses, Oui/Non, temps cumulé et heures habituelles des Oui (heure de Paris). Le Top 3 s’appuie sur le taux de Oui (50 %), l’usage relatif (30 %) et la rapidité (20 %), avec un bonus pour l’heure habituelle. Après la question de départ, il propose un besoin par thème prioritaire selon les ordres et branches de la banque. Le parcours complet conserve toujours les ordres explicites. Les statistiques d’ouverture ne biaisent pas le score d’usage des questions.

Le serveur Python conserve FastAPI et les mêmes identifiants. `GET /api/config` fournit la banque ; `PUT /api/config`, `/admin`, `/api/admin-session` et **`GET /api/history`** sont protégés par HTTP Basic. `POST /api/interactions` reçoit les événements validés et `GET /api/usage` ne fournit que les statistiques agrégées pour le Top 3. Aucun texte d’échange ni réponse individuelle n’est accessible via cet endpoint public. La configuration refuse toujours les champs d’interactions.

Chaque écriture de configuration exige la version affichée (`If-Match`) ; une modification concurrente est refusée avec un message demandant de recharger. Les écritures d’usages utilisent aussi une condition de version et sont fusionnées après conflit afin de conserver les réponses de plusieurs utilisateurs. Les lectures contournent le cache du stockage pour refléter les enregistrements.

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

Ouvrir http://127.0.0.1:8000. Sans jeton Blob, le serveur local utilise `data/config.local.json` et `data/activity.local.json` (ignorés par Git), avec verrou et remplacement atomique. `ANNA_CONFIG_FILE` et `ANNA_ACTIVITY_FILE` permettent de choisir d’autres fichiers. Si la configuration uv locale utilise un proxy indisponible : `uv --no-config sync`.

```sh
uv run pytest
npm test
npm run check
```

Aucune dépendance npm n’est nécessaire. Le backend reste FastAPI, avec dépendances verrouillées dans `uv.lock`.

## Publication

Le dépôt est relié à Vercel : chaque push sur `main` déclenche un déploiement de production. Le preset **FastAPI** et le point d’entrée `app.py` sont déclarés à la racine. Le magasin Blob doit être relié au projet et à l’environnement de production ; `.env.local` et `.vercel/` sont ignorés par Git.
