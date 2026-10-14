import { entries, findEntry, LEVELS, LEVEL_NAMES, orderedNodes } from './hierarchy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const levelName = node => LEVEL_NAMES[LEVELS.indexOf(node.level)];

export function createBankEditor({ getBank, getPeople = () => [], mutate, rerender }) {
  let editing = null, addingTo = null, search = '', armed = null, saving = false;
  const show = () => rerender();
  const matches = node => !search || `${node.q} ${node.label} ${node.sourceId || ''}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')) || node.children.some(matches);

  function tree(node) {
    if (!matches(node)) return '';
    const badge = node.order == null ? 'Ordre libre' : `Ordre ${node.order}`;
    const info = [node.weight != null ? `Poids ${node.weight}` : '', node.days ? `Jours : ${node.days}` : '', node.weekendOrder != null ? `Ordre week-end ${node.weekendOrder}` : '', node.peakHours ? `Créneaux : ${node.peakHours}` : '', node.pinned ? 'Épinglé au Top 3 pendant les créneaux' : '', node.personId ? `Personne : ${getPeople().find(p => p.id === node.personId)?.name || node.personId}` : ''].filter(Boolean).join(' · ');
    const row = `<div class="bank-row"><div><span class="bank-level">${esc(levelName(node))} · ${badge}</span><p>${esc(node.q)}</p>${info ? `<small class="muted">${esc(info)}</small>` : ''}</div><div class="bank-actions">
      <button class="btn sm" data-bank-edit="${esc(node.id)}">Modifier<span class="sr-only"> : ${esc(node.q)}</span></button>
      ${node.level !== 'subquestion' ? `<button class="btn sm" data-bank-add="${esc(node.id)}">+ ${LEVEL_NAMES[LEVELS.indexOf(node.level) + 1]}</button>` : ''}
      ${node.level !== 'master' ? `<button class="btn sm danger" data-bank-delete="${esc(node.id)}">${armed === node.id ? 'Confirmer' : 'Supprimer'}<span class="sr-only"> : ${esc(node.q)}</span></button>` : ''}
    </div></div>`;
    if (!node.children.length) return `<div class="bank-leaf">${row}</div>`;
    const open = search || node.level === 'master' || node.id === orderedNodes(getBank().root.children)[0]?.id;
    const rank = node.level === 'master' ? '' : `<span class="bank-rank">${node.order == null ? 'Sans ordre' : `Ordre ${esc(node.order)}`}</span> `;
    return `<details class="bank-branch" ${open ? 'open' : ''}><summary>${rank}${esc(node.label)} <span class="muted">(${node.children.length})</span></summary>${row}<div class="bank-children">${orderedNodes(node.children).map(tree).join('')}</div></details>`;
  }

  function form() {
    const bank = getBank(), entry = editing ? findEntry(bank, editing) : null;
    const parent = addingTo ? findEntry(bank, addingTo)?.node : entry?.parent;
    const node = entry?.node || { level: LEVELS[LEVELS.indexOf(parent?.level) + 1], order: null, centre: true, domicile: true, branch: 'les_deux' };
    const index = LEVELS.indexOf(node.level);
    const input = (label, key, type = 'text') => `<label class="fl">${label}<input name="${key}" type="${type}" value="${esc(node[key] ?? '')}" ${type === 'number' ? 'min="0" step="1"' : 'maxlength="100"'}></label>`;
    const parents = entries(bank).filter(e => e.node.level === LEVELS[index - 1]);
    return `<div class="card bank-edit" id="bank-editor"><h3 tabindex="-1">${editing ? 'Modifier' : 'Ajouter'} · ${LEVEL_NAMES[index]}</h3><form id="bank-form" class="fgrid c2">
      <label class="fl wide">Question<input type="text" name="q" aria-label="Question à poser" value="${esc(node.q || '')}" required maxlength="600"></label>
      ${input('Libellé', 'label')}
      ${index ? input('Ordre (facultatif)', 'order', 'number') : ''}
      ${index ? `<label class="fl wide">Parent<select name="parentId">${parents.map(e => `<option value="${esc(e.node.id)}" ${parent?.id === e.node.id ? 'selected' : ''}>${esc([...e.path.filter(p => p.level !== 'master'), e.node].map(p => p.label).join(' › '))}</option>`).join('')}</select></label>` : ''}
      ${node.level === 'category' ? input('Ordre après Oui à « Ça va ? »', 'orderYes', 'number') + input('Ordre après Non à « Ça va ? »', 'orderNo', 'number') : ''}
      ${node.level === 'subcategory' ? `<label class="fl">Après la question de départ<select name="branch">${[['les_deux', 'Après Oui ou Non'], ['oui', 'Après Oui'], ['non', 'Après Non']].map(([v, label]) => `<option value="${v}" ${node.branch === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}
      ${index >= 3 ? `<label class="fl">Poids<input name="weight" type="number" min="0" step="any" value="${node.weight ?? 1}"></label>
        ${input('Jours (vide = tous, sinon weekend, semaine, lundi…)', 'days')}${input('Ordre le week-end (facultatif)', 'weekendOrder', 'number')}
        <label class="fl">Question contraire<select name="oppositeId"><option value="">Aucune</option>${entries(bank).filter(e => e.node.level === node.level && e.node.id !== node.id).map(e => `<option value="${esc(e.node.id)}" ${e.node.id === node.oppositeId ? 'selected' : ''}>${esc(e.node.q)}</option>`).join('')}</select></label>
        <label class="fl">Personne liée<select name="personId"><option value="">Aucune</option>${getPeople().map(p => `<option value="${esc(p.id)}" ${p.id === node.personId ? 'selected' : ''}>${esc(p.name)}${p.role ? ` · ${esc(p.role)}` : ''}</option>`).join('')}</select></label>
        ${node.level === 'question' ? `${input('Créneaux horaires (ex. 8-10;12-13)', 'peakHours')}<label class="ck"><input name="pinned" type="checkbox" ${node.pinned ? 'checked' : ''}> Épingler au Top 3 pendant ces créneaux</label>` : ''}` : ''}
      ${index ? `<label class="fl wide">Phrase si Oui<textarea name="yesText" maxlength="600">${esc(node.yesText || '')}</textarea></label><label class="fl wide">Phrase si Non (facultative)<textarea name="noText" maxlength="600">${esc(node.noText || '')}</textarea></label>
      <label class="ck"><input name="centre" type="checkbox" ${node.centre !== false ? 'checked' : ''}> Au centre</label><label class="ck"><input name="domicile" type="checkbox" ${node.domicile !== false ? 'checked' : ''}> Au domicile</label>` : ''}
      <div class="row wide"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" id="bank-cancel">Annuler</button><span id="bank-error" class="err" role="alert"></span></div>
    </form><span id="bank-status" class="sr-only" role="status"></span></div>`;
  }

  function showSaving(root, value) {
    saving = value;
    const form = root.querySelector('#bank-form');
    if (!form) return;
    form.setAttribute('aria-busy', String(saving));
    form.querySelectorAll('input, select, textarea, button').forEach(el => { el.disabled = saving; });
    form.querySelector('[type="submit"]').textContent = saving ? 'Enregistrement en cours…' : 'Enregistrer';
    root.querySelector('#bank-status').textContent = saving ? 'Enregistrement en cours…' : '';
    root.querySelectorAll('#bank-search, [data-bank-edit], [data-bank-add], [data-bank-delete]').forEach(el => { el.disabled = saving; });
  }

  return {
    render() {
      const count = entries(getBank()).length - 1;
      return `<div class="bank-toolbar"><label class="fl">Chercher dans la banque<input type="search" id="bank-search" value="${esc(search)}" placeholder="Question, libellé…"></label><span class="muted">${count} éléments · ordre croissant</span></div>
        ${editing || addingTo ? form() : ''}<div class="bank-tree">${tree(getBank().root) || '<p>Aucun résultat.</p>'}</div>`;
    },
    bind(root) {
      const on = (selector, event, fn) => root.querySelectorAll(selector).forEach(el => el.addEventListener(event, fn));
      const focusForm = () => document.querySelector('#bank-editor h3')?.focus();
      on('#bank-search', 'input', e => { search = e.target.value; const at = e.target.selectionStart; show(); const input = root.querySelector('#bank-search'); input.focus(); input.setSelectionRange(at, at); });
      on('[data-bank-edit]', 'click', e => { editing = e.currentTarget.dataset.bankEdit; addingTo = null; armed = null; show(); focusForm(); });
      on('[data-bank-add]', 'click', e => { addingTo = e.currentTarget.dataset.bankAdd; editing = null; armed = null; show(); focusForm(); });
      on('#bank-cancel', 'click', () => { editing = addingTo = null; show(); });
      on('[data-bank-delete]', 'click', async e => {
        const id = e.currentTarget.dataset.bankDelete;
        if (armed !== id) { armed = id; show(); return; }
        const result = await mutate('delete-node', { id }, 'Élément supprimé');
        if (result) { armed = null; if (editing && !findEntry(getBank(), editing)) editing = null; if (addingTo && !findEntry(getBank(), addingTo)) addingTo = null; show(); }
      });
      on('#bank-form', 'submit', async e => {
        e.preventDefault();
        if (saving) return;
        const data = Object.fromEntries(new FormData(e.currentTarget));
        for (const key of ['centre', 'domicile']) data[key] = e.currentTarget.elements[key]?.checked ?? true;
        if (e.currentTarget.elements.pinned) data.pinned = e.currentTarget.elements.pinned.checked;
        showSaving(root, true);
        let result;
        try {
          result = await mutate(editing ? 'save-node' : 'add-node', { ...data, id: editing, parentId: data.parentId || addingTo }, 'Question enregistrée');
        } finally {
          showSaving(root, false);
        }
        if (result) { editing = addingTo = null; show(); }
      });
      showSaving(root, saving);
    },
  };
}
