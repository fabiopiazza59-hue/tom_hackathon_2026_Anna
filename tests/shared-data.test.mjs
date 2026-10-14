import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedApi } from '../static/shared-data.js';
import { QUESTION_BANK } from '../static/question-bank.js';
import { findEntry, startHierarchy, answerHierarchy } from '../static/hierarchy.js';

const get = api => api('GET', '/api/data?action=bootstrap');
const edit = (api, action, body) => api('POST', '/api/admin?action=' + action, body);
const storage = () => {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
};
function server() {
  let config = { bank: structuredClone(QUESTION_BANK), patient: { display_name: 'Anna', daily_plan: '', settings: { reco: false, sens: 1, context: 'tous' } }, people: [] };
  let version = 0;
  const calls = [];
  const revision = () => `"${version}"`;
  const fetch = async (path, options) => {
    calls.push({ path, ...options });
    if (options.method === 'PUT') {
      if (options.headers['If-Match'] !== revision()) return Response.json({ detail: 'Conflit. Rechargez la page.' }, { status: 409 });
      config = JSON.parse(options.body); version++;
      return Response.json({ revision: revision() });
    }
    if (options.headers['If-None-Match'] === revision()) return new Response(null, { status: 304 });
    return Response.json({ config, revision: revision(), initialized: version > 0 });
  };
  const browser = (admin = false, local = storage()) => createSharedApi({ fetch, storage: local, admin, authorize: async () => admin });
  return { browser, calls, config: () => config };
}

test('une édition admin est visible depuis des navigateurs indépendants, même après réouverture', async () => {
  const s = server(), admin = s.browser(true), publicPage = s.browser();
  await get(admin); await get(publicPage);
  const node = findEntry((await get(admin)).bank, 'q:mal_dos').node;
  await edit(admin, 'save-node', { ...node, q: 'Ton dos te fait mal ?', order: 9 });
  assert.equal(findEntry((await get(publicPage)).bank, node.id).node.q, 'Ton dos te fait mal ?');
  assert.equal(findEntry((await get(s.browser())).bank, node.id).node.order, 9);
  await edit(admin, 'save-plan', { plan: 'Atelier partagé' });
  assert.equal((await get(s.browser())).plan, 'Atelier partagé');
});

test('deux admins ne peuvent pas écraser leurs modifications et un échec ne reste pas dans le cache', async () => {
  const s = server(), a = s.browser(true), b = s.browser(true);
  await get(a); await get(b);
  await edit(a, 'save-plan', { plan: 'Première modification' });
  await assert.rejects(edit(b, 'save-plan', { plan: 'Périmée' }), { status: 409 });
  assert.equal((await get(b)).plan, 'Première modification');
  await edit(b, 'save-plan', { plan: 'Après rechargement' });
  assert.equal((await get(a)).plan, 'Après rechargement');
});

test('la première visite admin migre uniquement sa banque et ses réglages, jamais les interactions', async () => {
  const s = server(), local = storage();
  const config = structuredClone(s.config());
  config.bank.root.q = 'Question déjà personnalisée ?';
  local.setItem('anna-local-data-v1', JSON.stringify({ ...config, events: ['trace privée'], notes: ['trace privée'], conversations: ['trace privée'] }));
  local.setItem('anna-outbox', 'trace privée');
  const admin = s.browser(true, local);
  assert.equal((await get(admin)).bank.root.q, 'Question déjà personnalisée ?');
  assert.equal((await get(s.browser())).bank.root.q, 'Question déjà personnalisée ?');
  assert.ok(!JSON.stringify(s.calls).includes('trace privée'));
  assert.ok(!local.getItem('anna-local-data-v1').includes('trace privée'));
  assert.equal(local.getItem('anna-outbox'), null);
  config.bank.root.q = 'Ancienne version d’un autre navigateur ?';
  const other = storage(); other.setItem('anna-local-data-v1', JSON.stringify(config));
  assert.equal((await get(s.browser(true, other))).bank.root.q, 'Question déjà personnalisée ?');
});

test('la page publique ne publie pas sa banque locale et un parcours n’envoie aucune réponse', async () => {
  const s = server(), local = storage();
  const config = structuredClone(s.config()); config.bank.root.q = 'Version locale périmée ?';
  local.setItem('anna-local-data-v1', JSON.stringify(config));
  const publicPage = s.browser(false, local), data = await get(publicPage);
  assert.equal(data.bank.root.q, 'Ça va ?');
  let state = startHierarchy(data.bank);
  const count = s.calls.length;
  for (const answer of ['non', 'oui', 'oui', 'non', 'oui']) state = answerHierarchy(data.bank, state, answer);
  assert.ok(state.done);
  assert.equal(s.calls.length, count);
  await assert.rejects(edit(publicPage, 'save-plan', { plan: 'Interdit' }), { status: 403 });
  assert.equal(s.calls.filter(c => c.method === 'PUT').length, 0);
});

test('un problème réseau ne produit aucun faux succès ni enregistrement local', async () => {
  const s = server(), local = storage();
  let offline = false;
  const admin = createSharedApi({ admin: true, storage: local, authorize: async () => true,
    fetch: async () => {
      if (offline) throw new TypeError('Network error');
      return Response.json({ config: s.config(), revision: '"0"', initialized: true });
    },
  });
  await get(admin); offline = true;
  await assert.rejects(edit(admin, 'save-plan', { plan: 'Non sauvegardé' }));
  assert.equal(local.getItem('anna-local-data-v1'), null);
  assert.equal(s.config().patient.daily_plan, '');
});
