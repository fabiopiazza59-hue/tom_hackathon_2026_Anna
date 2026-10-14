// Conversions pures entre la banque de questions en base (lignes SQL) et l'arbre envoyé au front.
// Sans dépendance à la base : testable seul et partagé par l'API, le seed et le serveur de dev.

export const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const PEOPLE_KINDS = ['Famille', 'Amis', 'Équipe', 'Rencontres'];

/** Aplati le contenu par défaut (lib/defaults.js) en lignes prêtes à insérer. */
export function flattenDefaults(types, themes) {
  const rows = { types: [], themes: [], questions: [], followups: [] };
  types.forEach((t, i) => rows.types.push({ id: t.id, name: t.name, short_label: t.short, icon: t.icon, hue: t.h, position: i }));
  themes.forEach((t, i) => {
    rows.themes.push({ id: t.id, type_id: t.type, label: t.label, subtitle: t.sub || '', icon: t.icon || 'autre',
      is_private: !!t.private, people_kinds: t.peopleKinds || null, position: i });
    const walk = (items, parentId, prefix) => (items || []).forEach((it, j) => {
      const id = prefix + '.' + slug(it.l);
      rows.questions.push({
        id, theme_id: t.id, parent_id: parentId, label: it.l, text: it.q,
        kind: it.ask ? (it.say ? 'say' : 'ask') : 'question', ask_text: it.ask || null,
        action: it.action || null, is_urgent: !!it.urgent, is_private: !!it.private,
        has_intensity: it.then === '@i', position: j,
      });
      if (Array.isArray(it.then)) walk(it.then, id, id);
    });
    walk(t.items, null, t.id);
    (t.deeper || []).forEach((text, j) => rows.followups.push({ theme_id: t.id, text, position: j }));
  });
  return rows;
}

/** Construit la charge utile du front à partir des lignes lues en base. */
export function buildBootstrap({ patient, types, themes, questions, followups, people, isAdmin }) {
  const byParent = new Map();
  for (const q of questions) {
    const k = q.parent_id || '§' + q.theme_id;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(q);
  }
  const toItem = q => {
    const children = byParent.get(q.id);
    const it = { id: q.id, l: q.label, q: q.text };
    if (q.has_intensity) it.then = '@i';
    else if (children?.length) it.then = children.map(toItem);
    if (q.is_urgent) it.urgent = true;
    if (q.is_private) it.private = true;
    if (q.action) it.action = q.action;
    if (q.kind === 'ask' || q.kind === 'say') { it.ask = q.ask_text; if (q.kind === 'say') it.say = true; }
    return it;
  };
  const deeperBy = new Map();
  for (const f of followups) {
    if (!deeperBy.has(f.theme_id)) deeperBy.set(f.theme_id, []);
    deeperBy.get(f.theme_id).push({ id: String(f.id), text: f.text });
  }
  return {
    patientName: patient.display_name,
    plan: patient.daily_plan || '',
    settings: { reco: patient.settings?.reco !== false, sens: Number(patient.settings?.sens) || 1, context: patient.settings?.context || 'tous' },
    hasPin: !!patient.admin_pin_hash,
    isAdmin: !!isAdmin,
    types: types.map(t => ({ id: t.id, name: t.name, short: t.short_label, icon: t.icon, h: t.hue })),
    themes: themes.map(t => ({
      id: t.id, label: t.label, group: t.type_id, sub: t.subtitle, icon: t.icon,
      private: t.is_private, dynamic: !!t.people_kinds, peopleKinds: t.people_kinds || [],
      items: (byParent.get('§' + t.id) || []).map(toItem),
      deeper: deeperBy.get(t.id) || [],
    })),
    people: people.map(p => ({ ...p, id: p.id, name: p.name, role: p.role, kind: p.kind })),
  };
}
