// Toutes les phrases fixes que l’application peut dire : elles sont pré-enregistrées depuis l’admin.
// Les messages épelés et les autres textes libres restent sur la voix du navigateur.
import { entries } from './hierarchy.js';
import { aboutText, peopleScan, personItem } from './people-board.js';

export const SPELL_GROUPS = [['E', 'S', 'A', 'I', 'N', 'T', 'R', 'U', 'L'], ['O', 'D', 'C', 'M', 'P', 'G', 'B', 'V', 'H'], ['F', 'Q', 'J', 'X', 'Y', 'Z', 'K', 'W', '’'], ['ESPACE', 'EFFACER', 'TERMINER', 'ANNULER']];
export const spellGroupPrompt = group => `Lettre dans : ${group.join(' ')} ?`;
export const spellLetterPrompt = letter => `« ${letter} » ?`;
export const HELLO = 'Coucou, est-ce que tu veux parler ?';
export const NOT_FOUND = 'Aucune réponse trouvée dans cette branche.';

export function allPhrases(bank, people = [], name = 'Anna') {
  const set = new Set(['Oui', 'Non', HELLO, NOT_FOUND, `${name} veut parler`, 'Voici le programme de ta journée.', 'Lecture à voix haute activée', 'On épelle.']);
  const add = text => { if (typeof text === 'string' && text.trim()) set.add(text); };
  for (const { node } of entries(bank)) {
    add(node.q); add(node.yesText || node.label); add(node.noText);
    (node.followUps || []).forEach(add);
  }
  for (const p of people) {
    add(aboutText(p));
    const item = personItem(p);
    add(item.q);
    for (const step of item.then) { add(step.q); add(step.yesText); }
  }
  for (const group of peopleScan(people)) add(group.q);
  for (const group of SPELL_GROUPS) { add(spellGroupPrompt(group)); group.forEach(letter => add(spellLetterPrompt(letter))); }
  return [...set].filter(text => text.length <= 600);
}
