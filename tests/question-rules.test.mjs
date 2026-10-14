import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_BANK } from '../static/question-bank.js';
import { prepareBank, calendar, peakNow, validDays, validPeakHours } from '../static/question-rules.js';
import { findEntry, orderedNodes, entries } from '../static/hierarchy.js';
import { topQuestions } from '../static/recommendations.js';
import { createLocalApi } from '../static/local-data.js';

const wednesday = new Date('2026-10-14T10:00:00Z'), saturday = new Date('2026-10-17T10:00:00Z');
const person = (id, name, extra = {}) => ({ id, name, role: '', kind: 'Famille', gender: 'F', groupClose: true, canContact: true, canSee: true, canTalk: true, weight: 1, ...extra });
const people = [person('roxane', 'Roxane', { days: 'weekend' }), person('patricia', 'Patricia', { days: 'weekend' }), person('marie_sono', 'Marie', { days: 'weekend' }), person('amandine', 'Amandine'), person('flora', 'Flora'), person('laureen', 'Laureen', { groupClose: false, groupCentre: true, referent: true })];

test('les jours et ordres du week-end changent le parcours sans altérer la banque admin', () => {
  const before = JSON.stringify(QUESTION_BANK);
  const weekday = prepareBank(QUESTION_BANK, people, wednesday), weekend = prepareBank(QUESTION_BANK, people, saturday);
  assert.ok(!findEntry(weekday, 'subq:contacter_roxane'));
  assert.ok(findEntry(weekend, 'subq:contacter_roxane'));
  const group = findEntry(weekend, 'q:contacter_femme').node;
  assert.deepEqual(orderedNodes(group.children).slice(0, 3).map(n => n.personId), ['roxane', 'patricia', 'marie_sono']);
  assert.equal(JSON.stringify(QUESTION_BANK), before);
});

test('les autorisations, le genre et le référent filtrent les personnes liées', () => {
  const changed = people.map(p => p.id === 'laureen' ? { ...p, canContact: false } : p.id === 'amandine' ? { ...p, gender: 'H' } : p);
  const bank = prepareBank(QUESTION_BANK, changed, saturday);
  assert.ok(!findEntry(bank, 'subq:contacter_laureen'));
  assert.ok(findEntry(bank, 'subq:voir_laureen'));
  assert.ok(!findEntry(bank, 'subq:contacter_amandine'));
  const noReferent = prepareBank(QUESTION_BANK, changed.map(p => ({ ...p, referent: false })), saturday);
  assert.ok(!findEntry(noReferent, 'q:voir_referent'));
});

test('TRUE et FALSE et les lieux sont honorés jusque dans les groupes de personnes', () => {
  const bank = prepareBank(QUESTION_BANK, people, saturday, 'domicile');
  assert.ok(!findEntry(bank, 'subq:voir_laureen'));
  assert.ok(!findEntry(bank, 'q:voir_referent'));
  assert.ok(!entries(bank).some(e => e.node.centre === false && e.node.domicile === false));
});

test('les créneaux épinglés passent avant le classement habituel et cessent à la fin du créneau', () => {
  const bank = prepareBank(QUESTION_BANK, people, wednesday);
  const peak = topQuestions(bank, {}, { answer: 'non', date: new Date('2026-10-14T17:30:00Z') });
  assert.deepEqual(peak.slice(0, 2).map(n => n.nodeId).sort(), ['q:eau', 'q:repas']);
  const night = topQuestions(bank, {}, { answer: 'non', hour: 2 });
  assert.equal(night[0].nodeId, 'q:mal_dos');
  assert.ok(!night.some(n => n.pinned));
});

test('les limites horaires, plages nocturnes et saisies invalides sont déterministes', () => {
  assert.equal(calendar(saturday).weekend, true);
  assert.equal(peakNow('22-2', { minute: 23 * 60 }), true);
  assert.equal(peakNow('8-10;12-13', { minute: 13 * 60 }), false);
  assert.equal(validPeakHours('25-26'), false);
  assert.equal(validDays('lundi, mercredi;weekend'), true);
  assert.equal(validDays('jours inconnus'), false);
});

test('une modification admin des personnes et des nouvelles colonnes se retrouve dans le stockage', async () => {
  const values = new Map([['anna-local-data-v1', JSON.stringify({ bank: QUESTION_BANK, people, patient: { display_name: 'Anna', daily_plan: '', settings: { context: 'tous', sens: 1 } } })]]);
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const api = createLocalApi({ storage, authorize: async () => true });
  await api('POST', '/api/admin?action=save-person', { ...people[0], name: 'Nouveau nom', weight: 0.5, canContact: false });
  let data = await api('GET', '/api/data?action=bootstrap');
  assert.equal(data.people[0].weight, 0.5);
  assert.match(findEntry(data.bank, 'subq:contacter_roxane').node.q, /Nouveau nom/);
  const node = findEntry(data.bank, 'q:repas').node;
  await api('POST', '/api/admin?action=save-node', { ...node, weight: 0.25, days: 'weekend', weekendOrder: 2, peakHours: '12-14', pinned: true });
  data = await api('GET', '/api/data?action=bootstrap');
  assert.equal(findEntry(data.bank, 'q:repas').node.weight, 0.25);
  assert.equal(findEntry(data.bank, 'q:repas').node.peakHours, '12-14');
  await assert.rejects(api('POST', '/api/admin?action=delete-person', { id: 'roxane' }));
});
