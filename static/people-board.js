// Entrée « Personnes » : Anna commence souvent par un nom, sans passer par une question.
export const PEOPLE_GROUPS = [['groupClose', 'Proches'], ['groupCare', 'Soins'], ['groupCentre', 'Centre']];
const OTHERS = ['', 'Autres'];

// Groupes dans l’ordre Proches → Soins → Centre ; dans chaque groupe, les poids élevés d’abord puis l’ordre d’import.
export function peopleGroups(all) {
  const people = all.filter(p => !p.paused);
  const byWeight = list => list.map((p, i) => ({ p, i })).sort((a, b) => (b.p.weight ?? 1) - (a.p.weight ?? 1) || a.i - b.i).map(x => x.p);
  const seen = new Set();
  return [...PEOPLE_GROUPS, OTHERS].map(([key, label]) => {
    const members = people.filter(p => !seen.has(p.id) && (key ? p[key] : true));
    members.forEach(p => seen.add(p.id));
    return { key: key || 'autres', label, people: byWeight(members) };
  }).filter(g => g.people.length);
}
export const orderedPeople = people => peopleGroups(people).flatMap(g => g.people);

export const aboutText = p => `C’est à propos de ${p.name}.`;

// Ce qu’on peut dire d’une personne, en Oui / Non, selon ses autorisations ; « Autre chose » mène à l’épellation.
export function personSteps(p) {
  return [
    ['contacter', 'canContact', 'Contacter', `Tu veux contacter ${p.name} ?`, `Je voudrais contacter ${p.name}.`],
    ['voir', 'canSee', 'Voir', `Tu veux voir ${p.name} ?`, `Je voudrais voir ${p.name}.`],
    ['parler', 'canTalk', 'Parler', `Tu veux parler à ${p.name} ?`, `Je voudrais parler à ${p.name}.`],
  ].filter(([, flag]) => p[flag] !== false)
    .map(([action, , l, q, yesText]) => ({ id: `personne.${p.id}.${action}`, l, q, yesText }))
    .concat({ id: `personne.${p.id}.autre`, l: 'Autre chose', q: `C’est autre chose à propos de ${p.name} ?`, action: 'spell' });
}

export const personItem = p => ({ id: `personne.${p.id}`, l: p.name, q: `C’est ${p.name} ?`, yesText: aboutText(p), person: p.id, then: personSteps(p) });

// Parcours Oui / Non : le groupe, puis le nom, puis ce qu’Anna veut dire.
export function peopleScan(people) {
  return peopleGroups(people).map(g => ({
    id: `personnes.${g.key}`, l: g.label, q: g.key === 'autres' ? 'C’est quelqu’un d’autre ?' : `C’est quelqu’un ${{ groupClose: 'de tes proches', groupCare: 'des soins', groupCentre: 'du centre' }[g.key]} ?`,
    then: g.people.map(personItem),
  }));
}
