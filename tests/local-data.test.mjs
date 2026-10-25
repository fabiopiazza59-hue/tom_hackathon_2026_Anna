import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApi } from '../static/local-data.js';
import { findEntry } from '../static/hierarchy.js';
import { startHierarchy, answerHierarchy } from '../static/hierarchy.js';

function setup(admin = true) {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
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
  assert.ok(!Object.hasOwn(data, 'history'));
  assert.ok(!Object.hasOwn(data, 'stats'));
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

test('les anciens points d’enregistrement des interactions sont refusés', async () => {
  const { api, storage } = setup(false);
  await bootstrap(api);
  const before = storage.getItem('anna-local-data-v1');
  for (const action of ['events', 'conversation', 'note']) {
    await assert.rejects(api('POST', '/api/data?action=' + action, { answer: 'donnée sensible' }), { status: 404 });
  }
  assert.equal(storage.getItem('anna-local-data-v1'), before);
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

test('la migration sauvegarde la banque précédente sans ses interactions', async () => {
  const { api, storage } = setup();
  const old = { patient: { display_name: 'Anna', daily_plan: 'Atelier', settings: { sens: 1.2 } }, types: [{ id: 'ancien' }], themes: [], questions: [{ id: 'édition locale' }], followups: [], people: [], events: [], conversations: [], notes: [] };
  storage.setItem('anna-local-data-v1', JSON.stringify(old));
  const data = await bootstrap(api);
  const expected = { ...old };
  for (const key of ['events', 'conversations', 'notes']) delete expected[key];
  assert.deepEqual(JSON.parse(storage.getItem('anna-before-csv-v1')), expected);
  assert.equal(data.plan, 'Atelier');
  assert.equal(data.types.length, 6);
  await edit(api, 'save-node', { id: 'master', q: 'Comment ça va ?', label: 'Départ' });
  assert.equal((await bootstrap(api)).bank.root.q, 'Comment ça va ?');
});

test('le nettoyage supprime les traces et la file d’attente sans toucher à la banque éditée', async () => {
  const { api, storage } = setup();
  await bootstrap(api);
  const db = JSON.parse(storage.getItem('anna-local-data-v1'));
  db.bank.root.q = 'Question personnalisée ?';
  for (const key of ['events', 'conversations', 'notes', 'history', 'stats', 'answers', 'interactions', 'outbox']) db[key] = ['trace sensible'];
  storage.setItem('anna-local-data-v1', JSON.stringify(db));
  storage.setItem('anna-before-csv-v1', JSON.stringify({ questions: [{ text: 'Question à conserver' }], history: ['trace sensible'], stats: { count: 10 }, conversations: ['trace sensible'] }));
  storage.setItem('anna-outbox', JSON.stringify(['trace sensible']));
  const data = await bootstrap(api);
  assert.equal(data.bank.root.q, 'Question personnalisée ?');
  assert.ok(!storage.getItem('anna-local-data-v1').includes('trace sensible'));
  assert.deepEqual(JSON.parse(storage.getItem('anna-before-csv-v1')), { questions: [{ text: 'Question à conserver' }] });
  assert.equal(storage.getItem('anna-outbox'), null);
});

test('un parcours Oui/Non complet ne modifie pas le stockage persistant', async () => {
  const { api, storage } = setup(false);
  const { bank } = await bootstrap(api);
  const before = storage.getItem('anna-local-data-v1');
  let state = startHierarchy(bank);
  for (const answer of ['non', 'oui', 'oui', 'non', 'oui']) state = answerHierarchy(bank, state, answer);
  assert.equal(state.done, true);
  assert.equal(state.result.text, "J'ai mal au ventre.");
  assert.equal(storage.getItem('anna-local-data-v1'), before);
});

test('les parents et les ordres invalides sont refusés sans modifier la banque', async () => {
  const { api } = setup();
  const node = findEntry((await bootstrap(api)).bank, 'q:mal_dos').node;
  await assert.rejects(edit(api, 'save-node', { ...node, parentId: 'cat:corps' }));
  await assert.rejects(edit(api, 'save-node', { ...node, order: 'abc' }));
  await assert.rejects(edit(api, 'delete-node', { id: 'master' }));
  assert.equal(findEntry((await bootstrap(api)).bank, node.id).node.q, node.q);
});

test('la photo et la pause d’une personne sont enregistrées, une image non JPEG est refusée', async () => {
  const { api } = setup();
  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const { id } = await edit(api, 'add-person', { name: 'Exemple', kind: 'Amis', photo, paused: true });
  let saved = (await bootstrap(api)).people.find(p => p.id === id);
  assert.equal(saved.photo, photo);
  assert.equal(saved.paused, true);
  await edit(api, 'save-person', { id, name: 'Exemple', paused: false });
  saved = (await bootstrap(api)).people.find(p => p.id === id);
  assert.equal(saved.photo, photo, 'modifier sans toucher à la photo la conserve');
  assert.equal(saved.paused, false);
  await assert.rejects(edit(api, 'save-person', { id, name: 'Exemple', photo: 'data:image/svg+xml;base64,PHN2Zz4=' }), /Photo invalide/);
  await assert.rejects(edit(api, 'save-person', { id, name: 'Exemple', photo: 'data:image/jpeg;base64,' + 'A'.repeat(60000) }), /Photo invalide/);
});

test('les questions de suivi se modifient dans l’admin, une par ligne', async () => {
  const { api } = setup();
  const node = findEntry((await bootstrap(api)).bank, 'subcat:boire').node;
  assert.ok(node.followUps.length);
  await edit(api, 'save-node', { ...node, followUps: ' Tu veux de l’eau ?\n\nTu veux un jus ? ' });
  assert.deepEqual(findEntry((await bootstrap(api)).bank, 'subcat:boire').node.followUps, ['Tu veux de l’eau ?', 'Tu veux un jus ?']);
  await assert.rejects(edit(api, 'save-node', { ...node, followUps: Array.from({ length: 21 }, (_, i) => `Q${i} ?`).join('\n') }), /20 au maximum/);
});
