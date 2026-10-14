import { availableChildren } from './hierarchy.js';

// Les lignes sont les catégories ; leurs tuiles sont uniquement leurs sous-catégories.
export function categoryRows(bank, answer, context = 'tous') {
  return availableChildren(bank.root, answer, context).map(category => ({
    category, children: availableChildren(category, answer, context),
  }));
}

const ICONS = {
  corps: 'soin', ressenti: 'emotions', autres: 'personnes', activites: 'activites', dire: 'message', accord: 'ok',
  douleur: 'douleur', installation: 'position', gene: 'hygiene', manger: 'manger', boire: 'eau', repos: 'fatigue',
  bien: 'content', difficile: 'triste', ennui: 'jeu', probleme: 'inquiet', contacter: 'tel', voir: 'personnes',
  parler: 'talk', compagnie: 'personnes', seule: 'seul', ecouter_regarder: 'tv', detente: 'calme',
  ateliers: 'activites', balade: 'arbre', sorties: 'arbre', animaux: 'animaux', evenements: 'fete', vacances: 'avion',
  raconter: 'message', savoir: 'question', mes_affaires: 'home', mon_corps_accord: 'soin',
};
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function nodeIcon(node) {
  if (['category', 'subcategory'].includes(node.level)) return ICONS[node.sourceId] || 'question';
  if (node.personId) return 'personnes';
  const text = normalize(`${node.label} ${node.q}`);
  const rules = [
    [/\b(contacter|appeler|telephone)\b/, 'tel'], [/\b(parler|dire|raconter|message)\b/, 'message'],
    [/\b(eau|soif|boire|boisson|ice tea|jus)\b/, 'eau'], [/\b(faim|manger|repas|chocolat|plat)\b/, 'manger'],
    [/\b(tete)\b/, 'tete'], [/\b(ventre|nausee)\b/, 'nausee'], [/\b(dos|allongee|lit)\b/, 'position'],
    [/\b(fauteuil|assise)\b/, 'fauteuil'], [/\b(remonter|haut)\b/, 'haut'], [/\b(bas)\b/, 'bas'],
    [/\b(gauche)\b/, 'gauche'], [/\b(droite)\b/, 'droite'], [/\b(bras|jambe|main|pied)\b/, 'bras'],
    [/\b(change|couche)\b/, 'change'], [/\b(vetement|habits)\b/, 'vetement'], [/\b(froid|couverture)\b/, 'froid'],
    [/\b(chaud)\b/, 'temp'], [/\b(dormir|fatiguee|repos|sieste|coucher)\b/, 'fatigue'],
    [/\b(musique|radio|ecouter)\b/, 'activites'], [/\b(tele|film|regarder)\b/, 'tv'],
    [/\b(balade|jardin|sortir)\b/, 'arbre'], [/\b(jeu|jouer)\b/, 'jeu'], [/\b(livre|lecture)\b/, 'livre'],
    [/\b(triste)\b/, 'triste'], [/\b(peur)\b/, 'peur'], [/\b(contente|bien)\b/, 'content'],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || 'question';
}
