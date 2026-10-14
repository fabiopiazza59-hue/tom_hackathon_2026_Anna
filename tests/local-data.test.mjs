import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApi } from '../static/local-data.js';
import { findEntry } from '../static/hierarchy.js';

function setup(admin = true) {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const api = createLocalApi({ storage, authorize: async () => admin });
  return { api, storage };
}
const bootstrap = api => api('GET', '/api/data?action=bootstrap');
const edit = (api, action, data) => api('POST', '/api/admin?action=' + action, data);

test('la banque initiale contient la hiérarchie CSV complète', async () => {
  const { api } = setup(false);
  const data = await bootstrap(api);
  assert.equal(data.patientName, 'Anna');
  assert.equal(data.isAdmin, false);
  assert.equal(data.types.length, 6);
  assert.equal(data.themes.length, 27);
  assert.equal(data.bank.root.q, 'Ça va ?');
  assert.ok(data.themes.find(t => t.id === 'subcat:boire').items.length > 0);
});

test('les modifications admin persistent et les sous-questions sont supprimées ensemble', async () => {
  const { api, storage } = setup();
  const parent = await edit(api, 'add-node', { parentId: 'subcat:boire', label: 'Test', q: 'Tu veux tester ?' });
  await edit(api, 'add-node', { parentId: parent.id, label: 'Suite', q: 'On continue ?' });
  const other = createLocalApi({ storage, authorize: async () => true });
  const added = (await bootstrap(other)).themes.find(t => t.id === 'subcat:boire').items.find(q => q.id === parent.id);
  assert.equal(added.then[0].q, 'On continue ?');
  await edit(other, 'delete-node', { id: parent.id });
  assert.ok(!(await bootstrap(api)).themes.find(t => t.id === 'subcat:boire').items.some(q => q.id === parent.id));
});

test('les actions admin exigent une authentification', async () => {
  const { api } = setup(false);
  await assert.rejects(edit(api, 'save-plan', { plan: 'secret' }), { status: 403 });
});

test('les échanges publics sont dédupliqués', async () => {
  const { api } = setup();
  const conversation = { id: 'test', theme: 'subcat:boire', path: ['Boire', 'Eau'], result: 'resolu', at: Date.now() };
  assert.equal((await api('POST', '/api/data?action=conversation', conversation)).saved, 1);
  assert.equal((await api('POST', '/api/data?action=conversation', conversation)).saved, 0);
  assert.equal((await bootstrap(api)).history.length, 1);
});

test('les réglages et les personnes sont conservés entre les lectures', async () => {
  const { api } = setup();
  await edit(api, 'save-plan', { plan: '09:00 Atelier' });
  await edit(api, 'save-settings', { reco: false, sens: 1.25 });
  const person = await edit(api, 'add-person', { name: 'Exemple', role: 'Test', kind: 'Amis' });
  const data = await bootstrap(api);
  assert.equal(data.plan, '09:00 Atelier');
  assert.deepEqual(data.settings, { reco: false, sens: 1.25, context: 'tous' });
  assert.ok(data.people.some(p => p.id === person.id));
});

test('les modifications de texte et d’ordre se retrouvent dans la banque publique', async () => {
  const { api } = setup();
  const node = findEntry((await bootstrap(api)).bank, 'q:mal_dos').node;
  await edit(api, 'save-node', { ...node, q: 'Ton dos te fait mal ?', order: 9 });
  const data = await bootstrap(api);
  const questions = data.themes.find(t => t.id === 'subcat:douleur').items;
  assert.equal(questions.find(q => q.id === node.id).q, 'Ton dos te fait mal ?');
  assert.notEqual(questions[0].id, node.id);
  assert.equal(findEntry(data.bank, node.id).node.csv.id, 'mal_dos');
});

test('la migration sauvegarde la banque précédente et conserve l’historique', async () => {
  const { api, storage } = setup();
  const old = { patient: { display_name: 'Anna', daily_plan: 'Atelier', settings: { sens: 1.2 } }, types: [{ id: 'ancien' }], themes: [], questions: [{ id: 'édition locale' }], followups: [], people: [], events: [], conversations: [], notes: [] };
  storage.setItem('anna-local-data-v1', JSON.stringify(old));
  const data = await bootstrap(api);
  assert.deepEqual(JSON.parse(storage.getItem('anna-before-csv-v1')), old);
  assert.equal(data.plan, 'Atelier');
  assert.equal(data.types.length, 6);
  await edit(api, 'save-node', { id: 'master', q: 'Comment ça va ?', label: 'Départ' });
  assert.equal((await bootstrap(api)).bank.root.q, 'Comment ça va ?');
});

test('les parents et les ordres invalides sont refusés sans modifier la banque', async () => {
  const { api } = setup();
  const node = findEntry((await bootstrap(api)).bank, 'q:mal_dos').node;
  await assert.rejects(edit(api, 'save-node', { ...node, parentId: 'cat:corps' }));
  await assert.rejects(edit(api, 'save-node', { ...node, order: 'abc' }));
  await assert.rejects(edit(api, 'delete-node', { id: 'master' }));
  assert.equal(findEntry((await bootstrap(api)).bank, node.id).node.q, node.q);
});
