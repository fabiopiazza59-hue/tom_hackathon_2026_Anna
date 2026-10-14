import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApi } from '../static/local-data.js';

function setup(admin = true) {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const api = createLocalApi({ storage, authorize: async () => admin });
  return { api, storage };
}
const bootstrap = api => api('GET', '/api/data?action=bootstrap');
const edit = (api, action, data) => api('POST', '/api/admin?action=' + action, data);

test('la banque initiale contient les catégories et les questions de la maquette', async () => {
  const { api } = setup(false);
  const data = await bootstrap(api);
  assert.equal(data.patientName, 'Anna');
  assert.equal(data.isAdmin, false);
  assert.equal(data.types.length, 8);
  assert.ok(data.themes.find(t => t.id === 'soif').items.length > 0);
});

test('les modifications admin persistent et les sous-questions sont supprimées ensemble', async () => {
  const { api, storage } = setup();
  const parent = await edit(api, 'add-question', { themeId: 'soif', label: 'Test', text: 'Tu veux tester ?' });
  await edit(api, 'add-question', { themeId: 'soif', parentId: parent.id, label: 'Suite', text: 'On continue ?' });
  const other = createLocalApi({ storage, authorize: async () => true });
  const added = (await bootstrap(other)).themes.find(t => t.id === 'soif').items.find(q => q.id === parent.id);
  assert.equal(added.then[0].q, 'On continue ?');
  await edit(other, 'delete-question', { id: parent.id });
  assert.ok(!(await bootstrap(api)).themes.find(t => t.id === 'soif').items.some(q => q.id === parent.id));
});

test('les actions admin exigent une authentification', async () => {
  const { api } = setup(false);
  await assert.rejects(edit(api, 'save-plan', { plan: 'secret' }), { status: 403 });
});

test('les échanges privés ne sont pas enregistrés et les échanges publics sont dédupliqués', async () => {
  const { api } = setup();
  const data = await bootstrap(api), privateTheme = data.themes.find(t => t.private);
  assert.ok(privateTheme);
  const conversation = { id: 'test', theme: privateTheme.id, path: ['Privé'], result: 'resolu', at: Date.now() };
  assert.equal((await api('POST', '/api/data?action=conversation', conversation)).saved, 0);
  conversation.theme = 'soif'; conversation.path = ['Boire', 'Eau'];
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
  assert.deepEqual(data.settings, { reco: false, sens: 1.25 });
  assert.ok(data.people.some(p => p.id === person.id));
});
