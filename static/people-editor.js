import { entries } from './hierarchy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FLAGS = [['groupClose', 'Proches'], ['groupCare', 'Soins à domicile'], ['groupCentre', 'Centre'], ['canContact', 'Contacter'], ['canSee', 'Voir'], ['canTalk', 'Parler'], ['referent', 'Référent']];

export function createPeopleEditor({ getPeople, getBank, mutate, rerender }) {
  let editing = null, adding = false, search = '', group = '', saving = false, armed = null;
  function busy(root, value) {
    saving = value;
    const form = root.querySelector('#person-form');
    if (!form) return;
    form.setAttribute('aria-busy', String(value));
    form.querySelectorAll('input,select,button').forEach(el => { el.disabled = value; });
    form.querySelector('[type="submit"]').textContent = value ? 'Enregistrement en cours…' : 'Enregistrer';
    root.querySelector('#person-status').textContent = value ? 'Enregistrement en cours…' : '';
    root.querySelectorAll('[data-person-edit], [data-person-delete], #person-add').forEach(el => { el.disabled = value; });
  }
  function form() {
    const p = getPeople().find(p => p.id === editing) || { weight: 1, groupClose: true, canContact: true, canSee: true, canTalk: true };
    const input = (label, key, max = 100) => `<label class="fl">${label}<input type="text" name="${key}" value="${esc(p[key] || '')}" maxlength="${max}"></label>`;
    return `<div class="card"><h3>${editing ? 'Modifier la personne' : 'Ajouter une personne'}</h3><form id="person-form" class="fgrid c2">
      <label class="fl">Nom d’usage<input name="name" type="text" value="${esc(p.name || '')}" required maxlength="60"></label>
      <label class="fl">Genre<select name="gender"><option value="">Non renseigné</option><option value="F" ${p.gender === 'F' ? 'selected' : ''}>Femme</option><option value="H" ${p.gender === 'H' ? 'selected' : ''}>Homme</option></select></label>
      ${input('Rôle', 'role', 80)}${input('Précision', 'precision', 150)}
      <label class="fl">Poids<input name="weight" type="number" min="0" step="any" value="${p.weight ?? 1}"></label>
      ${input('Jours (vide = tous, sinon weekend, semaine, lundi…)', 'days', 120)}
      ${FLAGS.map(([key, label]) => `<label class="ck"><input type="checkbox" name="${key}" ${p[key] ? 'checked' : ''}> ${label}</label>`).join('')}
      <div class="row"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" id="person-cancel">Annuler</button></div>
    </form><span id="person-status" class="sr-only" role="status"></span><p class="muted">Les autorisations et les jours filtrent les questions liées à cette personne. Les liens se modifient dans l’onglet Questions.</p></div>`;
  }
  return {
    render() {
      const people = getPeople(), bankEntries = entries(getBank());
      const list = people.filter(p => (!group || p[group]) && `${p.name} ${p.role} ${p.precision || ''}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')));
      return `<div class="bank-toolbar"><label class="fl">Chercher une personne<input type="search" id="person-search" value="${esc(search)}"></label><button class="btn primary" id="person-add">Ajouter une personne</button></div>
        <label class="fl">Groupe<select id="person-group">${[['', 'Tous'], ['groupClose', 'Proches'], ['groupCare', 'Soins à domicile'], ['groupCentre', 'Centre'], ['referent', 'Référents']].map(([key, label]) => `<option value="${key}" ${group === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <p class="muted">${list.length} personne(s) sur ${people.length}</p>${editing || adding ? form() : ''}
        <div class="card"><ul class="rows">${list.map(p => {
          const links = bankEntries.filter(e => e.node.personId === p.id).length;
          const groups = FLAGS.slice(0, 3).filter(([key]) => p[key]).map(([, label]) => label).join(' · ');
          const permissions = FLAGS.slice(3, 6).filter(([key]) => p[key] !== false).map(([, label]) => label.toLowerCase()).join(', ') || 'Aucune action autorisée';
          return `<li><div class="t"><b>${esc(p.name)}</b><small>${esc([p.role, p.precision, groups].filter(Boolean).join(' · '))}</small><small>${esc(permissions)} · poids ${p.weight ?? 1}${p.days ? ` · ${esc(p.days)}` : ''}${p.referent ? ' · référent' : ''} · ${links} question(s) liée(s)</small></div>
            <button class="btn sm" data-person-edit="${esc(p.id)}">Modifier<span class="sr-only"> ${esc(p.name)}</span></button>
            ${links ? '' : `<button class="btn sm danger" data-person-delete="${esc(p.id)}">${armed === p.id ? 'Confirmer' : 'Supprimer'}</button>`}</li>`;
        }).join('') || '<li class="muted">Aucune personne.</li>'}</ul></div>`;
    },
    bind(root) {
      const on = (s, event, fn) => root.querySelectorAll(s).forEach(el => el.addEventListener(event, fn));
      on('#person-search', 'input', e => { search = e.target.value; const at = e.target.selectionStart; rerender(); const el = root.querySelector('#person-search'); el.focus(); el.setSelectionRange(at, at); });
      on('#person-group', 'change', e => { group = e.target.value; rerender(); });
      on('#person-add', 'click', () => { editing = null; adding = true; rerender(); });
      on('[data-person-edit]', 'click', e => { editing = e.currentTarget.dataset.personEdit; adding = false; rerender(); });
      on('#person-cancel', 'click', () => { editing = null; adding = false; rerender(); });
      on('[data-person-delete]', 'click', async e => {
        const id = e.currentTarget.dataset.personDelete;
        if (armed !== id) { armed = id; rerender(); return; }
        if (await mutate('delete-person', { id }, 'Personne supprimée')) { armed = null; rerender(); }
      });
      on('#person-form', 'submit', async e => {
        e.preventDefault(); if (saving) return;
        const data = Object.fromEntries(new FormData(e.currentTarget));
        for (const [key] of FLAGS) data[key] = e.currentTarget.elements[key].checked;
        let result; busy(root, true);
        try { result = await mutate(editing ? 'save-person' : 'add-person', { ...data, id: editing }, 'Personne enregistrée'); }
        finally { busy(root, false); }
        if (result) { editing = null; adding = false; rerender(); }
      });
      busy(root, saving);
    },
  };
}
