import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_BANK as bank } from '../static/question-bank.js';
import { entries, findEntry, orderedNodes, availableChildren, startHierarchy, startAtHierarchy, startInsideHierarchy, answerHierarchy, followUpsFor } from '../static/hierarchy.js';

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

test('un parcours lancé depuis un thème ou une question ne passe jamais à une autre catégorie', () => {
  const categoryOf = id => { const e = findEntry(bank, id); return e.node.level === 'category' ? e.node.id : e.path.find(n => n.level === 'category')?.id; };
  let paths = 0;
  for (const { node } of entries(bank)) {
    if (node.level === 'master') continue;
    // Les pages de catégorie et de sous-catégorie parcourent leur contenu ; une tuile de question part de cette question.
    const start = ['category', 'subcategory'].includes(node.level) ? startInsideHierarchy : startAtHierarchy;
    for (const answer of [null, 'oui', 'non']) {
      const walk = (state, depth) => {
        if (state.done) { paths++; return; }
        assert.notEqual(state.current.level, 'master', `${node.id} revient à la question de départ`);
        assert.equal(categoryOf(state.current.id), categoryOf(node.id), `${node.id} (${answer}) mène à ${state.current.id}`);
        assert.ok(depth < 60);
        for (const a of ['oui', 'non']) walk(answerHierarchy(bank, state, a), depth + 1);
      };
      walk(start(bank, node.id, { answer }), 0);
    }
  }
  assert.ok(paths > 1000);
});

test('depuis la page d’un thème, on commence par son contenu', () => {
  let state = startInsideHierarchy(bank, 'subcat:douleur');
  assert.equal(state.current.id, 'q:mal_dos');
  state = startInsideHierarchy(bank, 'cat:corps');
  assert.equal(state.current.id, 'subcat:douleur');
  for (const _ of availableChildren(findEntry(bank, 'cat:corps').node)) if (!state.done) state = answerHierarchy(bank, state, 'non');
  assert.equal(state.done, true);
  assert.equal(state.result.text, "J'ai besoin de quelque chose pour mon corps.");
});

test('les questions de suivi vont du besoin trouvé vers son thème, sans doublon', () => {
  let state = startInsideHierarchy(bank, 'subcat:douleur');
  for (const answer of ['non', 'non', 'oui']) state = answerHierarchy(bank, state, answer);
  assert.equal(state.result.text, "J'ai mal à la tête.");
  const list = followUpsFor(state);
  assert.deepEqual(list.slice(0, 3).map(f => f.q), ['Tu veux moins de bruit ?', 'Tu veux moins de lumière ?', "C'est une douleur forte ?"]);
  assert.equal(list.length, 6);
  assert.equal(new Set(list.map(f => f.q)).size, list.length);
  assert.equal(list[0].id, 'q:mal_tete#1');
  // Rien à proposer quand le besoin n’a pas été trouvé.
  let lost = startHierarchy(bank);
  while (!lost.done) lost = answerHierarchy(bank, lost, 'non');
  assert.deepEqual(followUpsFor(lost), []);
});
