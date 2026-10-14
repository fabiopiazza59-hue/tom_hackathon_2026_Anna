// Contenu initial de la banque de questions (tutoiement, Anna au féminin).
// Utilisé uniquement par le script de seed : ensuite tout vit en base et s'édite dans l'espace soignant.

const T = (l, q, then, o = {}) => ({ l, q, then, ...o });
const kids = arr => arr.map(([l, q]) => T(l, q));
const A = (l, ask) => ({ l, q: `Demander : « ${ask} »`, ask });
const D = (l, ask) => ({ l, q: `Dire : « ${ask} »`, ask, say: true });

export const TYPES = [
  { id: 'besoins', name: 'Besoins essentiels', short: 'Besoins', icon: 'soif', h: 195 },
  { id: 'emotions', name: 'Émotions & douleurs', short: 'Émotions', icon: 'emotions', h: 350 },
  { id: 'interaction', name: 'Interaction', short: 'Échanger', icon: 'interaction', h: 300 },
  { id: 'personnes', name: 'Personnes', short: 'Personnes', icon: 'personnes', h: 265 },
  { id: 'proches', name: 'Proches', short: 'Proches', icon: 'proches', h: 25 },
  { id: 'centre', name: 'Le centre', short: 'Centre', icon: 'passerelle', h: 170 },
  { id: 'activites', name: 'Activités', short: 'Activités', icon: 'activites', h: 95 },
  { id: 'autres', name: 'Autres', short: 'Autres', icon: 'autre', h: 220 },
];

export const THEMES = [
  { id: 'interaction', label: 'Poser une question', type: 'interaction', sub: 'Anna demande à quelqu’un', icon: 'interaction', items: [
    A('Ça va ?', 'Comment ça va ?'),
    A('Ta journée', 'Qu’est-ce que tu as fait aujourd’hui ?'),
    A('Ton programme', 'C’est quoi ton programme aujourd’hui ?'),
    A('Mon programme', 'Qu’est-ce qui est prévu pour moi aujourd’hui ?'),
    A('Quoi de neuf', 'Quoi de neuf ?'),
    A('La famille', 'Comment va la famille ?'),
    A('Bien dormi', 'Tu as bien dormi ?'),
    A('La météo', 'Il fait quel temps dehors ?'),
    A('Combien de temps', 'Tu restes combien de temps ?'),
    A('Prochaine visite', 'Tu reviens quand ?'),
    A('Raconte', 'Tu peux me raconter quelque chose ?'),
    A('Les nouvelles', 'Qu’est-ce qui se passe dans le monde ?'),
    T('Autre question', 'Tu veux épeler ta question ?', null, { action: 'spell' }),
  ], deeper: ['Tu veux en savoir plus ?', 'Tu veux poser une autre question ?', 'Ça te fait plaisir ?', 'Tu veux que je revienne te raconter la suite ?'] },
  { id: 'dire', label: 'Dire quelque chose', type: 'interaction', sub: 'Merci, bonjour…', icon: 'dire', items: [
    D('Bonjour', 'Bonjour !'),
    D('Merci', 'Merci.'),
    D('Contente', 'Je suis contente de te voir.'),
    D('Tu m’as manqué', 'Tu m’as manqué.'),
    D('Je t’aime', 'Je t’aime.'),
    D('Bonne journée', 'Bonne journée !'),
    D('Pas maintenant', 'Pas maintenant, s’il te plaît.'),
    D('Attends', 'Attends, laisse-moi réfléchir.'),
    D('Tu as raison', 'Tu as raison.'),
    D('Pas d’accord', 'Je ne suis pas d’accord.'),
    D('Au revoir', 'Au revoir, à bientôt.'),
    T('Autre chose', 'Tu veux épeler ce que tu veux dire ?', null, { action: 'spell' }),
  ], deeper: ['Tu veux ajouter quelque chose ?', 'Tu veux le dire à quelqu’un d’autre aussi ?'] },
  { id: 'soif', label: 'Boire / manger', type: 'besoins', sub: 'Soif, faim', icon: 'soif', items: [
    T('Boire', 'Tu veux boire ?', kids([['Eau', 'De l’eau ?'], ['Jus', 'Un jus de fruit ?'], ['Boisson chaude', 'Une boisson chaude (thé, café) ?'], ['Eau gazeuse', 'De l’eau gazeuse ?']])),
    T('Manger', 'Tu as faim ?', kids([['Collation', 'Une collation ?'], ['Repas', 'C’est pour le repas ?'], ['Sucré', 'Quelque chose de sucré ?'], ['Salé', 'Quelque chose de salé ?']])),
    T('Bouche sèche', 'Tu as la bouche sèche ?'),
    T('Nausée', 'Tu as la nausée ?'),
  ], deeper: ['Avec une paille ?', 'Plutôt frais ?', 'En petite quantité ?', 'Ça passe bien quand tu avales ?', 'Tu veux que je reste pendant que tu bois ?'] },
  { id: 'hygiene', label: 'Toilette', type: 'besoins', sub: 'Change, aspiration', icon: 'hygiene', items: [
    T('Change', 'Tu as besoin d’être changée ?'),
    T('Aspiration', 'Tu as besoin d’une aspiration ?'),
    T('Yeux', 'Tes yeux te gênent ?'),
    T('Toilette', 'Tu veux faire ta toilette ?'),
    T('Dents', 'Tu veux te brosser les dents ?'),
    T('Coiffure', 'Tu veux être coiffée ?'),
    T('Mouchage', 'Tu as besoin d’être mouchée ?'),
  ], deeper: ['Maintenant ?', 'Tu préfères une personne en particulier ?', 'Tu veux que la porte soit fermée ?', 'Tu veux de la musique pendant le soin ?'] },
  { id: 'position', label: 'Position', type: 'besoins', sub: 'Lit, coussin', icon: 'position', items: [
    T('Changer de position', 'Tu veux changer de position ?', kids([['Côté gauche', 'Sur le côté gauche ?'], ['Côté droit', 'Sur le côté droit ?'], ['Sur le dos', 'Sur le dos ?'], ['Au fauteuil', 'Au fauteuil ?']])),
    T('Remonter', 'Tu veux qu’on te remonte dans le lit ?'),
    T('Dossier', 'Tu veux régler le dossier ?', kids([['Plus haut', 'Plus redressée ?'], ['Plus bas', 'Plus allongée ?']])),
    T('Tête / coussin', 'Il faut ajuster ta tête ou ton coussin ?'),
    T('Bras / jambe', 'Il faut bouger un bras ou une jambe ?', kids([['Bras gauche', 'Le bras gauche ?'], ['Bras droit', 'Le bras droit ?'], ['Jambe gauche', 'La jambe gauche ?'], ['Jambe droite', 'La jambe droite ?']])),
    T('Démangeaison', 'Ça te gratte ?', kids([['Visage', 'Au visage ?'], ['Tête', 'Sur la tête ?'], ['Corps', 'Sur le corps ?'], ['Bras / jambes', 'Aux bras ou aux jambes ?']])),
    T('Drap / vêtement', 'Un drap ou un vêtement te gêne ?'),
  ], deeper: ['C’est mieux comme ça ?', 'Il faut ajuster encore un peu ?', 'Tu veux rester comme ça plus d’une heure ?', 'Tu veux qu’on repasse vérifier bientôt ?'] },
  { id: 'temp', label: 'Chaud / froid', type: 'besoins', sub: 'Température', icon: 'temp', items: [
    T('Chaud', 'Tu as trop chaud ?', kids([['Retirer une couverture', 'On retire une couverture ?'], ['Aérer', 'On aère ou on met le ventilateur ?'], ['Linge frais', 'Tu veux un linge frais ?']])),
    T('Froid', 'Tu as froid ?', kids([['Couverture', 'On ajoute une couverture ?'], ['Fenêtre', 'On ferme la fenêtre ?'], ['Gilet / chaussettes', 'Tu veux un gilet ou des chaussettes ?']])),
  ], deeper: ['C’est mieux maintenant ?', 'C’est surtout les mains ou les pieds ?', 'Tu veux qu’on prenne ta température ?'] },
  { id: 'douleur', label: 'Douleur', type: 'emotions', sub: 'Où, combien', icon: 'douleur', items: [
    T('Poitrine', 'Tu as mal à la poitrine ?', '@i', { urgent: true }),
    T('Tête', 'Tu as mal à la tête ?', '@i'),
    T('Dos', 'Tu as mal au dos ?', '@i'),
    T('Ventre', 'Tu as mal au ventre ?', '@i'),
    T('Gorge / bouche', 'Tu as mal à la gorge ou à la bouche ?', '@i'),
    T('Bras / mains', 'Tu as mal aux bras ou aux mains ?', '@i'),
    T('Jambes / pieds', 'Tu as mal aux jambes ou aux pieds ?', '@i'),
    T('Point d’appui', 'Tu as mal à un point d’appui (fesses, talons, coudes) ?', '@i'),
  ], deeper: ['C’est une douleur nouvelle ?', 'Ça dure depuis plus d’une heure ?', 'Ça lance ou ça brûle ?', 'Tu veux un antidouleur ?', 'Changer de position pourrait soulager ?', 'C’est pire qu’hier ?'] },
  { id: 'emotions', label: 'Émotions', type: 'emotions', sub: 'Comment je me sens', icon: 'emotions', items: [
    T('Ça va bien', 'Tu te sens bien en ce moment ?'),
    T('Fatigue', 'Tu te sens fatiguée ?'),
    T('Inquiétude', 'Tu es inquiète ?', kids([['Ma santé', 'Pour ta santé ?'], ['Mes proches', 'Pour tes proches ?'], ['La suite', 'Pour la suite ?'], ['Une démarche', 'Pour une démarche ou un papier ?']])),
    T('Tristesse', 'Tu te sens triste ?'),
    T('Frustration', 'Tu es frustrée ou en colère ?', kids([['Pas comprise', 'Parce qu’on ne te comprend pas ?'], ['Attente', 'À cause de l’attente ?'], ['Un soin', 'À cause d’un soin ?'], ['Autre chose', 'Pour autre chose ?']])),
    T('Solitude', 'Tu te sens seule ?', kids([['Compagnie', 'Tu veux de la compagnie ?'], ['Appeler un proche', 'Tu veux appeler un proche ?']])),
    T('Peur', 'Tu as peur ?'),
    T('Réconfort', 'Tu as besoin de réconfort ?'),
    T('Me changer les idées', 'Tu veux te changer les idées ?'),
  ], deeper: ['Tu veux en parler maintenant ?', 'C’est lié à quelque chose d’aujourd’hui ?', 'C’est lié à une personne ?', 'Ça dure depuis plusieurs jours ?', 'Tu veux voir la psychologue ?', 'Tu veux que je reste un moment ?', 'Tu veux que je prévienne un proche ?'] },
  { id: 'personnes', label: 'Personnes', type: 'personnes', sub: 'Équipe, rencontres', icon: 'personnes', peopleKinds: ['Équipe', 'Rencontres'], items: [
    T('Quelqu’un d’autre', 'C’est à propos de quelqu’un d’autre ?', null, { action: 'spell' }),
    T('Nouvelle rencontre', 'Tu as rencontré quelqu’un de nouveau ?'),
  ], deeper: ['Tu as envie de revoir cette personne ?', 'Cette rencontre t’a fait plaisir ?', 'Tu veux que je lui transmette quelque chose ?', 'Il y a eu un malentendu ?', 'Tu veux en parler à l’équipe ?'] },
  { id: 'proches', label: 'Proches', type: 'proches', sub: 'Famille, amis', icon: 'proches', peopleKinds: ['Famille', 'Amis'], items: [
    T('Quelqu’un d’autre', 'C’est à propos d’un autre proche ?', null, { action: 'spell' }),
    T('Visite', 'C’est à propos d’une visite ?', kids([['Savoir quand', 'Tu veux savoir quand ?'], ['Pas aujourd’hui', 'Tu préfères pas de visite aujourd’hui ?'], ['Plus longue', 'Tu veux une visite plus longue ?']])),
    T('Photos / vidéos', 'Tu veux voir des photos ou des vidéos de tes proches ?'),
    T('Événement familial', 'C’est à propos d’un événement familial ?'),
  ], deeper: ['Cette personne te manque ?', 'Tu veux qu’elle vienne bientôt ?', 'C’est une bonne nouvelle ?', 'Quelque chose t’inquiète à son sujet ?', 'Tu veux lui transmettre un message ?', 'Tu veux que je l’appelle pour toi ?'] },
  { id: 'passerelle', label: 'La Passerelle', type: 'centre', sub: 'Équipe, matériel', icon: 'passerelle', items: [
    T('Voir un soignant', 'Tu veux voir quelqu’un de l’équipe ?', kids([['Infirmière', 'Une infirmière ?'], ['Aide-soignante', 'Une aide-soignante ?'], ['Médecin', 'Le médecin ?'], ['Kiné', 'Le kiné ?'], ['Ergothérapeute', 'L’ergothérapeute ?'], ['Psychologue', 'La psychologue ?'], ['Orthophoniste', 'L’orthophoniste ?']])),
    T('Rendez-vous', 'Tu as une question sur un rendez-vous ?'),
    T('Salle commune', 'Tu veux aller en salle commune ?'),
    T('Matériel', 'Il y a un problème avec le matériel ?', kids([['Fauteuil', 'Le fauteuil ?'], ['Lit', 'Le lit ?'], ['Sonnette', 'La sonnette ?'], ['Tablette / caméra', 'La tablette ou la caméra ?']])),
    T('Calme', 'Tu veux plus de calme ?'),
    T('Repas du centre', 'C’est à propos des repas du centre ?'),
  ], deeper: ['C’est urgent ?', 'Tu veux que je transmette à l’équipe ?', 'C’est déjà arrivé avant ?', 'Tu es satisfaite de la réponse de l’équipe ?'] },
  { id: 'journee', label: 'Ma journée', type: 'activites', sub: 'Programme, repos', icon: 'journee', items: [
    T('Programme du jour', 'Tu veux savoir ce qui est prévu aujourd’hui ?', null, { action: 'planning' }),
    T('Heure et date', 'Tu veux connaître l’heure et la date ?', null, { action: 'heure' }),
    T('Repos', 'Tu veux te reposer ou dormir ?'),
    T('Lumière', 'Tu veux changer la lumière ?', kids([['Plus de lumière', 'Plus de lumière ?'], ['Moins de lumière', 'Moins de lumière ?'], ['Volets', 'Ouvrir ou fermer les volets ?']])),
    T('Réveil', 'Tu veux qu’on te réveille à une heure précise ?'),
  ], deeper: ['Le programme te convient ?', 'Tu veux changer quelque chose aujourd’hui ?', 'La journée est trop chargée ?', 'Tu as bien dormi ?'] },
  { id: 'activites', label: 'Loisirs', type: 'activites', sub: 'Ateliers, sorties', icon: 'activites', items: [
    T('Atelier', 'Tu veux participer à un atelier ?', kids([['Musique', 'L’atelier musique ?'], ['Art', 'Un atelier d’art ?'], ['Lecture', 'Un atelier lecture ?'], ['Jeux', 'Un atelier jeux ?']])),
    T('Sortir', 'Tu veux sortir ?', kids([['Jardin', 'Au jardin ?'], ['Promenade', 'En promenade ?'], ['En ville', 'En ville ?']])),
    T('Écran / son', 'Tu veux la télé ou de la musique ?', kids([['Télévision', 'La télé ?'], ['Musique', 'De la musique ?'], ['Radio', 'La radio ?'], ['Livre audio', 'Un livre audio ?']])),
    T('Volume', 'Il faut changer le volume ?', kids([['Plus fort', 'Plus fort ?'], ['Moins fort', 'Moins fort ?'], ['Couper', 'Couper le son ?']])),
    T('Jeu', 'Tu veux jouer ?', kids([['Cartes', 'Aux cartes ?'], ['Quiz', 'Un quiz ?'], ['Tablette', 'Sur la tablette ?']])),
    T('Lecture', 'Tu veux qu’on te lise quelque chose ?'),
  ], deeper: ['Tu as aimé cette activité ?', 'Tu veux la refaire cette semaine ?', 'C’était trop long ?', 'Tu veux y aller avec quelqu’un ?', 'Tu veux essayer une nouvelle activité ?'] },
  { id: 'autre', label: 'Autre sujet', type: 'autres', sub: 'Actualité, souvenirs', icon: 'autre', items: [
    T('Actualité', 'Tu veux parler de l’actualité ?', kids([['France', 'De la France ?'], ['Monde', 'Du monde ?'], ['Sport', 'Du sport ?'], ['Météo', 'De la météo ?']])),
    T('Souvenirs', 'Tu veux parler d’un souvenir ?', kids([['Enfance', 'De ton enfance ?'], ['Voyage', 'D’un voyage ?'], ['Travail', 'De ton travail ?'], ['Famille', 'De ta famille ?']])),
    T('Projets / envies', 'Tu veux parler d’un projet ou d’une envie ?', kids([['Sortie', 'D’une sortie ?'], ['Événement familial', 'D’un événement familial ?'], ['Fête', 'D’un anniversaire ou d’une fête ?']])),
    T('Culture', 'Tu veux parler d’un film, d’un livre ou de musique ?', kids([['Film / série', 'D’un film ou d’une série ?'], ['Livre', 'D’un livre ?'], ['Musique', 'De musique ?']])),
    T('Plat préféré', 'Tu as envie d’un plat en particulier ?'),
    T('Nature / animaux', 'Tu veux parler de nature ou d’animaux ?'),
    T('Une question', 'Tu as une question à poser ?', null, { action: 'spell' }),
  ], deeper: ['Tu veux en parler plus longtemps ?', 'Tu veux que je cherche plus d’informations ?', 'C’est un souvenir heureux ?', 'On en reparle plus tard ?', 'Tu veux partager ça avec un proche ?'] },
  { id: 'intime', label: 'Vie privée', type: 'autres', sub: 'Jamais enregistré', icon: 'intime', private: true, items: [
    T('En privé', 'Tu veux parler à quelqu’un en privé ?'),
    T('Ma santé', 'Tu as une question sur ta santé ?'),
    T('Intimité', 'C’est à propos de ton intimité ?'),
    T('Spiritualité', 'C’est à propos de religion ou de spiritualité ?'),
    T('Choix de soins', 'C’est à propos de tes choix de soins ?'),
    T('Argent / démarches', 'C’est à propos d’argent ou de démarches ?'),
    T('Être seule', 'Tu veux rester seule un moment ?'),
  ], deeper: ['Tu veux que la porte soit fermée ?', 'Tu préfères en parler à quelqu’un d’autre ?', 'Tu veux que ce soit transmis au médecin ?', 'On en reparle plus tard ?'] },
];

export const DEMO_PEOPLE = [
  { name: 'Léa', role: 'fille', kind: 'Famille' },
  { name: 'Hugo', role: 'petit-fils', kind: 'Famille' },
  { name: 'Claire', role: 'sœur', kind: 'Famille' },
  { name: 'Sophie', role: 'amie', kind: 'Amis' },
  { name: 'Dr Martin', role: 'médecin', kind: 'Équipe' },
  { name: 'Karim', role: 'kiné', kind: 'Équipe' },
  { name: 'Julie', role: 'aide-soignante', kind: 'Équipe' },
  { name: 'Paul', role: 'croisé en salle commune', kind: 'Rencontres' },
];

export const DEFAULT_PLAN = `08:00 Toilette
09:30 Kiné
11:00 Repos
12:00 Déjeuner
14:00 Sieste
16:30 Atelier musique
19:00 Dîner
21:00 Coucher`;
