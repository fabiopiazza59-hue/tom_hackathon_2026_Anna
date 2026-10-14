// La banque, les réglages et l’historique restent sur cet appareil.
import { TYPES, THEMES, DEMO_PEOPLE, DEFAULT_PLAN } from './defaults.js';
import { flattenDefaults, buildBootstrap, slug, PEOPLE_KINDS } from './content.js';

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
    if (raw) {
      try { return JSON.parse(raw); } catch { fail('Les données locales sont illisibles. Contactez l’équipe avant de les effacer.'); }
    }
    const rows = flattenDefaults(TYPES, THEMES);
    return {
      patient: { display_name: 'Anna', daily_plan: DEFAULT_PLAN, settings: { reco: true, sens: 1 } },
      ...rows,
      followups: rows.followups.map((f, i) => ({ ...f, id: String(i + 1) })),
      people: DEMO_PEOPLE.map(p => ({ ...p, id: slug(p.name) })),
      events: [], conversations: [], notes: [],
    };
  }
  function save(db) {
    try { storage.setItem(KEY, JSON.stringify(db)); }
    catch { fail('Enregistrement impossible : le stockage de cet appareil est plein ou bloqué.'); }
  }
  const privateTheme = (db, id) => db.themes.some(t => t.id === id && t.is_private);
  const privateQuestion = (db, key) => db.questions.some(q => q.is_private && (q.id === key || key.startsWith(q.id + '.')));
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
      return buildBootstrap({
        ...db, patient: { ...db.patient, admin_pin_hash: 'server-managed' }, stats: [...stats.values()],
        history: db.conversations.filter(c => new Date(c.created_at).getTime() > Date.now() - 60 * 864e5)
          .map(c => ({ ...c, notes: db.notes.filter(n => n.cid === c.id).map(n => [n.question, n.answer]) })).reverse(),
        isAdmin: await authorize(false),
      });
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
    if (action === 'add-question') {
      const theme = db.themes.find(t => t.id === body.themeId);
      if (!theme) fail('Thème introuvable', 404);
      if (body.parentId && !db.questions.some(q => q.id === body.parentId && q.theme_id === theme.id)) fail('Question parente introuvable', 404);
      const label = text(body.label, 60), raw = text(body.text, 300);
      const kind = ['ask', 'say'].includes(body.kind) ? body.kind : 'question';
      const id = `${body.parentId || theme.id}.${slug(label) || 'q'}-${suffix()}`;
      db.questions.push({ id, theme_id: theme.id, parent_id: body.parentId || null, label,
        text: kind === 'ask' ? `Demander : « ${raw} »` : kind === 'say' ? `Dire : « ${raw} »` : raw,
        kind, ask_text: kind === 'question' ? null : raw, is_urgent: !!body.urgent, is_private: false,
        has_intensity: kind === 'question' && !!body.intensity, position: db.questions.length });
      result = { id };
    } else if (action === 'delete-question') {
      const gone = new Set([body.id]);
      let count;
      do { count = gone.size; for (const q of db.questions) if (gone.has(q.parent_id)) gone.add(q.id); } while (gone.size !== count);
      db.questions = db.questions.filter(q => !gone.has(q.id));
    } else if (action === 'add-theme') {
      if (!db.types.some(t => t.id === body.typeId)) fail('Type introuvable', 404);
      const label = text(body.label, 60), id = `${slug(label) || 'theme'}-${suffix()}`;
      db.themes.push({ id, type_id: body.typeId, label, subtitle: '', icon: 'autre', is_private: !!body.private, people_kinds: null });
      result = { id };
    } else if (action === 'add-type') {
      const name = text(body.name, 40), id = `${slug(name) || 'type'}-${suffix()}`;
      db.types.push({ id, name, short_label: name.slice(0, 14), icon: 'autre', hue: [...name].reduce((n, c) => n + c.charCodeAt(0) * 7, 0) % 360 });
      result = { id };
    } else if (action === 'delete-type') {
      if (db.themes.some(t => t.type_id === body.id)) fail('Ce type contient encore des thèmes', 409);
      db.types = db.types.filter(t => t.id !== body.id);
    } else if (action === 'add-followup') {
      if (!db.themes.some(t => t.id === body.themeId)) fail('Thème introuvable', 404);
      db.followups.push({ id: suffix(), theme_id: body.themeId, text: text(body.text, 300) });
    } else if (action === 'delete-followup') {
      db.followups = db.followups.filter(f => String(f.id) !== String(body.id));
    } else if (action === 'add-person') {
      const name = text(body.name, 60), id = `${slug(name)}-${suffix()}`;
      db.people.push({ id, name, role: text(body.role || '', 80, true), kind: PEOPLE_KINDS.includes(body.kind) ? body.kind : 'Famille' });
      result = { id };
    } else if (action === 'delete-person') {
      db.people = db.people.filter(p => p.id !== body.id);
    } else if (action === 'save-plan') {
      db.patient.daily_plan = text(body.plan || '', 4000, true);
    } else if (action === 'save-settings') {
      db.patient.settings = { reco: body.reco !== false, sens: Math.max(.5, Math.min(1.6, Number(body.sens) || 1)) };
    } else fail('Action inconnue', 404);
    save(db); return { ok: true, ...result };
  };
}
