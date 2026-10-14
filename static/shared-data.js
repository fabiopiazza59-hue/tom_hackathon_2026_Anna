import { createLocalApi, legacyConfig } from './local-data.js';

const KEY = 'anna-local-data-v1';
const fail = (message, status = 503) => { throw Object.assign(new Error(message), { status }); };

export function createSharedApi({ fetch: request = globalThis.fetch, storage, authorize, admin = false }) {
  // Seule la configuration historique peut migrer. Les interactions sont supprimées.
  const legacy = legacyConfig(storage);
  let snapshot = null, migrationChecked = false, pending = Promise.resolve();

  async function send(...args) {
    try { return await request(...args); }
    catch { fail('Connexion au stockage partagé impossible. Réessayez.'); }
  }

  async function checked(response) {
    if (response.ok) return response;
    let detail;
    try { detail = (await response.json()).detail; } catch { /* réponse non JSON */ }
    fail(typeof detail === 'string' ? detail : 'Enregistrement impossible. Vérifiez la connexion et réessayez.', response.status);
  }

  async function write(config, revision) {
    const response = await checked(await send('/api/config', {
      method: 'PUT', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'If-Match': revision }, body: JSON.stringify(config),
    }));
    const saved = await response.json();
    snapshot = { config, revision: saved.revision, initialized: true };
  }

  async function read() {
    const response = await send('/api/config', {
      credentials: 'same-origin', cache: 'no-store',
      headers: snapshot ? { 'If-None-Match': snapshot.revision } : {},
    });
    if (response.status !== 304) snapshot = await (await checked(response)).json();
    if (!snapshot) fail('La banque de questions est indisponible.');
    if (admin && !migrationChecked) {
      if (!snapshot.initialized && legacy) {
        if (!await authorize(true)) fail('Connexion admin requise', 403);
        try { await write(legacy, snapshot.revision); }
        catch (e) {
          if (e.status !== 409) throw e;
          // Un autre admin a initialisé la banque. Lire sa version sans l’écraser.
          snapshot = null; migrationChecked = true;
          return read();
        }
      }
      migrationChecked = true;
    }
  }

  function adapter() {
    const values = new Map([[KEY, JSON.stringify(snapshot.config)]]);
    const memory = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
    return { memory, api: createLocalApi({ storage: memory, authorize }) };
  }

  async function run(method, path, body) {
    if (method === 'GET') {
      await read();
      return adapter().api(method, path, body);
    }
    if (!admin) fail('Connexion admin requise', 403);
    // Garder la révision affichée : une banque périmée ne doit jamais écraser une édition récente.
    if (!snapshot) await read();
    const { api, memory } = adapter();
    const result = await api(method, path, body);
    const db = JSON.parse(memory.getItem(KEY));
    await write({ bank: db.bank, patient: db.patient, people: db.people }, snapshot.revision);
    return result;
  }

  return (method, path, body = {}) => {
    // Sérialiser lectures et écritures d’un même onglet, sans mémoriser d’interactions.
    const result = pending.then(() => run(method, path, body));
    pending = result.catch(() => {});
    return result;
  };
}
