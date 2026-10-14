import { createHeadTracker } from './head-tracking.js';
import { createLocalApi } from './local-data.js';

const adminPage = /^\/admin\/?$/.test(location.pathname);

/* ================================================================ constantes */
const INTENS = [
  { id: 'int.forte', l: 'Forte', q: 'C’est une douleur forte ?' },
  { id: 'int.moyenne', l: 'Moyenne', q: 'C’est une douleur moyenne ?' },
  { id: 'int.legere', l: 'Légère', q: 'C’est une douleur légère ?' },
];
const PERSON_FOLLOW = [
  ['Voir', 'Tu veux voir {n} ?'],
  ['Appeler', 'Tu veux appeler {n} ?'],
  ['Message', 'Tu as un message pour {n} ?', 'spell'],
  ['Nouvelles', 'Tu veux des nouvelles de {n} ?'],
  ['Me manque', '{n} te manque ?'],
  ['Bon moment', 'Tu as passé un bon moment avec {n} ?'],
  ['Souci', 'Il y a un souci avec {n} ?'],
  ['Pas maintenant', 'Tu préfères ne pas voir {n} pour l’instant ?'],
];
const KINDS = ['Famille', 'Amis', 'Équipe', 'Rencontres'];
const GROUPS = [['E', 'S', 'A', 'I', 'N', 'T', 'R', 'U', 'L'], ['O', 'D', 'C', 'M', 'P', 'G', 'B', 'V', 'H'], ['F', 'Q', 'J', 'X', 'Y', 'Z', 'K', 'W', '’'], ['ESPACE', 'EFFACER', 'TERMINER', 'ANNULER']];

/* ================================================================ stockage local (préférences + file d'attente) */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
const K_OUTBOX = 'anna-outbox', K_VOICE = 'anna-voice';

// L’admin conserve la protection HTTP Basic du serveur Python.
const api = createLocalApi({
  storage: localStorage,
  authorize: async required => {
    if (!adminPage) return false;
    const response = await fetch('/api/admin-session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      if (required) throw Object.assign(new Error('Connexion admin requise'), { status: response.status });
      return false;
    }
    return true;
  },
});

// File locale : une écriture est retirée uniquement après son enregistrement dans le navigateur.
let outbox = store.get(K_OUTBOX, []), flushing = false;
function enqueue(action, payload) {
  const last = outbox[outbox.length - 1];
  if (action === 'events' && last?.action === 'events' && last.payload.events.length < 100) last.payload.events.push(...payload.events);
  else outbox.push({ action, payload });
  store.set(K_OUTBOX, outbox);
  flush();
}
async function flush() {
  if (flushing || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      try { await api('POST', '/api/data?action=' + outbox[0].action, outbox[0].payload); }
      catch (e) {
        // Erreur définitive (donnée refusée) : on l'écarte. Sinon (réseau, serveur) : on réessaiera.
        const permanent = e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);
        if (!permanent) break;
      }
      outbox.shift();
      store.set(K_OUTBOX, outbox);
    }
  } finally { flushing = false; renderSync(); }
}
setInterval(flush, 15000);
addEventListener('online', flush);

/* ================================================================ état */
let S = null;          // données de la personne (banque, personnes, historique, stats)
let F = { mode: 'home' }, undo = [], view = adminPage ? 'admin' : 'patient', cat = '__rapide';
let voice = store.get(K_VOICE, false);

async function reload() {
  S = await api('GET', '/api/data?action=bootstrap');
}

/* ================================================================ utilitaires */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = id => `<svg class="i"><use href="#i-${id}"/></svg>`;
const theme = id => S.themes.find(t => t.id === id);
const hue = s => [...String(s)].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
const typeOf = id => S.types.find(t => t.id === id) || { id, name: id, short: id, icon: 'autre', h: hue(id) };
const iconFor = t => document.getElementById('i-' + t.icon) ? t.icon : 'autre';
const fmtT = ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtD = ts => {
  const d = new Date(ts), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Auj.';
  if (d.toDateString() === y.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};
const avatar = p => `<span class="av" style="background:hsl(${hue(p.name)} 38% 42%)">${esc(p.name.replace(/^Dr\.? /, '').slice(0, 1))}</span>`;
const name = () => S?.patientName || 'Anna';
function personTheme(p) { return (S.themes.find(t => t.dynamic && t.peopleKinds.includes(p.kind)) || S.themes.find(t => t.dynamic))?.id; }
function toast(msg) { const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2800); }
// Le « Oui » / « Non » d'Anna est toujours dit à voix haute : c'est sa voix pour les personnes autour d'elle.
// La phrase suivante (question, résumé) attend la fin du mot au lieu de le couper.
let answerSaidAt = 0;
function sayAnswer(a) {
  if (!('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(a === 'oui' ? 'Oui' : 'Non'); u.lang = 'fr-FR'; u.rate = 0.95; speechSynthesis.speak(u); answerSaidAt = Date.now(); } catch { /* voix indisponible */ }
}
function speak(t, force) {
  if ((!voice && !force) || !('speechSynthesis' in window)) return;
  try { if (Date.now() - answerSaidAt > 1500) speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'fr-FR'; u.rate = 0.95; speechSynthesis.speak(u); } catch { /* voix indisponible */ }
}
function chime() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    [660, 880].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + i * 0.22;
      o.frequency.value = f; o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o.start(t0); o.stop(t0 + 0.4);
    });
  } catch { /* son indisponible */ }
}

/* ================================================================ moteur de recommandation */
function st(id) { return S.stats[id] || (S.stats[id] = { a: 0, y: 0, n: 0, p: 0, rt: 0 }); }
// Score = 50 % taux de « oui » (la question trouve le besoin) + 30 % usage + 20 % rapidité de réponse.
function scoreOf(id) {
  const x = S.stats[id];
  if (!x || !x.a) return { score: 0.3, hit: 0, a: 0, avg: 0 };
  const maxA = Math.max(1, ...Object.values(S.stats).map(v => v.a));
  const hit = (x.y + 1) / (x.a + 2), use = x.a / maxA, avg = x.rt / x.a, speed = Math.max(0, Math.min(1, 1 - avg / 8000));
  return { score: 0.5 * hit + 0.3 * use + 0.2 * speed, hit, a: x.a, avg };
}
function ordered(list) {
  if (!S.settings.reco || !Array.isArray(list)) return list;
  return list.map((it, i) => ({ it, i, s: scoreOf(it.id).score }))
    .sort((a, b) => (b.it.urgent ? 1 : 0) - (a.it.urgent ? 1 : 0) || (a.it.action === 'spell') - (b.it.action === 'spell') || b.s - a.s || a.i - b.i)
    .map(o => o.it);
}
const peopleOf = t => S.people.filter(p => personTheme(p) === t.id);
function themeItems(t) {
  if (!t.dynamic) return ordered(t.items);
  const ppl = peopleOf(t).map(p => ({
    id: `${t.id}.${p.id}`, l: p.name, q: `C’est à propos de ${p.name}${p.role ? ` (${p.role})` : ''} ?`,
    then: PERSON_FOLLOW.map(([l, q, a]) => ({ id: `${t.id}.${p.id}.${l.toLowerCase().replace(/[^a-z]+/g, '-')}`, l, q: q.replace('{n}', p.name), action: a })),
  }));
  return [...ordered(ppl), ...t.items];
}
function suggestions() {
  const now = Date.now(), hr = new Date().getHours(), map = new Map();
  S.history.filter(e => e.result === 'resolu' && e.path.length > 1 && theme(e.theme)).forEach(e => {
    const k = e.theme + '|' + e.path.join('|'), dh = Math.abs(new Date(e.ts).getHours() - hr);
    const w = (Math.min(dh, 24 - dh) <= 2 ? 2 : 1) * Math.exp(-(now - e.ts) / (7 * 864e5));
    const m = map.get(k) || { theme: e.theme, path: e.path, w: 0 }; m.w += w; map.set(k, m);
  });
  return [...map.values()].sort((a, b) => b.w - a.w).slice(0, 5);
}

/* ================================================================ déroulé des questions */
const cur = () => { const top = F.stack[F.stack.length - 1]; return top.list[top.idx]; };
function goHome() { F = { mode: 'home' }; undo = []; render(); }
function startTheme(id, pre) {
  const t = theme(id); if (!t) return;
  const list = themeItems(t);
  if (!list.length) { toast(`« ${t.label} » n’a pas encore de questions : ajoute-les dans l’espace admin.`); return goHome(); }
  F = { mode: 'q', theme: id, stack: [{ list, idx: 0 }], path: [t.label], asked: [], t0: Date.now(), priv: !!t.private, urgent: false };
  undo = [];
  if (pre) { const it = F.stack[0].list.find(x => x.id === pre); if (it) { F.path.push(it.l); F.stack.push({ list: ordered(it.then), idx: 0 }); } }
  showQ();
}
function startScan() {
  const list = S.themes.filter(t => themeItems(t).length).map(t => ({ t, u: S.history.filter(e => e.theme === t.id).length })).sort((a, b) => b.u - a.u)
    .map(({ t }) => ({ id: 'scan.' + t.id, l: t.label, q: `C’est à propos de : ${t.label} ?`, goto: t.id }));
  F = { mode: 'q', theme: 'scan', stack: [{ list, idx: 0 }], path: ['Choix du thème'], asked: [], t0: Date.now(), priv: false };
  undo = []; showQ();
}
function quickQ(sg) {
  const t = theme(sg.theme), first = t?.items.find(x => x.l === sg.path[1]), rest = sg.path.slice(2).join(', ').toLowerCase();
  if (first?.ask) return first.q;
  if (first) return rest ? first.q.replace(/\s*\?$/, '') + ' : ' + rest + ' ?' : first.q;
  return 'Encore : ' + sg.path.slice(1).join(', ').toLowerCase() + ' ?';
}
function startQuick(sg) {
  F = { mode: 'q', theme: sg.theme, stack: [{ list: [{ id: 'quick', l: sg.path[sg.path.length - 1], q: quickQ(sg) }], idx: 0 }], path: sg.path.slice(0, -1), asked: [], t0: Date.now(), priv: false, quick: true };
  undo = []; showQ();
}
function showPlan() { F = { mode: 'done', theme: 'journee', path: ['Ma journée', 'Programme du jour'], result: 'resolu', action: 'planning', entryNotes: [], priv: false, quick: true }; render(); speak('Voici le programme de ta journée.'); }
function showQ() { F.qTs = Date.now(); render(); speak(cur().q); }

function answer(a) {
  flash(a);
  if ($('#ovRoot').firstChild) { if (a === 'parler') return; closeOv(); }
  if (a === 'parler') return talk();
  if (view !== 'patient') return;
  sayAnswer(a);
  if (F.mode === 'home') { if (a === 'oui') startScan(); return; }
  if (F.mode === 'spell') return spellAnswer(a);
  if (F.mode === 'deeper') {
    F.entryNotes.push([F.dq, a]);
    if (F.entry) { F.entry.notes.push([F.dq, a]); enqueue('note', { conversationId: F.entry.id, question: F.dq, answer: a }); }
    F.mode = 'done'; render(); return;
  }
  if (F.mode === 'done') { if (a === 'oui') { (F.theme === 'scan' || F.theme === 'parler' || F.quick) ? startScan() : startTheme(F.theme); } else goHome(); return; }
  if (F.mode !== 'q') return;
  undo.push(JSON.stringify(F));
  const it = cur(), rt = Date.now() - F.qTs;
  if (!F.priv && !it.private && it.id !== 'quick' && !it.id.startsWith('scan.')) {
    const x = st(it.id); x.a++; x[a === 'oui' ? 'y' : 'n']++; x.rt += rt;
    enqueue('events', { events: [{ key: it.id, theme: F.theme, answer: a, ms: rt, at: Date.now() }] });
  }
  F.asked.push(it.id);
  if (a === 'oui') {
    if (it.goto) return startTheme(it.goto);
    F.path.push(it.l); if (it.private) F.priv = true; if (it.urgent) F.urgent = true;
    if (it.action === 'spell') return startSpell(F.path.slice());
    const th = it.then === '@i' ? INTENS : it.then;
    if (th && th.length) { F.stack.push({ list: th === INTENS ? INTENS : ordered(th), idx: 0 }); return showQ(); }
    return conclude('resolu', it);
  }
  const top = F.stack[F.stack.length - 1]; top.idx++;
  if (top.idx >= top.list.length) {
    if (F.quick) return goHome();
    return conclude(F.stack.length > 1 ? 'resolu' : 'non-trouve');
  }
  showQ();
}
function record(entry) {
  S.history.unshift(entry);
  enqueue('conversation', { id: entry.id, theme: entry.theme, path: entry.path, result: entry.result, n: entry.n, dur: entry.dur, urgent: entry.urgent, at: entry.ts });
}
function newEntry(theme, path, result, extra = {}) {
  return { id: crypto.randomUUID(), ts: Date.now(), theme, path, result, n: 0, dur: 0, urgent: false, notes: [], ...extra };
}
function conclude(result, it) {
  Object.assign(F, { mode: 'done', result, action: it?.action, ask: it?.ask, say: it?.say, entryNotes: [] });
  F.entry = null;
  if (!F.priv && F.theme !== 'scan') {
    F.entry = newEntry(F.theme, F.path.slice(), result, { n: F.asked.length, dur: Date.now() - F.t0, urgent: !!F.urgent });
    record(F.entry);
  }
  render();
  if (F.ask) return speak(F.ask, true);
  speak((result === 'non-trouve' ? 'Je n’ai pas trouvé. Tu veux épeler ?' : 'Compris : ' + F.path.slice(1).join(', ') + '.') + ' Autre chose ?');
  if (F.urgent) chime();
}
function back() {
  if (F.mode === 'spell' || F.mode === 'home') return goHome();
  if (F.mode === 'deeper') { F.mode = 'done'; return render(); }
  const s = undo.pop(); if (!s) return goHome();
  F = JSON.parse(s); showQ();
}

/* épellation lettre par lettre */
function startSpell(ctx) { F = { mode: 'spell', ctx: ctx || ['Message'], g: 0, l: null, text: '', priv: !!F.priv, theme: (F.theme && F.theme !== 'scan') ? F.theme : 'parler' }; render(); speak('On épelle. ' + spellQ()); }
const spellQ = () => F.l === null ? `Lettre dans : ${GROUPS[F.g].join(' ')} ?` : `« ${GROUPS[F.g][F.l]} » ?`;
function spellPick(g, l) {
  const v = GROUPS[g][l];
  if (v === 'ESPACE') F.text += ' ';
  else if (v === 'EFFACER') F.text = F.text.slice(0, -1);
  else if (v === 'ANNULER') return goHome();
  else if (v === 'TERMINER') {
    if (!F.text.trim()) return goHome();
    const path = [...F.ctx, F.text.trim()], th = F.theme, priv = F.priv, isAsk = th === 'interaction' || th === 'dire';
    F = { mode: 'done', theme: th, path, result: 'message', entryNotes: [], priv, ask: isAsk ? path[path.length - 1] : undefined, say: th === 'dire' };
    F.entry = priv ? null : newEntry(th, path, 'message');
    if (F.entry) record(F.entry);
    render(); speak((F.ask ? '' : 'Message : ') + path[path.length - 1], !!F.ask); return;
  } else F.text += v;
  F.g = 0; F.l = null; render(); speak(spellQ());
}
function spellAnswer(a) {
  if (F.l === null) { if (a === 'oui') F.l = 0; else F.g = (F.g + 1) % GROUPS.length; }
  else { if (a === 'oui') return spellPick(F.g, F.l); F.l++; if (F.l >= GROUPS[F.g].length) { F.l = null; F.g = (F.g + 1) % GROUPS.length; } }
  render(); speak(spellQ());
}

/* « je veux parler » */
function talk() {
  chime(); speak(`${name()} veut parler`);
  if (F.mode === 'q' && !F.priv && cur().id !== 'quick' && !cur().id.startsWith('scan.')) {
    st(cur().id).p++;
    enqueue('events', { events: [{ key: cur().id, theme: F.theme, answer: 'parler', ms: Date.now() - F.qTs, at: Date.now() }] });
  }
  if (!F.priv) record(newEntry('parler', ['Demande de parole'], 'parole'));
  $('#ovRoot').innerHTML = `<div class="ov" role="dialog" aria-modal="true" aria-labelledby="ovT"><div class="ovc">
    <h2 id="ovT">${esc(name())} veut parler</h2>
    <p class="muted" style="margin:0">Approche-toi et choisis avec elle comment continuer.</p>
    <div class="row">
      <button class="btn primary" data-ov="spell">${ic('spell')} Épeler</button>
      <button class="btn" data-ov="scan">${ic('scan')} Les thèmes</button>
      <button class="btn" data-ov="proches">${ic('proches')} Un proche</button>
      <button class="btn" data-ov="close">Fermer</button>
    </div></div></div>`;
}
function closeOv() { $('#ovRoot').innerHTML = ''; }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ov]'); if (!b) return;
  const k = b.dataset.ov; closeOv();
  if (k === 'close') return render();
  view = 'patient';
  if (k === 'spell') startSpell(['Message']); else if (k === 'scan') startScan(); else if (k === 'proches') startTheme('proches');
});

/* ================================================================ rendu : vue d'Anna */
function render() {
  if (!S) return;
  renderTop();
  const m = $('#main');
  $('#bar').hidden = view !== 'patient';
  m.classList.toggle('board-mode', view === 'patient' && F.mode === 'home');
  if (view === 'admin') { m.innerHTML = renderAdmin(); bindAdmin(); return; }
  m.innerHTML = F.mode === 'home' ? renderBoard() : F.mode === 'q' ? renderQ() : F.mode === 'done' ? renderDone() : F.mode === 'deeper' ? renderDeeper() : renderSpell();
  m.scrollTop = 0;
}
function renderTop() {
  const now = new Date(), nav = view === 'patient' && F.mode !== 'home';
  $('#top').innerHTML = `
    <div class="who"><b>${esc(name())}</b><span class="clock">${now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtT(now)}</span><span id="sync"></span></div>
    ${nav ? `<button class="ib nav-b" id="tBack" aria-label="Retour">${ic('back')}<span class="lb">Retour</span></button><button class="ib nav-b" id="tHome" aria-label="Accueil">${ic('home')}<span class="lb">Accueil</span></button>` : ''}
    <button class="ib ${tracker.running ? 'on' : ''}" id="tCam" aria-label="Caméra" title="Détection des mouvements de tête">${ic('cam')}<span class="lb">${tracker.running ? 'Tête active' : 'Caméra'}</span></button>
    <button class="ib ${voice ? 'on' : ''}" id="tVoice" aria-label="Voix" title="Lire les questions à voix haute">${ic('voice')}<span class="lb">Voix</span></button>
    <button class="ib ${view === 'admin' ? 'on' : ''}" id="tView" aria-label="${view === 'admin' ? 'Retour à la vue patient' : 'Espace admin'}">${view === 'admin' ? ic('home') : ic('gear')}<span class="lb">${view === 'admin' ? 'Vue ' + esc(name()) : 'Admin'}</span></button>`;
  $('#tBack')?.addEventListener('click', back);
  $('#tHome')?.addEventListener('click', goHome);
  $('#tCam').onclick = toggleCam;
  $('#tVoice').onclick = () => { voice = !voice; store.set(K_VOICE, voice); renderTop(); if (voice) speak('Lecture à voix haute activée'); };
  $('#tView').onclick = () => view === 'admin' ? leaveAdmin() : openAdmin();
  renderSync();
}
function renderSync() {
  const el = $('#sync'); if (!el) return;
  el.innerHTML = outbox.length ? `<span class="sync" title="Réponses en attente d’enregistrement sur cet appareil">${ic('cloud')} ${outbox.length} en attente</span>` : '';
}
function railItems() {
  return [{ id: '__rapide', short: 'Rapide', icon: 'star', h: 40 }, ...S.types.filter(ty => S.themes.some(t => t.group === ty.id))];
}
function renderBoard() {
  const rail = railItems(); if (!rail.some(r => r.id === cat)) cat = '__rapide';
  const curType = rail.find(r => r.id === cat);
  let head, cells;
  if (cat === '__rapide') {
    head = ['Accès rapide', 'Hoche la tête pour tout parcourir'];
    cells = [
      `<button class="cell" style="--h:40" data-act="scan">${ic('scan')}<b>Tout parcourir</b><small>Oui / non thème par thème</small></button>`,
      ...suggestions().map((s, i) => { const t = theme(s.theme); return `<button class="cell" style="--h:${typeOf(t.group).h}" data-sugg="${i}">${ic(iconFor(t))}<b>${esc(s.path.slice(1).join(' · '))}</b><small>${esc(t.label)} · fréquent</small></button>`; }),
      theme('interaction') ? `<button class="cell" style="--h:300" data-theme="interaction">${ic('interaction')}<b>Poser une question</b><small>${esc(name())} demande à quelqu’un</small></button>` : '',
      `<button class="cell" style="--h:95" data-act="plan">${ic('plan')}<b>Ma journée</b><small>Le programme</small></button>`,
      `<button class="cell" style="--h:40" data-act="spell">${ic('spell')}<b>Épeler</b><small>Lettre par lettre</small></button>`,
    ];
  } else {
    const ts = S.themes.filter(t => t.group === cat);
    head = [curType.name, ts.length + ' thème' + (ts.length > 1 ? 's' : '')];
    cells = [];
    ts.forEach(t => {
      cells.push(`<button class="cell" style="--h:${curType.h}" data-theme="${t.id}">${ic(t.private ? 'intime' : iconFor(t))}<b>${esc(t.label)}</b><small>${esc(t.sub || '')}</small></button>`);
      if (t.dynamic) peopleOf(t).forEach(p => cells.push(`<button class="cell" style="--h:${curType.h}" data-person="${p.id}">${avatar(p)}<b>${esc(p.name)}</b><small>${esc(p.role)}</small></button>`));
    });
  }
  return `<div class="board">
    <nav class="rail" aria-label="Catégories">${rail.map(r => `<button class="rb ${r.id === cat ? 'cur' : ''}" style="--h:${r.h}" data-cat="${esc(r.id)}">${ic(r.icon)}<span>${esc(r.short)}</span></button>`).join('')}</nav>
    <div class="gridwrap"><div class="ghead"><h2>${esc(head[0])}</h2><span>${esc(head[1])}</span></div><div class="cells">${cells.join('')}</div></div>
  </div>`;
}
const crumbs = () => `<div class="crumbs">${F.path.map(p => `<span class="c">${esc(p)}</span>`).join('<span>›</span>')}${F.priv ? `<span class="c lockb">${ic('intime')} Non enregistré</span>` : ''}</div>`;
function renderQ() {
  const it = cur(), top = F.stack[F.stack.length - 1];
  return `<div class="qv">${crumbs()}
    <h1 class="q">${esc(it.q)}</h1>
    <div class="qmeta"><span>${top.idx + 1} / ${top.list.length}</span>${it.urgent ? '<span class="pill u">Prioritaire</span>' : ''}<span>Hocher = oui · tourner = non · pencher 1 s = parler</span></div>
  </div>`;
}
const deeperList = () => (theme(F.theme)?.deeper || []).map(d => d.text);
const parsePlan = () => (S.plan || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const m = l.match(/^(\d{1,2})[:h](\d{2})\s+(.*)$/); return m ? { t: m[1].padStart(2, '0') + ':' + m[2], label: m[3] } : null;
}).filter(Boolean);
function renderDone() {
  const plan = F.action === 'planning' ? `<ul class="plist">${parsePlan().map(p => `<li><time>${p.t}</time>${esc(p.label)}</li>`).join('') || '<li class="muted">Aucun programme saisi.</li>'}</ul>` : '';
  const time = F.action === 'heure' ? `<p class="big" style="font-size:26px">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtT(Date.now())}</p>` : '';
  const title = F.result === 'non-trouve' ? 'Besoin non trouvé' : F.result === 'message' ? '« ' + F.path[F.path.length - 1] + ' »' : (F.path.slice(1).join(' › ') || F.path[0]);
  const asked = new Set(F.entryNotes.map(n => n[0])), dl = deeperList();
  const main = F.ask
    ? `<span class="tag">${esc(name())} ${F.say ? 'te dit' : 'te demande'}</span><p class="big ask">${esc(F.ask)}</p><div><button class="btn" data-act="reread">${ic('voice')} Relire à voix haute</button></div>`
    : `<span class="tag">${F.result === 'non-trouve' ? 'Pas dans la liste' : F.result === 'message' ? 'Message de ' + esc(name()) : esc(name()) + ' a exprimé'}</span><p class="big">${esc(title)}</p>`;
  return `<div class="done"><div class="result ${F.urgent ? 'urgent' : ''}">
      ${crumbs()}${main}
      ${F.urgent ? '<p class="urg">Prioritaire : préviens l’équipe soignante maintenant.</p>' : ''}
      ${plan}${time}
      ${F.result === 'non-trouve' ? `<div><button class="btn primary" data-act="spellctx">${ic('spell')} Épeler avec ${esc(name())}</button></div>` : ''}
      ${F.entryNotes.length ? `<ul class="notes">${F.entryNotes.map(([q, a]) => `<li><span>${esc(q)}</span><span class="${a === 'oui' ? 'ans-y' : 'ans-n'}">${a === 'oui' ? 'Oui' : 'Non'}</span></li>`).join('')}</ul>` : ''}
      <p class="next">Autre chose, ${esc(name())} ?</p>
      <span class="muted" style="font-size:13.5px">Oui : continuer dans ce thème · Non : accueil</span>
    </div>
    ${dl.length ? `<div class="deeper"><h3>${ic('deeper')} Pour aller plus loin</h3>
      <p>Pour l’entourage : touche une question pour la poser à ${esc(name())}.</p>
      <div class="dlist">${dl.map((q, i) => `<button data-deep="${i}" class="${asked.has(q) ? 'asked' : ''}">${esc(q)}</button>`).join('')}</div></div>` : ''}
  </div>`;
}
const renderDeeper = () => `<div class="qv">${crumbs()}<span class="pill t" style="align-self:flex-start">Pour aller plus loin</span><h1 class="q">${esc(F.dq)}</h1></div>`;
function renderSpell() {
  return `<div class="spell">
    <div class="typed">${esc(F.text)}<span class="caret"></span></div>
    <h1 class="q" style="font-size:clamp(22px,5vw,36px)">${esc(spellQ())}</h1>
    <div>${GROUPS.map((g, gi) => `<div class="lg ${gi === F.g ? 'cur' : ''}">${g.map((c, li) => `<button class="${c.length > 1 ? 'act' : ''} ${gi === F.g && li === F.l ? 'cur' : ''}" data-pick="${gi},${li}">${c}</button>`).join('')}</div>`).join('')}</div>
    <p class="muted" style="margin:0;font-size:13.5px">Oui choisit le groupe puis la lettre, non passe au suivant. Tu peux aussi toucher une lettre.</p></div>`;
}

$('#main').addEventListener('click', e => {
  if (view !== 'patient' || !S) return;
  const g = x => e.target.closest(x);
  let b;
  if ((b = g('[data-cat]'))) { cat = b.dataset.cat; return render(); }
  if ((b = g('[data-theme]'))) return startTheme(b.dataset.theme);
  if ((b = g('[data-person]'))) { const p = S.people.find(x => x.id === b.dataset.person), th = personTheme(p); return startTheme(th, `${th}.${p.id}`); }
  if ((b = g('[data-sugg]'))) return startQuick(suggestions()[+b.dataset.sugg]);
  if ((b = g('[data-deep]'))) { F.dq = deeperList()[+b.dataset.deep]; F.mode = 'deeper'; render(); speak(F.dq); return; }
  if ((b = g('[data-pick]'))) { const [x, y] = b.dataset.pick.split(',').map(Number); return spellPick(x, y); }
  if ((b = g('[data-act]'))) {
    const a = b.dataset.act;
    if (a === 'scan') startScan(); else if (a === 'spell') startSpell(['Message']); else if (a === 'plan') showPlan();
    else if (a === 'spellctx') startSpell([...F.path]); else if (a === 'reread') speak(F.ask, true);
  }
});
$('#bYes').onclick = () => answer('oui');
$('#bNo').onclick = () => answer('non');
$('#bTalk').onclick = () => answer('parler');
document.addEventListener('keydown', e => {
  if (!S || e.target.matches('input,textarea,select')) return;
  const k = e.key.toLowerCase();
  if (k === 'o' || k === 'arrowright') answer('oui');
  else if (k === 'n' || k === 'arrowleft') answer('non');
  else if (k === 'p' || k === ' ') { e.preventDefault(); answer('parler'); }
  else if (k === 'backspace' || k === 'escape') { if ($('#ovRoot').firstChild) closeOv(); else if (view === 'patient') back(); }
});
function flash(a) { const el = $({ oui: '#bYes', non: '#bNo', parler: '#bTalk' }[a]); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 350); }

/* ================================================================ espace soignant */
let tab = 'resume', qType = '', qTheme = '', qSearch = '', histF = '', armed = '';

function openAdmin() { location.assign('/admin'); }
function leaveAdmin() { location.assign('/'); }
async function adm(action, payload, okMsg) {
  try {
    const r = await api('POST', '/api/admin?action=' + action, payload);
    await reload(); armed = ''; render();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    if (e.status === 401 || e.status === 403) { location.assign('/admin'); }
    else toast(e.message);
  }
}
const walkItems = (list, d, out, t) => { (list || []).forEach(it => { out.push({ it, t, d }); if (Array.isArray(it.then)) walkItems(it.then, d + 1, out, t); }); return out; };

function renderAdmin() {
  return `<div class="adm"><p class="muted local-notice">Données conservées sur cet appareil uniquement.</p>
    <div class="seg" role="tablist">${[['resume', 'Résumé'], ['questions', 'Questions'], ['reglages', 'Réglages']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}" class="${tab === k ? 'cur' : ''}">${l}</button>`).join('')}</div>
    ${tab === 'resume' ? admResume() : tab === 'questions' ? admQuestions() : admSettings()}
  </div>`;
}
function admResume() {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const today = S.history.filter(e => e.ts >= day.getTime());
  const pain = today.filter(e => e.theme === 'douleur'), urg = today.filter(e => e.urgent), talks = today.filter(e => e.result === 'parole'), nf = today.filter(e => e.result === 'non-trouve');
  const list = S.history.filter(e => !histF || e.theme === histF).slice(0, 60);
  const pill = r => ({ resolu: '<span class="pill ok">compris</span>', 'non-trouve': '<span class="pill ko">non trouvé</span>', parole: '<span class="pill t">veut parler</span>', message: '<span class="pill ok">message</span>' }[r] || '');
  return `<div class="stats">
      <div class="stat"><span class="n">${today.length}</span><span class="l">échanges aujourd’hui</span></div>
      <div class="stat ${pain.length >= 2 ? 'warn' : ''}"><span class="n">${pain.length}</span><span class="l">douleurs${pain[0] ? ' · ' + esc(pain[0].path.slice(1).join(' › ')) : ''}</span></div>
      <div class="stat ${urg.length ? 'warn' : ''}"><span class="n">${urg.length}</span><span class="l">prioritaires</span></div>
      <div class="stat"><span class="n">${talks.length}</span><span class="l">demandes de parole</span></div>
    </div>
    ${nf.length ? `<p class="muted" style="margin:0;font-size:14px">${nf.length} besoin(s) non trouvé(s) aujourd’hui : pense à ajouter une question.</p>` : ''}
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px"><h3 style="margin:0">Historique (60 jours)</h3>
      <select id="histF" style="width:auto" aria-label="Filtrer l’historique">${[['', 'Tout'], ...S.themes.filter(t => !t.private).map(t => [t.id, t.label]), ['parler', 'Parole']].map(([v, l]) => `<option value="${esc(v)}" ${histF === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <ul class="rows">${list.map(e => `<li><time>${fmtD(e.ts)}<br>${fmtT(e.ts)}</time><div class="t"><b>${esc(e.path.join(' › '))}</b>
        ${e.notes?.length ? `<small>${e.notes.map(([q, a]) => esc(q) + ' → ' + (a === 'oui' ? 'oui' : 'non')).join(' · ')}</small>` : ''}</div>
        <div>${e.urgent ? '<span class="pill u">prioritaire</span> ' : ''}${pill(e.result)}</div></li>`).join('') || '<li class="muted">Aucun échange pour l’instant.</li>'}</ul>
      <p class="muted" style="font-size:13px;margin:10px 0 0">${ic('intime')} Les échanges « Vie privée » ne sont jamais enregistrés.</p></div>`;
}
function admQuestions() {
  if (!qType || !S.types.some(t => t.id === qType)) qType = S.types[0]?.id || '';
  const ts = S.themes.filter(t => t.group === qType);
  if (!ts.some(t => t.id === qTheme)) qTheme = ts[0]?.id || '';
  const t = theme(qTheme), q = qSearch.trim().toLowerCase();
  let rows;
  if (q) {
    rows = []; S.themes.forEach(th => walkItems(th.items, 0, rows, th));
    rows = rows.filter(r => (r.it.q + ' ' + r.it.l).toLowerCase().includes(q)).map(r => ({ ...r, d: 0 })).sort((a, b) => scoreOf(b.it.id).score - scoreOf(a.it.id).score);
  } else rows = t ? walkItems(t.items, 0, [], t) : [];
  const row = ({ it, t: th, d }) => {
    const s = scoreOf(it.id);
    return `<li class="l${Math.min(d, 2)}"><div class="t">${esc(it.q)}<small>${q ? esc(th.label) + ' · ' : ''}${s.a} usages · ${s.a ? Math.round(s.hit * 100) + ' % oui' : 'nouvelle'}${it.urgent ? ' · prioritaire' : ''}${it.then === '@i' ? ' · + intensité' : ''}</small></div>
      <span class="sbar" title="Score de recommandation"><b style="width:${Math.round(s.score * 100)}%"></b></span>
      <button class="btn sm danger" data-del="${esc(it.id)}">${armed === it.id ? 'Confirmer' : 'Suppr.'}</button></li>`;
  };
  const parents = t ? walkItems(t.items, 0, [], t).filter(r => r.it.then !== '@i' && !r.it.action) : [];
  return `<input type="search" id="qSearch" placeholder="Chercher dans la banque de questions…" aria-label="Chercher une question" value="${esc(qSearch)}">
    ${q ? '' : `<div class="chips">${S.types.map(ty => `<button data-qtype="${esc(ty.id)}" class="${ty.id === qType ? 'cur' : ''}">${esc(ty.short)}</button>`).join('')}</div>
    ${ts.length ? `<div class="chips">${ts.map(x => `<button data-qtheme="${esc(x.id)}" class="${x.id === qTheme ? 'cur' : ''}">${esc(x.label)}</button>`).join('')}</div>` : '<p class="muted">Aucun thème dans ce type. Crée-en un ci-dessous.</p>'}`}
    <div class="card">
      ${q ? `<h3>${rows.length} résultat(s)</h3>` : t ? `<h3>${esc(t.label)}${t.private ? ' <span class="pill">sans historique</span>' : ''}</h3>${t.dynamic ? `<p class="muted" style="margin:0 0 6px;font-size:13.5px">+ une question par personne (${esc(t.peopleKinds.join(', '))}), gérées dans Réglages.</p>` : ''}` : ''}
      <ul class="rows">${rows.map(row).join('')}</ul>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0">La barre = score de recommandation (50 % taux de oui, 30 % usage, 20 % rapidité). Les meilleures questions sont posées en premier.</p>
      ${t && !q ? `<details ${rows.length ? '' : 'open'}><summary>+ Ajouter une question</summary>
        <form class="fgrid c2" id="fQ">
          <label class="fl">Type<select id="qKind"><option value="question">Question à ${esc(name())}</option><option value="ask">${esc(name())} demande…</option><option value="say">${esc(name())} dit…</option></select></label>
          <label class="fl">Texte (tutoiement)<input type="text" id="qText" placeholder="Tu veux… ?" required maxlength="300"></label>
          <label class="fl">Mot-clé pour le résumé<input type="text" id="qLabel" placeholder="ex. Lunettes" required maxlength="60"></label>
          <label class="fl">Placer sous<select id="qParent"><option value="">Début du thème</option>${parents.map(({ it, d }) => `<option value="${esc(it.id)}">${'— '.repeat(d + 1)}${esc(it.l)}</option>`).join('')}</select></label>
          <label class="ck"><input type="checkbox" id="qUrg"> Prioritaire</label>
          <label class="ck"><input type="checkbox" id="qInt"> Demander l’intensité</label>
          <button class="btn primary">Ajouter</button>
        </form></details>
      <details><summary>Pour aller plus loin (${t.deeper.length})</summary>
        <ul class="rows">${t.deeper.map(d => `<li><div class="t">${esc(d.text)}</div><button class="btn sm danger" data-ddel="${esc(d.id)}">Retirer</button></li>`).join('')}</ul>
        <form class="fgrid c2" id="fD" style="margin-top:8px"><input type="text" id="dText" placeholder="Question pour l’entourage" aria-label="Question pour l’entourage" required maxlength="300"><button class="btn primary">Ajouter</button></form>
      </details>` : ''}
    </div>
    ${q ? '' : `<div class="card"><details style="border:none;margin:0;padding:0"><summary>+ Nouveau thème ou type</summary>
      <form class="fgrid c2" id="fT">
        <label class="fl">Nom du thème<input type="text" id="tName" required maxlength="60"></label>
        <label class="fl">Type<select id="tGroup">${S.types.map(g => `<option value="${esc(g.id)}" ${g.id === qType ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
        <label class="ck"><input type="checkbox" id="tPriv"> Sans historique</label>
        <button class="btn primary">Créer le thème</button>
      </form>
      <form class="fgrid c2" id="fTy" style="margin-top:12px"><label class="fl">Nouveau type (catégorie à gauche)<input type="text" id="tyName" placeholder="ex. Santé" required maxlength="40"></label><button class="btn">Créer le type</button></form>
      ${ts.length ? '' : `<button class="btn danger" style="margin-top:12px" data-tydel="${esc(qType)}">Supprimer ce type vide</button>`}
    </details></div>`}`;
}
function admSettings() {
  return `<div class="card"><h3>Personnes</h3>
      <ul class="rows">${S.people.map(p => `<li>${avatar(p)}<div class="t"><b>${esc(p.name)}</b><small>${esc(p.role)} · ${esc(p.kind)}</small></div><button class="btn sm danger" data-pdel="${esc(p.id)}">${armed === p.id ? 'Confirmer' : 'Retirer'}</button></li>`).join('') || '<li class="muted">Aucune personne pour l’instant.</li>'}</ul>
      <details ${S.people.length ? '' : 'open'}><summary>+ Ajouter une personne</summary>
        <form class="fgrid c2" id="fP">
          <label class="fl">Prénom<input type="text" id="pName" required maxlength="60"></label>
          <label class="fl">Lien avec ${esc(name())}<input type="text" id="pRole" placeholder="ex. cousine, bénévole" maxlength="80"></label>
          <label class="fl">Catégorie<select id="pKind">${KINDS.map(k => `<option>${k}</option>`).join('')}</select></label>
          <button class="btn primary">Ajouter</button>
        </form></details></div>
    <div class="card"><h3>Programme du jour</h3>
      <textarea id="plan" aria-label="Programme du jour" maxlength="4000">${esc(S.plan)}</textarea>
      <div style="margin-top:8px;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span class="muted" style="font-size:13px">Une ligne par moment : HH:MM activité</span><button class="btn primary" id="savePlan">Enregistrer</button></div></div>
    <div class="card"><h3>Options</h3>
      <div class="fgrid">
        <label class="ck"><input type="checkbox" id="reco" ${S.settings.reco ? 'checked' : ''}> Poser d’abord les questions les plus efficaces</label>
        <label class="fl">Amplitude du mouvement de tête : <b id="sensV">${Math.round(S.settings.sens * 100)} %</b><input type="range" id="sens" min="0.5" max="1.6" step="0.05" value="${S.settings.sens}"></label>
      </div></div>
    <div class="card"><h3>Cet appareil</h3>
      <p class="muted" style="margin:0">Questions, personnes, programme et historique sont conservés dans ce navigateur. Ils ne sont pas synchronisés avec d’autres appareils. L’accès admin utilise les identifiants configurés sur le serveur.</p>
      <p style="margin:12px 0 0"><a href="/static/anna-qr-code.png" target="_blank" rel="noopener">QR code de la page publique</a></p></div>`;
}
function bindAdmin() {
  const m = $('#main'), on = (sel, ev, fn) => m.querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));
  const confirmOr = (id, fn) => { if (armed !== id) { armed = id; return render(); } fn(); };
  on('[data-tab]', 'click', e => { tab = e.currentTarget.dataset.tab; armed = ''; render(); });
  on('#histF', 'change', e => { histF = e.target.value; render(); });
  on('[data-qtype]', 'click', e => { qType = e.currentTarget.dataset.qtype; qTheme = ''; render(); });
  on('[data-qtheme]', 'click', e => { qTheme = e.currentTarget.dataset.qtheme; render(); });
  on('#qSearch', 'input', e => { qSearch = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#qSearch'); s.focus(); s.setSelectionRange(pos, pos); });
  on('[data-del]', 'click', e => { const id = e.currentTarget.dataset.del; confirmOr(id, () => adm('delete-question', { id }, 'Question supprimée')); });
  on('[data-ddel]', 'click', e => adm('delete-followup', { id: e.currentTarget.dataset.ddel }));
  on('[data-tydel]', 'click', e => adm('delete-type', { id: e.currentTarget.dataset.tydel }, 'Type supprimé'));
  on('[data-pdel]', 'click', e => { const id = e.currentTarget.dataset.pdel; confirmOr(id, () => adm('delete-person', { id }, 'Personne retirée')); });
  on('#fQ', 'submit', e => { e.preventDefault(); adm('add-question', { themeId: qTheme, parentId: $('#qParent').value, label: $('#qLabel').value, text: $('#qText').value, kind: $('#qKind').value, urgent: $('#qUrg').checked, intensity: $('#qInt').checked }, 'Question ajoutée'); });
  on('#fD', 'submit', e => { e.preventDefault(); adm('add-followup', { themeId: qTheme, text: $('#dText').value }); });
  on('#fT', 'submit', async e => { e.preventDefault(); const typeId = $('#tGroup').value; const r = await adm('add-theme', { label: $('#tName').value, typeId, private: $('#tPriv').checked }, 'Thème créé'); if (r?.id) { qType = typeId; qTheme = r.id; render(); } });
  on('#fTy', 'submit', async e => { e.preventDefault(); const r = await adm('add-type', { name: $('#tyName').value }, 'Type créé : ajoute-lui un thème'); if (r?.id) { qType = r.id; render(); } });
  on('#fP', 'submit', e => { e.preventDefault(); adm('add-person', { name: $('#pName').value, role: $('#pRole').value, kind: $('#pKind').value }, 'Personne ajoutée'); });
  on('#savePlan', 'click', () => adm('save-plan', { plan: $('#plan').value }, 'Programme enregistré'));
  on('#reco', 'change', e => adm('save-settings', { ...S.settings, reco: e.target.checked }));
  on('#sens', 'input', e => { $('#sensV').textContent = Math.round(e.target.value * 100) + ' %'; });
  on('#sens', 'change', e => adm('save-settings', { ...S.settings, sens: +e.target.value }, 'Amplitude enregistrée'));

}

/* ================================================================ caméra (MediaPipe) */
const tracker = createHeadTracker({
  video: $('#vid'),
  getSensitivity: () => S?.settings.sens || 1,
  onStatus: msg => { $('#camMsg').textContent = msg; },
  onMeters: (p, y, r) => { $('#mP').style.width = Math.min(100, p * 100) + '%'; $('#mY').style.width = Math.min(100, y * 100) + '%'; $('#mR').style.width = Math.min(100, r * 100) + '%'; },
  onGesture: g => { $('#camLast').textContent = { oui: 'Oui', non: 'Non', parler: 'Parler' }[g]; answer(g); },
});
async function toggleCam() {
  if (tracker.running) { tracker.stop(); $('#cam').hidden = true; return renderTop(); }
  $('#cam').hidden = false;
  try { await tracker.start(); }
  catch (e) {
    tracker.stop(); $('#cam').hidden = true;
    toast(e?.name === 'NotAllowedError' ? 'Accès à la caméra refusé : autorise-le dans les réglages du navigateur.' : 'Caméra indisponible. Utilise les boutons ou les touches O / N / P.');
  }
  renderTop();
}
$('#recal').onclick = () => tracker.recalibrate();

/* ================================================================ démarrage */
async function boot() {

  try {
    await reload();
    if (adminPage && !S.isAdmin) { location.reload(); return; }
  } catch (e) {

    $('#main').innerHTML = `<div class="setup"><h1>Connexion impossible</h1><p>${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Réessayer</button></div>`;
    return;
  }
  document.title = `Parler avec ${name()}`;
  render();
  flush();
  setInterval(() => { const c = document.querySelector('.clock'); if (c) { const now = new Date(); c.textContent = now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + fmtT(now); } }, 30000);
}
boot();

addEventListener('storage', e => { if (e.key === 'anna-local-data-v1') reload().then(render).catch(x => toast(x.message)); });
