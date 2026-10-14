const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const DAYS = { lundi: 1, lun: 1, monday: 1, mardi: 2, mar: 2, tuesday: 2, mercredi: 3, mer: 3, wednesday: 3, jeudi: 4, jeu: 4, thursday: 4, vendredi: 5, ven: 5, friday: 5, samedi: 6, sam: 6, saturday: 6, dimanche: 7, dim: 7, sunday: 7 };

export function calendar(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  return { weekday, weekend: weekday >= 6, hour: +parts.hour, minute: +parts.hour * 60 + +parts.minute };
}

export function validDays(value) {
  return !value || normalize(value).split(/[;,|]+/).every(d => ['weekend', 'week-end', 'semaine', 'tous', 'tous les jours', '1', '2', '3', '4', '5', '6', '7'].includes(d.trim()) || DAYS[d.trim()]);
}

export function availableDay(value, time = calendar()) {
  if (!value) return true;
  return normalize(value).split(/[;,|]+/).some(d => {
    const day = d.trim();
    if (['tous', 'tous les jours'].includes(day)) return true;
    if (['weekend', 'week-end'].includes(day)) return time.weekend;
    if (day === 'semaine') return !time.weekend;
    return (DAYS[day] || Number(day)) === time.weekday;
  });
}

const minutes = value => { const [h, m = '0'] = value.split(':'); return +h * 60 + +m; };
export function validPeakHours(value) {
  return !value || value.split(';').every(range => {
    if (!/^\s*(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*-\s*(?:(?:[01]?\d|2[0-3])(?::[0-5]\d)?|24(?::00)?)\s*$/.test(range)) return false;
    const [a, b] = range.split('-').map(s => minutes(s.trim())); return a !== b;
  });
}
export function peakNow(value, time = calendar()) {
  if (!value || !validPeakHours(value)) return false;
  return value.split(';').some(range => {
    const [a, b] = range.split('-').map(s => minutes(s.trim()));
    return a < b ? time.minute >= a && time.minute < b : time.minute >= a || time.minute < b;
  });
}

// La projection publique ne modifie jamais la banque stockée et éditée par l’admin.
export function prepareBank(bank, people = [], date = new Date(), context = 'tous') {
  const time = calendar(date), byId = new Map(people.map(p => [p.id, p]));
  const copy = structuredClone(bank);
  function visit(node, action = null, group = '') {
    const source = node.sourceId || node.id.split(':').slice(1).join(':');
    if (node.level === 'subcategory' && ['contacter', 'voir', 'parler'].includes(source)) { action = source; group = ''; }
    const match = /^(contacter|voir|parler)_(.+)$/.exec(source);
    if (match && node.level === 'question') { action = match[1]; group = match[2]; }
    if (!availableDay(node.days, time)) return null;
    if (node.level !== 'master' && (context === 'tous' ? node.centre === false && node.domicile === false : node[context] === false)) return null;
    if (time.weekend && node.weekendOrder != null) node.order = node.weekendOrder;
    if (node.personId) {
      const p = byId.get(node.personId);
      if (!p || !availableDay(p.days, time)) return null;
      if ((action === 'contacter' && p.canContact === false) || (action === 'voir' && p.canSee === false) || (action === 'parler' && p.canTalk === false)) return null;
      if ((group === 'homme' && p.gender !== 'H') || (group === 'femme' && p.gender !== 'F') || (group === 'referent' && !p.referent)) return null;
      if (group === 'infirmiere' && !p.groupCare && !normalize(p.role).includes('infirmi')) return null;
      node.weight = (node.weight ?? 1) * (p.weight ?? 1);
    }
    const hadChildren = node.children.length;
    node.children = node.children.map(n => visit(n, action, group)).filter(Boolean);
    if (time.weekend && node.children.some(n => n.weekendOrder != null)) {
      node.children = node.children.map((n, i) => ({ n, i })).sort((a, b) =>
        Number(a.n.weekendOrder == null) - Number(b.n.weekendOrder == null)
        || (a.n.weekendOrder ?? a.n.order ?? Infinity) - (b.n.weekendOrder ?? b.n.order ?? Infinity) || a.i - b.i
      ).map(({ n }, i) => ({ ...n, order: i + 1 }));
    }
    // Ne pas terminer sur un groupe vide après filtrage de ses personnes ou de son lieu/jour.
    if (hadChildren && !node.children.length && node.level === 'question' && /^(contacter|voir|parler)_(referent|infirmiere|homme|femme)$/.test(source)) return null;
    return node;
  }
  copy.root = visit(copy.root);
  return copy;
}
