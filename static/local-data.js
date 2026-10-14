// La banque, les réglages et l’historique restent sur cet appareil.
import { buildBootstrap, slug, PEOPLE_KINDS } from './content.js';
import { QUESTION_BANK } from './question-bank.js';
import { bankRows, findEntry, LEVELS } from './hierarchy.js';

const KEY = 'anna-local-data-v1';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max, optional = false) => {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) fail('Texte invalide');
  return value.trim();
};

export function createLocalApi({ storage, authorize }) {
  function load() {
    let raw;
    try { raw = storage.getItem(KEY); } catch { fail('Le stockage local est indisponible. Autorisez-le pour conserver les échanges.'); }
    let db;
    if (raw) {
      try { db = JSON.parse(raw); } catch { fail('Les données locales sont illisibles. Contactez l’équipe avant de les effacer.'); }
      if (db.bank) return db;
      // Garder la banque précédente et toutes ses modifications avant la migration.
      try { if (!storage.getItem('anna-before-csv-v1')) storage.setItem('anna-before-csv-v1', raw); }
      catch { fail('Sauvegarde de l’ancienne banque impossible. L’import a été interrompu.'); }
    }
    db = {
      patient: { display_name: 'Anna', daily_plan: '', settings: { sens: 1, context: 'tous', reco: false } },
      people: [], events: [], conversations: [], notes: [], ...db,
      bank: structuredClone(QUESTION_BANK),
    };
    db.patient.settings = { ...db.patient.settings, reco: false, context: db.patient.settings?.context || 'tous' };
    for (const name of ['types', 'themes', 'questions', 'followups']) delete db[name];
    save(db);
    return db;
  }
  function save(db) {
    try { storage.setItem(KEY, JSON.stringify(db)); }
    catch { fail('Enregistrement impossible : le stockage de cet appareil est plein ou bloqué.'); }
  }
  const isPrivate = (db, id) => { const entry = findEntry(db.bank, id); return !!entry && [entry.node, ...entry.path].some(n => n.private); };
  const privateTheme = isPrivate, privateQuestion = isPrivate;
  const suffix = () => crypto.randomUUID().slice(0, 8);

  return async function localApi(method, path, body = {}) {
    const url = new URL(path, 'https://anna.local');
    const area = url.pathname.split('/').pop(), action = url.searchParams.get('action');
    const db = load();
    if (area === 'data' && method === 'GET' && action === 'bootstrap') {
      const stats = new Map();
      for (const e of db.events.filter(e => e.at > Date.now() - 180 * 864e5)) {
        const s = stats.get(e.key) || { question_key: e.key, asked: 0, yes: 0, no: 0, talk: 0, rt_sum: 0 };
        if (e.answer === 'parler') s.talk++;
        else { s.asked++; s[e.answer === 'oui' ? 'yes' : 'no']++; s.rt_sum += e.ms; }
        stats.set(e.key, s);
      }
      return { bank: structuredClone(db.bank), ...buildBootstrap({
        ...db, ...bankRows(db.bank), patient: { ...db.patient, admin_pin_hash: 'server-managed' }, stats: [...stats.values()],
        history: db.conversations.filter(c => new Date(c.created_at).getTime() > Date.now() - 60 * 864e5)
          .map(c => ({ ...c, notes: db.notes.filter(n => n.cid === c.id).map(n => [n.question, n.answer]) })).reverse(),
        isAdmin: await authorize(false),
      }) };
    }
    if (area === 'data' && method === 'POST') {
      if (action === 'events') {
        const events = (Array.isArray(body.events) ? body.events : []).filter(e =>
          typeof e.key === 'string' && typeof e.theme === 'string' && ['oui', 'non', 'parler'].includes(e.answer)
          && !privateTheme(db, e.theme) && !privateQuestion(db, e.key)
        ).map(e => ({ ...e, ms: Math.max(0, Math.min(600000, Number(e.ms) || 0)), at: Number(e.at) || Date.now() }));
        db.events.push(...events);
        db.events = db.events.filter(e => e.at > Date.now() - 180 * 864e5);
        save(db); return { saved: events.length };
      }
      if (action === 'conversation') {
        if (privateTheme(db, body.theme) || db.conversations.some(c => c.id === body.id)) return { saved: 0 };
        db.conversations.push({ id: body.id, theme_id: body.theme, path: body.path, result: body.result,
          questions_count: body.n, duration_ms: body.dur, is_urgent: !!body.urgent, created_at: new Date(body.at || Date.now()).toISOString() });
        db.conversations = db.conversations.filter(c => new Date(c.created_at).getTime() > Date.now() - 60 * 864e5);
        const ids = new Set(db.conversations.map(c => c.id));
        db.notes = db.notes.filter(n => ids.has(n.cid));
        save(db); return { saved: 1 };
      }
      if (action === 'note') {
        if (!db.conversations.some(c => c.id === body.conversationId)) return { saved: 0 };
        db.notes.push({ cid: body.conversationId, question: body.question, answer: body.answer });
        save(db); return { saved: 1 };
      }
    }
    if (area !== 'admin' || method !== 'POST') fail('Action inconnue', 404);
    if (!await authorize(true)) fail('Connexion admin requise', 403);
    let result = {};
    if (action === 'save-node' || action === 'add-node') {
      const existing = action === 'save-node' ? findEntry(db.bank, body.id) : null;
      if (action === 'save-node' && !existing) fail('Question introuvable', 404);
      const parent = body.parentId ? findEntry(db.bank, body.parentId)?.node : existing?.parent;
      if (action === 'add-node' && !parent) fail('Parent introuvable', 404);
      const level = existing?.node.level || LEVELS[LEVELS.indexOf(parent.level) + 1];
      if (!level) fail('Une sous-question ne peut pas avoir de sous-niveau');
      if (level !== 'master' && (!parent || LEVELS.indexOf(parent.level) !== LEVELS.indexOf(level) - 1)) fail('Niveau du parent invalide');
      const node = existing?.node || { id: `${level}:${suffix()}`, level, children: [], icon: 'autre', hue: 180 };
      const order = value => {
        if (value == null || value === '') return null;
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) fail('L’ordre doit être un entier positif ou vide');
        return n;
      };
      const branch = body.branch ?? node.branch ?? 'les_deux';
      if (!['oui', 'non', 'les_deux'].includes(branch)) fail('Branche invalide');
      Object.assign(node, {
        q: text(body.q, 600), label: text(body.label || body.q, 100),
        order: order(body.order), yesText: text(body.yesText || '', 600, true), noText: text(body.noText || '', 600, true),
        centre: body.centre !== false, domicile: body.domicile !== false,
      });
      if (level === 'category') { node.orderYes = order(body.orderYes); node.orderNo = order(body.orderNo); }
      if (level === 'subcategory') node.branch = branch;
      if (!existing) parent.children.push(node);
      else if (parent && parent !== existing.parent) {
        existing.parent.children = existing.parent.children.filter(n => n.id !== node.id);
        parent.children.push(node);
      }
      result = { id: node.id };
    } else if (action === 'delete-node') {
      const entry = findEntry(db.bank, body.id);
      if (!entry?.parent) fail('La question de départ ne peut pas être supprimée');
      entry.parent.children = entry.parent.children.filter(n => n.id !== body.id);
    } else if (action === 'add-person') {
      const name = text(body.name, 60), id = `${slug(name)}-${suffix()}`;
      db.people.push({ id, name, role: text(body.role || '', 80, true), kind: PEOPLE_KINDS.includes(body.kind) ? body.kind : 'Famille' });
      result = { id };
    } else if (action === 'delete-person') {
      db.people = db.people.filter(p => p.id !== body.id);
    } else if (action === 'save-plan') {
      db.patient.daily_plan = text(body.plan || '', 4000, true);
    } else if (action === 'save-settings') {
      db.patient.settings = { reco: false, sens: Math.max(.5, Math.min(1.6, Number(body.sens) || 1)), context: ['tous', 'centre', 'domicile'].includes(body.context) ? body.context : db.patient.settings.context || 'tous' };
    } else fail('Action inconnue', 404);
    save(db); return { ok: true, ...result };
  };
}
