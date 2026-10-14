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

Les catégories suivent `ordre_si_oui` ou `ordre_si_non` après la réponse à « Ça va ? », avec repli sur `ordre`. Les sous-catégories respectent `branche_oui_non`. Chaque niveau suit ensuite son `ordre` ; les valeurs vides viennent après les valeurs renseignées et conservent l’ordre d’import. Les égalités gardent également l’ordre d’import. Les statistiques d’utilisation ne réordonnent pas cette banque.

Les quatre CSV originaux sont dans `data/questions/` : **6 catégories, 27 sous-catégories, 91 questions, 117 sous-questions**. L’import vérifie les identifiants et les parents, et produit la banque initiale :

```sh
python3 scripts/import_questions.py
```

Les champs supplémentaires (`poids`, `heures_pic`, `jours`, `contraire_id`, `personne_id`, etc.) sont conservés dans les métadonnées de chaque élément. Ils n’ajoutent pas de tri ou de filtre temporel automatique. Le lieu choisi dans Réglages filtre les indicateurs `centre` / `domicile` ; par défaut, tous les lieux sont affichés.

Le bouton **Caméra** demande l’autorisation du navigateur, puis utilise MediaPipe localement : hocher = oui, tourner = non, pencher une seconde = parler. Les images restent dans le navigateur. La reconnaissance doit être calibrée avec Anna ; les boutons et le clavier restent disponibles.

## Administration et données

L’admin propose **Résumé**, **Questions** et **Réglages**. L’onglet Questions montre les cinq niveaux de la hiérarchie, avec recherche, ajout, modification et suppression. On peut modifier le texte, le libellé, le parent, les ordres, les phrases Oui/Non, la branche et les lieux autorisés. Supprimer un élément supprime aussi ses descendants après confirmation. La question de départ est modifiable mais ne peut pas être supprimée.

Cette version conserve les données dans le **stockage local du navigateur**. Les modifications de l’admin sont visibles sur la page publique du même navigateur. Elles ne sont pas synchronisées entre appareils et disparaissent si les données du site sont effacées. Au premier chargement de cette version, la banque de démonstration précédente est sauvegardée dans `anna-before-csv-v1` avant remplacement par les CSV. Les personnes, le programme et l’historique existants sont conservés. Les modifications ultérieures de la nouvelle banque restent enregistrées et ne sont pas écrasées à chaque visite. L’historique couvre 60 jours et les statistiques 180 jours. Les thèmes privés ne sont pas enregistrés. Les préférences vocales et une file d’écritures en attente sont également locales.

Le serveur Python ne reçoit pas les réponses. Il sert les fichiers et protège `/admin` et `/api/admin-session` par HTTP Basic. Définir `ADMIN_USERNAME` et `ADMIN_PASSWORD` dans les variables de production Vercel ; les valeurs ne sont pas dans GitHub. Sans ces variables, l’admin reste inaccessible. Le navigateur peut conserver l’authentification jusqu’à sa fermeture.

Les polices viennent de Google Fonts et le modèle de caméra de MediaPipe/Google. La synthèse vocale utilise les voix disponibles sur l’appareil. Vercel conserve ses métadonnées habituelles de requêtes.

## Développement

Python 3.12, [uv](https://docs.astral.sh/uv/) et Node.js pour les tests JavaScript.

```sh
uv sync
export ADMIN_USERNAME="votre-identifiant"
export ADMIN_PASSWORD="votre-mot-de-passe"
uv run uvicorn app:app --reload
```

Ouvrir http://127.0.0.1:8000. Si la configuration uv locale utilise un proxy indisponible : `uv --no-config sync`.

```sh
uv run pytest
npm test
npm run check
```

Aucune dépendance npm n’est nécessaire. Le backend reste FastAPI, avec dépendances verrouillées dans `uv.lock`.

## Publication

Le dépôt est relié à Vercel : chaque push sur `main` déclenche un déploiement de production. Le preset **FastAPI** et le point d’entrée `app.py` sont déclarés à la racine. Aucun service de base de données n’est nécessaire pour cette version locale.
