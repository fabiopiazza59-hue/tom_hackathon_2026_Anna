# Parler avec Anna

Interface de communication reprise de la maquette `localhost:3000` : catégories, questions Oui / Non, demande de parole, épellation, programme et espace admin.

## Ouvrir le site

- [Page publique](https://tom-hackathon-2026-anna.vercel.app/)
- [Interface avec pictogrammes](https://tom-hackathon-2026-anna.vercel.app/parler), accessible depuis le bouton « Poser la question » de l’accueil.
- [Administration](https://tom-hackathon-2026-anna.vercel.app/admin) — accès protégé par les identifiants configurés dans Vercel.

[![QR code de la page publique](docs/anna-qr-code.png)](https://tom-hackathon-2026-anna.vercel.app/)

## Utilisation

Choisir une catégorie ou « Tout parcourir », puis répondre avec les boutons **Non · Je veux parler · Oui**. Raccourcis clavier : **N / P / O**, ou flèches gauche/droite pour Non/Oui. « Épeler » permet de composer un message lettre par lettre.

Le bouton **Caméra** active, après autorisation du navigateur, la détection locale des mouvements de tête : hocher = oui, tourner = non, pencher une seconde = parler. Le modèle MediaPipe est téléchargé à l’activation ; les images restent dans le navigateur. La reconnaissance doit être essayée et calibrée avec Anna ; le fonctionnement tactile et clavier reste disponible.

## Administration et données

L’admin propose **Résumé**, **Questions** et **Réglages** : historique, banque de questions et sous-questions, thèmes, catégories, personnes, programme et amplitude des mouvements.

Cette version conserve les données dans le **stockage local du navigateur**. Les modifications de l’admin sont visibles sur la page publique du même navigateur. Elles ne sont pas synchronisées entre appareils et disparaissent si les données du site sont effacées. Les noms et le programme initiaux viennent des exemples de la maquette ; ils peuvent être remplacés dans Réglages. L’historique couvre 60 jours et les statistiques 180 jours. Les thèmes privés ne sont pas enregistrés. Les préférences vocales et une file d’écritures en attente sont également locales.

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
