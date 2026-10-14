import test from 'node:test';
import assert from 'node:assert/strict';
import { topQuestions, themeOrder } from '../static/recommendations.js';
import { QUESTION_BANK } from '../static/question-bank.js';
import { findEntry, startAtHierarchy, answerHierarchy } from '../static/hierarchy.js';

test('le Top 3 utilise les statistiques partagées sans modifier l’ordre de la banque', () => {
  const bank = structuredClone(QUESTION_BANK), before = JSON.stringify(bank);
  const id = 'q:mal_dos';
  const stats = { [id]: { a: 30, y: 29, n: 1, rt: 30000, hours: { 12: 29 } }, master: { a: 10000, y: 9000, rt: 10000000 } };
  assert.equal(topQuestions(bank, stats, { hour: 12 })[0].nodeId, id);
  assert.ok(topQuestions(bank, stats, { hour: 12 })[0].score > 0.9);
  assert.equal(topQuestions(bank, stats).length, 3);
  assert.equal(JSON.stringify(bank), before);
});

test('le Top 3 respecte les branches et le lieu, et propose un besoin par thème prioritaire', () => {
  const bank = structuredClone(QUESTION_BANK);
  const root = bank.root;
  root.children.forEach((c, i) => { c.orderNo = 100 - i; });
  const allowed = themeOrder(bank, 'non', 'centre');
  const top = topQuestions(bank, {}, { answer: 'non', context: 'centre' });
  assert.deepEqual(top.map(t => t.themeId), allowed.slice(0, 3));
  const chosen = findEntry(bank, top[0].nodeId).node;
  chosen.centre = false;
  assert.ok(!topQuestions(bank, { [chosen.id]: { a: 100, y: 100, rt: 1000 } }, { answer: 'non', context: 'centre' }).some(t => t.nodeId === chosen.id));
});

test('un pictogramme ouvre sa vraie question et ses sous-questions, avec les phrases Non de la banque', () => {
  const bank = structuredClone(QUESTION_BANK);
  const node = findEntry(bank, 'q:mal_dos').node;
  node.noText = 'Non, mon dos va bien.';
  const state = startAtHierarchy(bank, node.id, { answer: 'non' });
  assert.equal(state.current.id, node.id);
  assert.ok(state.path.some(n => n.id === 'subcat:douleur'));
  const done = answerHierarchy(bank, state, 'non');
  assert.equal(done.result.text, node.noText);
});
