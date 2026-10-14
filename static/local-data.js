// Adaptateur de la banque. En production, le stockage injecté est en mémoire.
import { buildBootstrap, slug, PEOPLE_KINDS } from './content.js';
import { QUESTION_BANK } from './question-bank.js';
import { bankRows, findEntry, LEVELS } from './hierarchy.js';
import { prepareBank, validDays, validPeakHours } from './question-rules.js';

const KEY = 'anna-local-data-v1';
const BACKUP = 'anna-before-csv-v1';
const INTERACTION_FIELDS = ['events', 'conversations', 'notes', 'history', 'stats', 'answers', 'interactions', 'answer_events', 'conversation_notes', 'outbox'];
const withoutInteractions = value => {
  const clean = { ...value };
  for (const field of INTERACTION_FIELDS) delete clean[field];
  return clean;
};

// Nettoyer les anciennes traces et proposer la banque locale pour un import unique.
export function legacyConfig(storage) {
  let db = null;
  try {
    storage.removeItem('anna-outbox');
    for (const key of [KEY, BACKUP]) {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const clean = withoutInteractions(JSON.parse(raw));
      storage.setItem(key, JSON.stringify(clean));
      if (key === KEY) db = clean;
    }
  } catch { return null; }
  if (!db?.bank) return null;
  return {
    bank: db.bank,
    patient: {
      display_name: db.patient?.display_name || 'Anna', daily_plan: db.patient?.daily_plan || '',
      settings: { sens: db.patient?.settings?.sens || 1, context: db.patient?.settings?.context || 'tous', reco: false },
    },
    people: db.people || [],
  };
}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max, optional = false) => {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) fail('Texte invalide');
  return value.trim();
};

export function createLocalApi({ storage, authorize }) {
  function load() {
    let raw;
    try {
      if (storage.getItem('anna-outbox') != null) storage.removeItem('anna-outbox');
      const backup = storage.getItem(BACKUP);
      if (backup) {
        const clean = JSON.stringify(withoutInteractions(JSON.parse(backup)));
        if (clean !== backup) storage.setItem(BACKUP, clean);
      }
      raw = storage.getItem(KEY);
    } catch { fail('Le nettoyage des anciennes interactions est impossible. Vérifiez l’accès au stockage du navigateur.'); }
    let db;
    if (raw) {
      try { db = JSON.parse(raw); } catch { fail('Les données locales sont illisibles. Contactez l’équipe avant de les effacer.'); }
      const clean = withoutInteractions(db);
      if (JSON.stringify(clean) !== raw) save(clean);
      db = clean;
      if (db.bank) return db;
      // Garder la banque précédente et toutes ses modifications avant la migration.
      try { if (!storage.getItem(BACKUP)) storage.setItem(BACKUP, JSON.stringify(db)); }
      catch { fail('Sauvegarde de l’ancienne banque impossible. L’import a été interrompu.'); }
    }
    db = {
      patient: { display_name: 'Anna', daily_plan: '', settings: { sens: 1, context: 'tous', reco: false } },
      people: [], ...db,
      bank: structuredClone(QUESTION_BANK),
    };
    db.patient.settings = { ...db.patient.settings, reco: false, context: db.patient.settings?.context || 'tous' };
    for (const name of ['types', 'themes', 'questions', 'followups']) delete db[name];
    save(db);
    return db;
  }
  function save(db) {
    try { storage.setItem(KEY, JSON.stringify(withoutInteractions(db))); }
    catch { fail('Enregistrement impossible : le stockage de cet appareil est plein ou bloqué.'); }
  }
  const suffix = () => crypto.randomUUID().slice(0, 8);

  return async function localApi(method, path, body = {}) {
    const url = new URL(path, 'https://anna.local');
    const area = url.pathname.split('/').pop(), action = url.searchParams.get('action');
    const db = load();
    if (area === 'data' && method === 'GET' && action === 'bootstrap') {
      const isAdmin = await authorize(false);
      const bank = isAdmin ? structuredClone(db.bank) : prepareBank(db.bank, db.people, new Date(), db.patient.settings.context || 'tous');
      return { bank, ...buildBootstrap({
        ...db, ...bankRows(bank), patient: { ...db.patient, admin_pin_hash: 'server-managed' },
        isAdmin,
      }) };
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
      const weight = Number(body.weight ?? node.weight ?? 1);
      if (!Number.isFinite(weight) || weight < 0) fail('Poids invalide');
      const days = text(body.days ?? node.days ?? '', 120, true), peakHours = text(body.peakHours ?? node.peakHours ?? '', 200, true);
      if (!validDays(days)) fail('Jours invalides : utilisez weekend, semaine ou les noms des jours séparés par une virgule');
      if (!validPeakHours(peakHours)) fail('Créneaux invalides : utilisez par exemple 8-10;12-13');
      const personId = body.personId === '' ? null : body.personId ?? node.personId ?? null;
      if (personId && !db.people.some(p => p.id === personId)) fail('Personne liée introuvable');
      const oppositeId = body.oppositeId === '' ? null : body.oppositeId ?? node.oppositeId ?? null;
      if (oppositeId && (oppositeId === node.id || findEntry(db.bank, oppositeId)?.node.level !== level)) fail('Question contraire invalide');
      Object.assign(node, { weight, days, peakHours, pinned: body.pinned ?? node.pinned ?? false, weekendOrder: order(body.weekendOrder ?? node.weekendOrder), personId, oppositeId });
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
      const clearLinks = node => { if (node.oppositeId && !findEntry(db.bank, node.oppositeId)) node.oppositeId = null; node.children.forEach(clearLinks); };
      clearLinks(db.bank.root);
    } else if (action === 'add-person' || action === 'save-person') {
      const old = action === 'save-person' ? db.people.find(p => p.id === body.id) : null;
      if (action === 'save-person' && !old) fail('Personne introuvable');
      const name = text(body.name, 60), id = old?.id || `${slug(name)}-${suffix()}`;
      const person = { ...old, id, name, role: text(body.role || '', 80, true), kind: PEOPLE_KINDS.includes(body.kind) ? body.kind : old?.kind || 'Famille' };
      person.gender = body.gender ?? old?.gender ?? '';
      if (!['', 'F', 'H'].includes(person.gender)) fail('Genre invalide');
      person.precision = text(body.precision ?? old?.precision ?? '', 150, true);
      person.days = text(body.days ?? old?.days ?? '', 120, true);
      person.weight = Number(body.weight ?? old?.weight ?? 1);
      if (!validDays(person.days) || !Number.isFinite(person.weight) || person.weight < 0) fail('Jours ou poids invalides');
      for (const flag of ['groupClose', 'groupCare', 'groupCentre', 'canContact', 'canSee', 'canTalk', 'referent']) person[flag] = body[flag] ?? old?.[flag] ?? flag.startsWith('can');
      if (old) {
        const rename = node => {
          if (node.personId === id) for (const key of ['label', 'q', 'yesText', 'noText']) {
            if (typeof node[key] === 'string') {
              node[key] = node[key].split(old.name).join(name);
              if (old.role) node[key] = node[key].split(old.role).join(person.role);
            }
          }
          node.children.forEach(rename);
        };
        rename(db.bank.root);
        db.people[db.people.indexOf(old)] = person;
      } else db.people.push(person);
      result = { id };
    } else if (action === 'delete-person') {
      const linked = node => node.personId === body.id || node.children.some(linked);
      if (linked(db.bank.root)) fail('Cette personne est liée à des questions. Retirez ou modifiez ces liens avant de la supprimer.');
      db.people = db.people.filter(p => p.id !== body.id);
    } else if (action === 'save-plan') {
      db.patient.daily_plan = text(body.plan || '', 4000, true);
    } else if (action === 'save-settings') {
      db.patient.settings = { reco: false, sens: Math.max(.5, Math.min(1.6, Number(body.sens) || 1)), context: ['tous', 'centre', 'domicile'].includes(body.context) ? body.context : db.patient.settings.context || 'tous' };
    } else fail('Action inconnue', 404);
    save(db); return { ok: true, ...result };
  };
}
