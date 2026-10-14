import { createHeadTracker } from './head-tracking.js';
import { createSharedApi } from './shared-data.js';
import { startHierarchy, startAtHierarchy, answerHierarchy, availableChildren, orderedNodes, findEntry, LEVEL_NAMES, LEVELS } from './hierarchy.js';
import { createBankEditor } from './bank-editor.js';
import { createPeopleEditor } from './people-editor.js';
import { createActivity } from './activity.js';
import { themeOrder, topQuestions } from './recommendations.js';

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

const GESTURES = 'Tête à gauche = oui · tête à droite = non · pencher 1 s = parler';

// Pictogramme de chaque question, déduit de son mot-clé (premier motif trouvé), sinon celui du thème.
const ICON_RULES = [
  [/ca va|contente|bien en ce moment|idees|rire/, 'content'], [/eau|boire|jus|boisson|gazeuse/, 'eau'],
  [/manger|collation|repas|sucre|sale|plat/, 'manger'], [/bouche|gorge/, 'bouche'], [/nausee|ventre/, 'nausee'],
  [/gauche/, 'gauche'], [/droit/, 'droite'], [/plus haut|remonter/, 'haut'], [/plus bas/, 'bas'], [/fauteuil/, 'fauteuil'],
  [/coussin/, 'coussin'], [/bras|main|jambe|pied/, 'bras'], [/demangeaison|gratte/, 'gratte'],
  [/drap|vetement|gilet|chaussette/, 'vetement'], [/froid|couverture/, 'froid'], [/chaud|linge frais/, 'journee'],
  [/fenetre|volet|aerer/, 'fenetre'], [/yeux/, 'yeux'], [/dents/, 'dents'], [/change/, 'change'],
  [/aspiration|mouchage|tousser/, 'vent'], [/toilette/, 'toilette'], [/coiffure/, 'coiffure'], [/poitrine/, 'emotions'],
  [/tete/, 'tete'], [/dos|position|dossier|point d.appui/, 'position'], [/fatigue|repos|sieste|reveil|dormi/, 'fatigue'],
  [/inquiet/, 'inquiet'], [/triste/, 'triste'], [/frustr|colere|pas d.accord/, 'colere'], [/solitude|seule/, 'seul'],
  [/peur/, 'peur'], [/reconfort|t.aime|manque/, 'emotions'], [/programme|rendez|visite|prochaine/, 'plan'],
  [/heure|combien de temps|attends/, 'horloge'], [/lumiere/, 'lumiere'], [/tele|ecran|culture|film/, 'tv'],
  [/musique|radio|livre audio|atelier/, 'activites'], [/volume|plus fort|moins fort/, 'voice'], [/couper|calme/, 'calme'],
  [/sortir|jardin|promenade|nature|ville/, 'arbre'], [/jeu|cartes|quiz/, 'jeu'], [/lecture|livre|raconte/, 'livre'],
  [/medecin|infirm|soignant|kine|ergo|psycho|ortho/, 'medecin'], [/materiel|sonnette|tablette/, 'materiel'],
  [/salle commune|compagnie|famille|rencontre/, 'personnes'], [/appeler/, 'tel'], [/message/, 'message'],
  [/photo|video|souvenir|enfance/, 'photo'], [/evenement|fete|anniversaire/, 'fete'], [/nouvelles|actualite|neuf|monde|france/, 'journal'],
  [/sport/, 'sport'], [/voyage|travail/, 'avion'], [/meteo/, 'meteo'], [/spiritu/, 'bougie'], [/argent|demarche/, 'argent'],
  [/prive|intimite|seule/, 'porte'], [/sante|soins/, 'soin'], [/bonjour|au revoir/, 'bras'], [/merci|raison/, 'ok'],
  [/pas maintenant/, 'nok'], [/question|autre/, 'question'],
];
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function itemIcon(it, t) {
  const l = norm(it.l);
  for (const [re, icon] of ICON_RULES) if (re.test(l)) return icon;
  return t ? iconFor(t) : 'question';
}

/* ================================================================ stockage local des préférences */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
const K_VOICE = 'anna-voice';

// L’admin conserve la protection HTTP Basic du serveur Python.
const api = createSharedApi({
  storage: localStorage,
  admin: adminPage,
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

/* ================================================================ état */
let S = null;          // données de la personne (banque, personnes et réglages)
let F = { mode: 'home' }, undo = [], view = adminPage ? 'admin' : 'patient', cat = '__rapide';
let voice = store.get(K_VOICE, false), mood = null, topCache = [];
let usageRevision = null, sharedStats = {}, sharedHistory = [], sharedAnswers = [], activityError = '';
const parisHour = () => Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const activity = createActivity({ storage: localStorage, onPending: () => renderSync() });
setInterval(() => activity.flush().catch(() => {}), 15000);
addEventListener('online', () => activity.flush().catch(() => {}));

async function reload() {
  const [data] = await Promise.all([api('GET', '/api/data?action=bootstrap'), loadActivity()]);
  S = { ...data, stats: sharedStats, history: sharedHistory, answers: sharedAnswers };
}

async function loadActivity() {
  try {
    const usage = await fetch('/api/usage', { cache: 'no-store', headers: usageRevision ? { 'If-None-Match': usageRevision } : {} });
    if (usage.status !== 304) {
      if (!usage.ok) throw new Error();
      sharedStats = (await usage.json()).stats; usageRevision = usage.headers.get('ETag');
    }
    if (adminPage) {
      const response = await fetch('/api/history', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error();
      const data = await response.json(); sharedHistory = data.history; sharedAnswers = data.answers;
    }
    activityError = '';
  } catch { activityError = 'Historique et statistiques temporairement indisponibles.'; }
  if (S) Object.assign(S, { stats: sharedStats, history: sharedHistory, answers: sharedAnswers });
}

/* ================================================================ utilitaires */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = id => `<svg class="i"><use href="#i-${id}"/></svg>`;
const theme = id => S.themes.find(t => t.id === id);
const hue = s => [...String(s)].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
const typeOf = id => S.types.find(t => t.id === id) || { id, name: id, short: id, icon: 'autre', h: hue(id) };
const iconFor = t => {
  const icons = { douleur: 'douleur', position: 'position', gene: 'hygiene', manger: 'manger', boire: 'eau', repos: 'fatigue', ennui: 'jeu', contacter: 'tel', raconter: 'message', savoir: 'question' };
  const icon = icons[norm(t.label)] || t.icon;
  return document.getElementById('i-' + icon) ? icon : 'autre';
};
const fmtT = ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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

const ordered = list => list;
const peopleOf = t => S.people.filter(p => t.peopleKinds.includes(p.kind));
function themeItems(t) {
  if (!t.dynamic) return ordered(t.items);
  const ppl = peopleOf(t).map(p => ({
    id: `${t.id}.${p.id}`, l: p.name, q: `C’est à propos de ${p.name}${p.role ? ` (${p.role})` : ''} ?`,
    then: PERSON_FOLLOW.map(([l, q, a]) => ({ id: `${t.id}.${p.id}.${l.toLowerCase().replace(/[^a-z]+/g, '-')}`, l, q: q.replace('{n}', p.name), action: a })),
  }));
  return [...ordered(ppl), ...t.items];
}

function logAnswer(questionId, question, answer, conversationId, themeId = 'accueil', since = Date.now()) {
  const ms = Math.min(86400000, Math.max(0, Date.now() - since));
  activity.enqueue({ kind: 'answer', conversationId, questionId, question, answer, theme: themeId, ms });
  const x = S.stats[questionId] ||= { a: 0, y: 0, n: 0, rt: 0, hours: {} };
  x.a++; x[answer === 'oui' ? 'y' : 'n']++; x.rt += ms;
  if (answer === 'oui') { const h = parisHour(); x.hours[h] = (x.hours[h] || 0) + 1; }
}
function recordConversation(result, { conversationId = F.id || crypto.randomUUID(), themeId = F.theme || 'accueil', path = F.path || [], text = F.summaryText || path.at(-1) || '', nodeId = F.hierarchy?.current?.id || null } = {}) {
  activity.enqueue({ kind: 'conversation', conversationId, theme: themeId, path: path.slice(0, 30).map(p => String(p).slice(0, 600)), text: text.slice(0, 2000), nodeId, result, n: F.n || 0, dur: Math.min(86400000, Math.max(0, Date.now() - (F.t0 || Date.now()))) });
}
const INTRO = ['hello', 'welcome', 'rest'];
const MOOD = {
  ko: { note: 'Ça ne va pas : on commence par la douleur et le confort.' },
  ok: { note: 'Ça va : envie d’échanger ou de faire quelque chose ?' },
};
const moodAnswer = () => mood === 'ok' ? 'oui' : mood === 'ko' ? 'non' : null;
function themesInOrder() { return themeOrder(S.bank, moodAnswer(), S.settings.context).map(theme).filter(Boolean); }
function top3() {
  return topQuestions(S.bank, S.stats, { answer: moodAnswer(), context: S.settings.context, hour: parisHour() })
    .map(o => ({ kind: 'item', t: theme(o.themeId), it: { id: o.nodeId, l: o.label, q: o.q } }));
}
function showHello() { F = { mode: 'hello', id: crypto.randomUUID(), t0: Date.now() }; undo = []; render(); speak('Coucou, est-ce que tu veux parler ?'); }
function showWelcome() { F = { mode: 'welcome', id: crypto.randomUUID(), t0: Date.now() }; undo = []; render(); speak(S.bank.root.q); }
function startItem(themeId, id) { startBank(id); }
function personItem(t, p) { return { id: `${t.id}.${p.id}`, l: p.name, q: `C’est à propos de ${p.name} ?`, person: p.id }; }

/* ================================================================ déroulé des questions */
const cur = () => { const top = F.stack[F.stack.length - 1]; return top.list[top.idx]; };
function goHome() { F = { mode: 'home' }; undo = []; render(); }
function startTheme(id, pre) {
  if (S.bank) return startBank(id);
  const t = theme(id); if (!t) return;
  const list = themeItems(t);
  if (!list.length) { toast(`« ${t.label} » n’a pas encore de questions : ajoute-les dans l’espace admin.`); return goHome(); }
  F = { mode: 'q', theme: id, stack: [{ list, idx: 0 }], path: [t.label], priv: !!t.private, urgent: false };
  undo = [];
  if (pre) { const it = F.stack[0].list.find(x => x.id === pre); if (it) { F.path.push(it.l); F.stack.push({ list: ordered(it.then), idx: 0 }); } }
  showQ();
}
function startScan() {
  if (S.bank) return startBank();
  const list = S.themes.filter(t => themeItems(t).length).map(t => ({ id: 'scan.' + t.id, l: t.label, q: `C’est à propos de : ${t.label} ?`, goto: t.id }));
  F = { mode: 'q', theme: 'scan', stack: [{ list, idx: 0 }], path: ['Choix du thème'], priv: false };
  undo = []; showQ();
}
function showPlan() { F = { mode: 'done', theme: 'journee', path: ['Ma journée', 'Programme du jour'], result: 'resolu', action: 'planning', entryNotes: [], priv: false, quick: true }; render(); speak('Voici le programme de ta journée.'); }
function showQ() { render(); speak(cur().q); }

function answer(a) {
  if (view !== 'patient' || F.mode === 'home') return;
  if (INTRO.includes(F.mode) && a !== 'parler') {
    flash(a); sayAnswer(a);
    if (F.mode === 'rest') { if (a === 'oui') showHello(); return; }
    const hello = F.mode === 'hello', q = hello ? 'Coucou, est-ce que tu veux parler ?' : S.bank.root.q;
    logAnswer(hello ? 'intro:hello' : S.bank.root.id, q, a, F.id, 'accueil', F.t0);
    recordConversation('intro', { themeId: 'accueil', path: [q, a === 'oui' ? 'Oui' : 'Non'], text: `${q} ${a === 'oui' ? 'Oui' : 'Non'}` });
    if (hello) { if (a === 'oui') return showWelcome(); F = { mode: 'rest' }; return render(); }
    mood = a === 'oui' ? 'ok' : 'ko'; boardPage = 0; boardTheme = null; return goHome();
  }
  flash(a);
  if ($('#ovRoot').firstChild) { if (a === 'parler') return; closeOv(); }
  if (a === 'parler') return talk();
  if (view !== 'patient') return;
  sayAnswer(a);
  if (F.mode === 'hierarchy') return answerBank(a);
  if (F.mode === 'home') { if (a === 'oui') startScan(); return; }
  if (F.mode === 'spell') return spellAnswer(a);
  if (F.mode === 'deeper') {
    F.entryNotes.push([F.dq, a]);
    F.mode = 'done'; render(); return;
  }
  if (F.mode === 'done' && F.hierarchy) { if (a === 'oui') startBank(); else goHome(); return; }
  if (F.mode === 'done') { if (a === 'oui') { (F.theme === 'scan' || F.theme === 'parler' || F.quick) ? startScan() : startTheme(F.theme); } else goHome(); return; }
  if (F.mode !== 'q') return;
  undo.push(JSON.stringify(F));
  const it = cur();
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
function conclude(result, it) {
  Object.assign(F, { mode: 'done', result, action: it?.action, ask: it?.ask, say: it?.say, entryNotes: [] });
  if (!F.priv) recordConversation(result);
  render();
  if (F.ask) return speak(F.ask, true);
  speak(F.summaryText || ((result === 'non-trouve' ? 'Je n’ai pas trouvé. Tu veux épeler ?' : 'Compris : ' + F.path.slice(1).join(', ') + '.') + ' Autre chose ?'));
  if (F.urgent) chime();
}
function back() {
  if (F.hierarchy) { const previous = undo.pop(); if (!previous) return goHome(); F = JSON.parse(previous); F.qTs = Date.now(); render(); speak(F.hierarchy.current.q); return; }
  if (F.mode === 'spell' || F.mode === 'home') return goHome();
  if (F.mode === 'deeper') { F.mode = 'done'; return render(); }
  const s = undo.pop(); if (!s) return goHome();
  F = JSON.parse(s); showQ();
}

/* Parcours des cinq niveaux de la banque CSV. */
function startBank(targetId = null) {
  const answer = moodAnswer(), context = S.settings.context;
  if (!targetId && answer) targetId = availableChildren(S.bank.root, answer, context)[0]?.id;
  const hierarchy = targetId ? startAtHierarchy(S.bank, targetId, { context, answer }) : startHierarchy(S.bank, { context });
  F = { mode: 'hierarchy', hierarchy, theme: 'scan', path: hierarchy.path.map(n => n.label), priv: false,
    id: crypto.randomUUID(), t0: Date.now(), qTs: Date.now(), n: 0 };
  undo = [];
  render(); speak(F.hierarchy.current.q);
}
function answerBank(answer) {
  undo.push(JSON.stringify(F));
  const node = F.hierarchy.current, entry = findEntry(S.bank, node.id);
  const themeId = [entry?.node, ...(entry?.path || [])].find(n => n?.level === 'subcategory')?.id || node.id;
  logAnswer(node.id, node.q, answer, F.id, themeId, F.qTs); F.n++;
  F.hierarchy = answerHierarchy(S.bank, F.hierarchy, answer);
  const chosen = F.hierarchy.path;
  F.path = chosen.map(n => n.level === 'master' ? `${n.q} ${n.response === 'oui' ? 'Oui' : 'Non'}` : n.label);
  F.theme = chosen.find(n => n.level === 'subcategory')?.id || chosen.find(n => n.level === 'category')?.id || 'scan';
  if (F.hierarchy.done) {
    F.summaryText = F.hierarchy.result.text;
    return conclude(F.hierarchy.result.found ? 'resolu' : 'non-trouve');
  }
  F.qTs = Date.now(); render(); speak(F.hierarchy.current.q);
}
function renderBankQuestion() {
  const flow = F.hierarchy, node = flow.current, frame = flow.frames.at(-1);
  return `<div class="qv">${crumbs()}<span class="pill">${LEVEL_NAMES[LEVELS.indexOf(node.level)]}</span>
    <h1 class="q" tabindex="-1">${esc(node.q)}</h1>
    <div class="qmeta"><span>${frame ? `${frame.index + 1} / ${frame.nodes.length}` : 'Question de départ'}</span><span>${GESTURES}</span></div></div>`;
}

/* épellation lettre par lettre */
function startSpell(ctx) { F = { mode: 'spell', ctx: ctx || ['Message'], g: 0, l: null, text: '', priv: !!F.priv, theme: (F.theme && F.theme !== 'scan') ? F.theme : 'parler', id: crypto.randomUUID(), t0: Date.now() }; render(); speak('On épelle. ' + spellQ()); }
const spellQ = () => F.l === null ? `Lettre dans : ${GROUPS[F.g].join(' ')} ?` : `« ${GROUPS[F.g][F.l]} » ?`;
function spellPick(g, l) {
  const v = GROUPS[g][l];
  if (v === 'ESPACE') F.text += ' ';
  else if (v === 'EFFACER') F.text = F.text.slice(0, -1);
  else if (v === 'ANNULER') return goHome();
  else if (v === 'TERMINER') {
    if (!F.text.trim()) return goHome();
    const conversationId = F.id, t0 = F.t0;
    const path = [...F.ctx, F.text.trim()], th = F.theme, priv = F.priv, isAsk = th === 'interaction' || th === 'dire';
    F = { mode: 'done', theme: th, path, result: 'message', entryNotes: [], priv, ask: isAsk ? path[path.length - 1] : undefined, say: th === 'dire', id: conversationId, t0 };
    if (!priv) recordConversation('message', { text: path.at(-1) });
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
  if (!F.priv) recordConversation('parole', { conversationId: crypto.randomUUID(), themeId: 'parler', path: ['Demande de parole'], text: `${name()} veut parler` });
  chime(); speak(`${name()} veut parler`);
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
  $('#bar').hidden = view !== 'patient' || F.mode === 'home' || INTRO.includes(F.mode);
  m.classList.toggle('board-mode', view === 'patient' && F.mode === 'home');
  if (view === 'admin') { m.innerHTML = renderAdmin(); bindAdmin(); return; }
  m.innerHTML = F.mode === 'hello' ? renderHello() : F.mode === 'rest' ? renderRest() : F.mode === 'welcome' ? renderWelcome() : F.mode === 'hierarchy' ? renderBankQuestion() : F.mode === 'home' ? renderBoard() : F.mode === 'q' ? renderQ() : F.mode === 'done' ? renderDone() : F.mode === 'deeper' ? renderDeeper() : renderSpell();
  m.scrollTop = 0;
}
function renderTop() {
  const now = new Date(), nav = view === 'patient' && F.mode !== 'home';
  $('#top').innerHTML = `
    <div class="who"><b>${esc(name())}</b><span id="sync"></span><span class="clock">${now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtT(now)}</span></div>
    ${nav && !INTRO.includes(F.mode) ? `<button class="ib nav-b" id="tBack" aria-label="Retour">${ic('back')}<span class="lb">Retour</span></button>` : ''}
    ${view === 'patient' && F.mode !== 'hello' ? `<button class="ib nav-b" id="tHome" aria-label="Accueil">${ic('home')}<span class="lb">Accueil</span></button>` : ''}
    <button class="ib ${tracker.running ? 'on' : ''}" id="tCam" aria-label="Caméra" title="${GESTURES}">${ic('cam')}<span class="lb">${tracker.running ? 'Tête active' : 'Caméra'}</span></button>
    <button class="ib ${voice ? 'on' : ''}" id="tVoice" aria-label="Voix" title="Lire les questions à voix haute">${ic('voice')}<span class="lb">Voix</span></button>
    <button class="ib ${view === 'admin' ? 'on' : ''}" id="tView" aria-label="${view === 'admin' ? 'Retour à la vue patient' : 'Espace admin'}">${view === 'admin' ? ic('home') : ic('gear')}<span class="lb">${view === 'admin' ? 'Vue ' + esc(name()) : 'Admin'}</span></button>`;
  $('#tBack')?.addEventListener('click', back);
  $('#tHome')?.addEventListener('click', () => { boardTheme = null; boardPage = 0; showHello(); });
  $('#tCam').onclick = toggleCam;
  $('#tVoice').onclick = () => { voice = !voice; store.set(K_VOICE, voice); renderTop(); if (voice) speak('Lecture à voix haute activée'); };
  $('#tView').onclick = () => view === 'admin' ? leaveAdmin() : openAdmin();
  renderSync();
}
function renderSync() {
  const el = $('#sync'); if (el) el.innerHTML = activity.count() ? `<span class="sync" role="status">${activity.count()} en attente</span>` : '';
}
// Accueil pensé pour le téléphone, sans surcharge et sans défilement :
// une ligne par thème = le thème, ses 3 pictogrammes les plus importants (moteur de recommandation)
// et « + » pour le reste. Autant de lignes que l'écran en permet, puis Page suivante / Page précédente.
let boardPage = 0, boardTheme = null, themePage = 0;
const pic = (attrs, icon, label, h, extra = '') => `<button class="pic ${extra}" style="--h:${h}" ${attrs}>${icon}<span>${esc(label)}</span></button>`;
const pager = (page, pages, prev, next) => pages > 1 ? `<nav class="pager" aria-label="Pages">
    <button class="btn" data-act="${prev}" ${page === 0 ? 'disabled' : ''}>${ic('gauche')} Précédente</button>
    <span>Page ${page + 1} / ${pages}</span>
    <button class="btn" data-act="${next}" ${page >= pages - 1 ? 'disabled' : ''}>Suivante ${ic('droite')}</button></nav>` : '';
// Pictogrammes d'un thème, les plus importants d'abord : personnes (thèmes Proches / Personnes) puis questions.
function themePics(t, h) {
  const people = t.dynamic ? ordered(peopleOf(t).map(p => personItem(t, p))).map(it => { const p = S.people.find(x => x.id === it.person); return pic(`data-person="${esc(p.id)}"`, avatar(p), p.name, h); }) : [];
  const items = ordered(t.items).map(it => pic(`data-item="${esc(it.id)}" data-th="${esc(t.id)}"`, ic(itemIcon(it, t)), it.l, h, it.urgent ? 'urg' : ''));
  return [...people, ...items];
}
function boardSpace() { return Math.max(160, ($('#main')?.clientHeight || 600) - 24); }
function renderBoard() {
  if (boardTheme && theme(boardTheme)) return renderThemePage();
  boardTheme = null;
  const avail = boardSpace(), rowH = avail > 700 ? 124 : 104;   // lignes hautes : lisibles par la personne qui tient le téléphone
  const note = MOOD[mood]?.note && boardPage === 0 ? `<p class="moodnote ${mood}">${ic(mood === 'ko' ? 'douleur' : 'content')} ${esc(MOOD[mood].note)}</p>` : '';
  const perPage = Math.max(1, Math.floor((avail - 64 - (MOOD[mood]?.note ? 40 : 0)) / rowH));   // Réserver le même espace sur toutes les pages.
  topCache = top3();
  const topRow = `<div class="trow toprow" style="--h:40"><div class="tlab">${ic('star')}<span>Top 3</span></div>${topCache.map((o, i) => {
    if (o.kind === 'sugg') {
      // Libellé court et lisible : le dernier mot-clé (« Côté gauche »), ou « Dos · Forte » pour une intensité.
      const t = theme(o.sg.theme), p = o.sg.path, leaf = p[p.length - 1];
      const label = INTENS.some(x => x.l === leaf) && p.length > 2 ? `${p[p.length - 2]} · ${leaf}` : leaf;
      return pic(`data-top="${i}"`, ic(itemIcon({ l: leaf }, t)), label, typeOf(t.group).h, 'hot');
    }
    return pic(`data-top="${i}"`, ic(itemIcon(o.it, o.t)), o.it.l, typeOf(o.t.group).h, 'hot');
  }).join('')}${pic('data-act="scan"', ic('scan'), 'Tout parcourir', 40)}</div>`;
  const rows = [topRow, ...themesInOrder().map(t => {
    const h = typeOf(t.group).h, all = themePics(t, h);
    const more = all.length > 3 ? pic(`data-act="openTheme" data-th="${esc(t.id)}"`, `<b class="plus">+${all.length - 3}</b>`, 'Voir plus', h, 'more') : '<span></span>';
    return `<div class="trow" style="--h:${h}">
      <button class="tlab" data-act="openTheme" data-th="${esc(t.id)}">${ic(iconFor(t))}<span>${esc(t.label)}</span></button>
      ${all.slice(0, 3).join('')}${'<span></span>'.repeat(Math.max(0, 3 - all.length))}${more}</div>`;
  }), `<div class="trow" style="--h:40"><div class="tlab">${ic('spell')}<span>Autres</span></div>${pic('data-act="spell"', ic('spell'), 'Épeler', 40)}${pic('data-act="plan"', ic('plan'), 'Ma journée', 95)}${pic('data-act="scan"', ic('scan'), 'Tout parcourir', 40)}<span></span></div>`];
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  boardPage = Math.min(boardPage, pages - 1);
  const shown = rows.slice(boardPage * perPage, (boardPage + 1) * perPage);
  return `<div class="page">${note}<div class="prows" style="grid-template-rows:repeat(${perPage},minmax(0,1fr))">${shown.join('')}</div>${pager(boardPage, pages, 'prevPage', 'nextPage')}</div>`;
}
// Tout premier écran : « Coucou, est-ce que tu veux parler ? » en oui / non.
function renderHello() {
  return `<div class="welcome">
    <p class="tag">${esc(name())}</p>
    <h1 class="q hello">Coucou, est-ce que tu veux parler ?</h1>
    <p class="muted">${GESTURES}</p>
    <div class="wbtns">
      <button class="wb no" data-act="hNon">${ic('calme')}<span>Non, pas maintenant</span></button>
      <button class="wb yes" data-act="hOui">${ic('talk')}<span>Oui, je veux parler</span></button>
    </div>
    <button class="btn" data-act="wSkip">Passer, voir les thèmes ${ic('droite')}</button>
  </div>`;
}
// Si Anna ne veut pas parler : écran calme, on reprend quand elle le souhaite (bouton ou « oui » de la tête).
function renderRest() {
  return `<div class="welcome">
    <h1 class="q hello">D’accord, pas maintenant.</h1>
    <p class="muted" style="font-size:16px">On reste là. Touche « Reprendre » ou fais oui de la tête quand tu veux.</p>
    <button class="btn primary" data-act="hello" style="font-size:18px;padding:14px 22px">${ic('talk')} Reprendre</button>
  </div>`;
}
// Écran d'ouverture : « Ça va ? » en oui / non (boutons, clavier ou tête), avant les thèmes.
function renderWelcome() {
  return `<div class="welcome">
    <p class="tag">${esc(name())}</p>
    <h1 class="q">${esc(S.bank.root.q)}</h1>
    <p class="muted">${GESTURES}</p>
    <div class="wbtns">
      <button class="wb no" data-act="wNon">${ic('triste')}<span>Non, ça ne va pas</span></button>
      <button class="wb yes" data-act="wOui">${ic('content')}<span>Oui, ça va</span></button>
    </div>
    <button class="btn" data-act="wSkip">Passer, voir les thèmes ${ic('droite')}</button>
  </div>`;
}
// Page d'un thème : tous ses pictogrammes, en pages si besoin.
function renderThemePage() {
  const t = theme(boardTheme), h = typeOf(t.group).h, all = themePics(t, h);
  const avail = boardSpace(), w = $('#main')?.clientWidth || 360;
  const cols = w >= 900 ? 5 : w >= 560 ? 4 : 3, rows = Math.max(1, Math.floor((avail - 64 - 56) / (avail > 700 ? 130 : 112)));
  const per = cols * rows, pages = Math.max(1, Math.ceil(all.length / per));
  themePage = Math.min(themePage, pages - 1);
  return `<div class="page">
    <div class="phead" style="--h:${h}"><button class="btn" data-act="closeTheme">${ic('back')} Thèmes</button><h2>${ic(iconFor(t))} ${esc(t.label)}</h2>
      <button class="btn sm" data-act="themeScan" data-th="${esc(t.id)}">${ic('scan')} Oui / non</button></div>
    ${t.private ? `<span class="lockn">${ic('intime')} Rien n’est enregistré</span>` : ''}
    ${all.length ? `<div class="pgrid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr))">${all.slice(themePage * per, (themePage + 1) * per).join('')}</div>`
      : '<p class="empty">Pas encore de questions dans ce thème. Ajoute-les dans l’espace admin, onglet « Questions ».</p>'}
    ${pager(themePage, pages, 'prevTheme', 'nextTheme')}</div>`;
}
addEventListener('resize', () => { if (view === 'patient' && F.mode === 'home' && S) render(); });
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
  const title = F.summaryText || (F.result === 'non-trouve' ? 'Besoin non trouvé' : F.result === 'message' ? '« ' + F.path[F.path.length - 1] + ' »' : (F.path.slice(1).join(' › ') || F.path[0]));
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
      <span class="muted" style="font-size:13.5px">${F.hierarchy ? 'Oui : recommencer · Non : pictogrammes' : 'Oui : continuer dans ce thème · Non : accueil'}</span>
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
  if ((b = g('[data-item]'))) return startItem(b.dataset.th, b.dataset.item);
  if ((b = g('[data-top]'))) { const o = topCache[+b.dataset.top]; if (o) startItem(o.t.id, o.it.id); return; }
  if ((b = g('[data-cat]'))) { cat = b.dataset.cat; return render(); }
  if ((b = g('[data-category]'))) return startBank(b.dataset.category);
  if ((b = g('[data-theme]'))) return startTheme(b.dataset.theme);
  if ((b = g('[data-person]'))) { const p = S.people.find(x => x.id === b.dataset.person), th = personTheme(p); return startTheme(th, `${th}.${p.id}`); }
  if ((b = g('[data-deep]'))) { F.dq = deeperList()[+b.dataset.deep]; F.mode = 'deeper'; render(); speak(F.dq); return; }
  if ((b = g('[data-pick]'))) { const [x, y] = b.dataset.pick.split(',').map(Number); return spellPick(x, y); }
  if ((b = g('[data-act]'))) {
    const a = b.dataset.act;
    if (a === 'hOui' || a === 'wOui') return answer('oui');
    if (a === 'hNon' || a === 'wNon') return answer('non');
    if (a === 'hello') return showHello();
    if (a === 'wSkip') { boardPage = 0; boardTheme = null; return goHome(); }
    if (a === 'openTheme') { boardTheme = b.dataset.th; themePage = 0; return render(); }
    if (a === 'closeTheme') { boardTheme = null; return render(); }
    if (a === 'nextPage') { boardPage++; return render(); }
    if (a === 'prevPage') { boardPage = Math.max(0, boardPage - 1); return render(); }
    if (a === 'nextTheme') { themePage++; return render(); }
    if (a === 'prevTheme') { themePage = Math.max(0, themePage - 1); return render(); }
    if (a === 'themeScan') return startTheme(b.dataset.th);
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
let tab = 'questions', armed = '', histF = '';

function openAdmin() { location.assign('/admin'); }
function leaveAdmin() { location.assign('/parler'); }
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


function renderAdmin() {
  return `<div class="adm"><p class="muted local-notice">Questions partagées avec tous les utilisateurs.</p>
    <div class="seg" role="tablist">${[['resume', 'Résumé'], ['questions', 'Questions'], ['personnes', 'Personnes'], ['reglages', 'Réglages']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}" class="${tab === k ? 'cur' : ''}">${l}</button>`).join('')}</div>
    ${tab === 'resume' ? admResume() : tab === 'questions' ? admQuestions() : tab === 'personnes' ? peopleEditor.render() : admSettings()}
  </div>`;
}
function admResume() {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const history = S.history || [], today = history.filter(e => e.at >= day.getTime());
  const list = history.filter(e => !histF || e.theme === histF);
  const labels = { resolu: 'Compris', 'non-trouve': 'Non trouvé', parole: 'Veut parler', message: 'Message', intro: 'Ouverture' };
  const count = result => today.filter(e => e.result === result).length;
  return `${activityError ? `<p class="err" role="alert">${esc(activityError)}</p>` : ''}
    <div class="stats">
      <div class="stat"><span class="n">${today.length}</span><span class="l">échanges aujourd’hui</span></div>
      <div class="stat"><span class="n">${count('resolu')}</span><span class="l">besoins exprimés</span></div>
      <div class="stat"><span class="n">${count('non-trouve')}</span><span class="l">besoins non trouvés</span></div>
      <div class="stat"><span class="n">${count('parole')}</span><span class="l">demandes de parole</span></div>
    </div>
    <div class="card"><div class="history-head"><h3>Historique</h3><button class="btn sm" id="refreshHistory">Actualiser</button></div>
      <label class="fl">Filtrer l’historique<select id="histF">${[['', 'Tout'], ['accueil', 'Ouverture'], ...S.themes.map(t => [t.id, t.label]), ['parler', 'Parole']].map(([v, label]) => `<option value="${esc(v)}" ${histF === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
      <ul class="rows">${list.map(e => {
        const answers = (S.answers || []).filter(a => a.conversationId === e.conversationId);
        return `<li class="history-entry"><time>${esc(new Date(e.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }))}<br>${fmtT(e.at)}</time><div class="t"><b>${esc(e.text || e.path.join(' › '))}</b><small>${esc(e.path.join(' › '))}</small></div>
          <span class="pill ${e.result === 'non-trouve' ? 'ko' : e.result === 'parole' ? 't' : 'ok'}">${labels[e.result] || esc(e.result)}</span>
          ${answers.length ? `<details class="history-detail"><summary>Voir les réponses</summary><ol>${answers.map(a => `<li>${esc(a.question)} <b>${a.answer === 'oui' ? 'Oui' : 'Non'}</b></li>`).join('')}</ol></details>` : ''}</li>`;
      }).join('') || '<li class="muted">Aucun échange pour l’instant.</li>'}</ul>
      <p class="muted" style="font-size:13px">Historique partagé, réservé à l’admin. Les 300 derniers échanges sont conservés.</p></div>`;
}
const bankEditor = createBankEditor({ getBank: () => S.bank, getPeople: () => S.people, mutate: adm, rerender: render });
const peopleEditor = createPeopleEditor({ getBank: () => S.bank, getPeople: () => S.people, mutate: adm, rerender: render });
function admQuestions() { return bankEditor.render(); }
function admSettings() {
  return `    <div class="card"><h3>Programme du jour</h3>
      <textarea id="plan" aria-label="Programme du jour" maxlength="4000">${esc(S.plan)}</textarea>
      <div style="margin-top:8px;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span class="muted" style="font-size:13px">Une ligne par moment : HH:MM activité</span><button class="btn primary" id="savePlan">Enregistrer</button></div></div>
    <div class="card"><h3>Options</h3>
      <div class="fgrid">
        <label class="fl">Lieu de la conversation<select id="context">${[['tous', 'Tous les lieux'], ['centre', 'Au centre'], ['domicile', 'Au domicile']].map(([v, label]) => `<option value="${v}" ${S.settings.context === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p class="muted">Les questions suivent l’ordre défini dans la banque.</p>
        <label class="fl">Amplitude du mouvement de tête : <b id="sensV">${Math.round(S.settings.sens * 100)} %</b><input type="range" id="sens" min="0.5" max="1.6" step="0.05" value="${S.settings.sens}"></label>
      </div></div>
    <div class="card"><h3>Données</h3>
      <p class="muted" style="margin:0">Les questions et réglages sont partagés entre tous les appareils. L’utilisation alimente le Top 3. L’historique détaillé est réservé à l’admin.</p>
      <p style="margin:12px 0 0"><a href="/static/anna-qr-code.png" target="_blank" rel="noopener">QR code de la page publique</a></p></div>`;
}
function bindAdmin() {
  const m = $('#main'), on = (sel, ev, fn) => m.querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));
  if (tab === 'questions') bankEditor.bind(m);
  if (tab === 'personnes') peopleEditor.bind(m);
  const confirmOr = (id, fn) => { if (armed !== id) { armed = id; return render(); } fn(); };
  on('[data-tab]', 'click', async e => { tab = e.currentTarget.dataset.tab; armed = ''; render(); if (tab === 'resume') { await loadActivity(); if (tab === 'resume') render(); } });
  on('#histF', 'change', e => { histF = e.target.value; render(); });
  on('#refreshHistory', 'click', async e => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Actualisation…'; await loadActivity(); if (tab === 'resume') render(); });
  on('[data-pdel]', 'click', e => { const id = e.currentTarget.dataset.pdel; confirmOr(id, () => adm('delete-person', { id }, 'Personne retirée')); });
  on('#fP', 'submit', e => { e.preventDefault(); adm('add-person', { name: $('#pName').value, role: $('#pRole').value, kind: $('#pKind').value }, 'Personne ajoutée'); });
  on('#savePlan', 'click', () => adm('save-plan', { plan: $('#plan').value }, 'Programme enregistré'));
  on('#context', 'change', e => adm('save-settings', { ...S.settings, context: e.target.value }, 'Lieu enregistré'));
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
  if (!adminPage) showHello(); else render();
  activity.flush().catch(() => {});
  setInterval(() => { const c = document.querySelector('.clock'); if (c) { const now = new Date(); c.textContent = now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + fmtT(now); } }, 30000);
}
boot();

let refreshing = false;
async function refreshSharedQuestions() {
  if (adminPage || !S || document.hidden || refreshing) return;
  refreshing = true;
  const bankBefore = JSON.stringify(S?.bank), contextBefore = S?.settings.context, statsBefore = JSON.stringify(S?.stats);
  try {
    await reload();
    const changed = bankBefore !== JSON.stringify(S.bank) || contextBefore !== S.settings.context;
    if (changed && view === 'patient' && F.mode === 'hierarchy') { startBank(); toast('Questions mises à jour. Le parcours reprend au départ.'); }
    else if (changed || (F.mode === 'home' && statsBefore !== JSON.stringify(S.stats))) render();
  } catch { /* Garder le parcours en cours et réessayer à la prochaine actualisation. */ }
  finally { refreshing = false; }
}
setInterval(refreshSharedQuestions, 15000);
addEventListener('focus', refreshSharedQuestions);
document.addEventListener('visibilitychange', refreshSharedQuestions);
