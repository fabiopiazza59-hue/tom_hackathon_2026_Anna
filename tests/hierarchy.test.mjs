import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_BANK as bank } from '../static/question-bank.js';
import { entries, findEntry, orderedNodes, availableChildren, startHierarchy, answerHierarchy } from '../static/hierarchy.js';

test('les cinq niveaux et tous les identifiants importés sont présents', () => {
  const all = entries(bank);
  assert.equal(all.length, 253);
  assert.equal(new Set(all.map(e => e.node.id)).size, 253);
  assert.equal(all.filter(e => e.node.level === 'category').length, 6);
  assert.equal(all.filter(e => e.node.level === 'subcategory').length, 27);
  assert.equal(all.filter(e => e.node.level === 'question').length, 99);
  assert.equal(all.filter(e => e.node.level === 'subquestion').length, 120);
  assert.equal(findEntry(bank, 'subq:allongee_lit').parent.id, 'q:allongee');
});

test('les ordres vides et ex aequo restent stables', () => {
  const nodes = [{ id: 'a' }, { id: 'b', order: 2 }, { id: 'c', order: 1 }, { id: 'd', order: 2 }, { id: 'e', order: null }, { id: 'f', order: '' }];
  assert.deepEqual(orderedNodes(nodes).map(n => n.id), ['c', 'b', 'd', 'a', 'e', 'f']);
});

test('la réponse à Ça va choisit le bon ordre et les bonnes sous-catégories', () => {
  let no = answerHierarchy(bank, startHierarchy(bank), 'non');
  assert.equal(no.current.id, 'cat:corps');
  no = answerHierarchy(bank, no, 'oui');
  assert.equal(no.current.id, 'subcat:douleur');
  let yes = answerHierarchy(bank, startHierarchy(bank), 'oui');
  assert.equal(yes.current.id, 'cat:ressenti');
  yes = answerHierarchy(bank, yes, 'oui');
  assert.equal(yes.current.id, 'subcat:bien');
  assert.ok(!availableChildren(findEntry(bank, 'cat:corps').node, 'oui').some(n => n.id === 'subcat:douleur'));
});

test('Oui descend, Non avance et la phrase CSV est restituée', () => {
  let state = startHierarchy(bank);
  for (const answer of ['non', 'oui', 'oui']) state = answerHierarchy(bank, state, answer);
  assert.equal(state.current.id, 'q:mal_dos');
  state = answerHierarchy(bank, state, 'non');
  assert.equal(state.current.id, 'q:mal_ventre');
  state = answerHierarchy(bank, state, 'oui');
  assert.equal(state.done, true);
  assert.equal(state.result.text, "J'ai mal au ventre.");
});

test('une phrase Non explicite est reconnue comme un refus exprimé', () => {
  let state = startHierarchy(bank, { targetId: 'subcat:mes_affaires' });
  for (const answer of ['oui', 'oui', 'oui']) state = answerHierarchy(bank, state, answer);
  assert.equal(state.current.id, 'q:accord_entrer');
  state = answerHierarchy(bank, state, 'non');
  assert.equal(state.done, true);
  assert.equal(state.result.text, "Non, je ne veux pas que tu entres chez moi.");
});

test('les sous-questions sont parcourues dans leur ordre', () => {
  let state = startHierarchy(bank, { targetId: 'subcat:installation' });
  for (const answer of ['non', 'oui', 'oui', 'oui']) state = answerHierarchy(bank, state, answer);
  assert.equal(state.current.id, 'subq:allongee_lit');
  state = answerHierarchy(bank, state, 'non');
  assert.equal(state.current.id, 'subq:allongee_fauteuil');
  state = answerHierarchy(bank, state, 'oui');
  assert.equal(state.result.text, 'Je voudrais être allongée dans mon fauteuil.');
});

test('le contexte domicile masque les éléments réservés au centre', () => {
  const category = findEntry(bank, 'cat:activites').node;
  assert.ok(availableChildren(category, 'oui', 'centre').some(n => n.id === 'subcat:animaux'));
  assert.ok(!availableChildren(category, 'oui', 'domicile').some(n => n.id === 'subcat:animaux'));
});

test('les métadonnées CSV restent intactes sans influencer l’ordre explicite', () => {
  const node = findEntry(bank, 'q:mal_dos').node;
  assert.equal(node.csv.poids, '6');
  assert.equal(node.order, 1);
  assert.ok(entries(bank).some(e => e.node.csv?.heures_pic?.includes(';')));
});
