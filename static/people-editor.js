import { entries } from './hierarchy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FLAGS = [['groupClose', 'Proches'], ['groupCare', 'Soins à domicile'], ['groupCentre', 'Centre'], ['canContact', 'Contacter'], ['canSee', 'Voir'], ['canTalk', 'Parler'], ['referent', 'Référent'], ['paused', 'En pause']];
const MAX_PHOTO = 60000;
const photoPreview = photo => photo ? `<img class="av big" src="${esc(photo)}" alt="Photo actuelle">` : '<span class="av big photo-empty" aria-hidden="true">?</span>';

// Recadrer au centre et réduire dans le navigateur : la photo voyage avec la liste des personnes.
export async function resizePhoto(file, size = 240) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= MAX_PHOTO) return url;
  }
  throw new Error('Photo trop lourde');
}

// Mode d’emploi pour l’entourage : faire évoluer la liste en même temps que la vie d’Anna.
export const PEOPLE_GUIDE = `<details class="card guide" id="person-guide"><summary>Mode d’emploi : ajouter ou modifier une personne</summary>
  <ol>
    <li>Touchez <b>Ajouter une personne</b> (ou <b>Modifier</b> à côté d’un nom).</li>
    <li><b>Nom d’usage</b> : le nom tel qu’Anna le dit (« maman », « Thierry », « Madame Chaouch »). C’est ce nom qui s’affiche et qui est lu à voix haute.</li>
    <li><b>Rôle</b> : sa fonction en quelques mots (« mon frère », « le kiné », « l’infirmière »). <b>Précision</b> est une note libre, facultative.</li>
    <li><b>Groupe</b> : cochez <b>Proches</b>, <b>Soins à domicile</b> ou <b>Centre</b>. C’est ce qui la range dans la page Entourage.</li>
    <li><b>Contacter / Voir / Parler</b> : décochez ce qui ne convient pas. Après son nom, Anna ne se verra proposer que les cases cochées.</li>
    <li><b>Poids</b> : 1 = normal. Plus le chiffre est haut, plus la personne apparaît tôt (maman a 6).</li>
    <li><b>Photo</b> (facultative) : choisissez une photo du visage, elle remplace l’initiale. Elle est recadrée et réduite automatiquement. Demandez d’abord l’accord de la personne : la liste est visible par toute personne qui a le lien du site.</li>
    <li><b>Genre</b>, <b>Référent</b> et <b>Jours</b> servent aux questions liées (« C’est une femme ? », « ton référent »). Laissez Jours vide si la personne peut venir tous les jours.</li>
    <li>Touchez <b>Enregistrer</b>. La personne apparaît dans <b>Entourage</b> sur tous les téléphones en moins d’une minute, sans créer de question.</li>
  </ol>
  <p class="muted">Changer un nom ou un rôle met aussi à jour les questions liées. Quelqu’un est absent un moment (vacances, arrêt, départ) : cochez <b>En pause</b>. La personne disparaît d’Entourage et des questions, sans rien perdre ; décochez pour la faire revenir. Pour l’effacer définitivement, utilisez <b>Supprimer</b> ; si ce bouton n’apparaît pas, elle est liée à des questions : retirez d’abord ces liens dans l’onglet Questions.</p>
</details>`;

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
      <label class="fl">Poids (1 = normal, plus haut = proposé plus tôt)<input name="weight" type="number" min="0" step="any" value="${p.weight ?? 1}"></label>
      ${input('Jours (vide = tous, sinon weekend, semaine, lundi…)', 'days', 120)}
      <div class="fl photo-field"><span>Photo</span><div class="photo-row"><span id="person-photo-preview">${photoPreview(p.photo)}</span>
        <label class="btn sm">Choisir une photo<input type="file" name="photoFile" id="person-photo" accept="image/*" class="sr-only"></label>
        <button class="btn sm" type="button" id="person-photo-remove" ${p.photo ? '' : 'hidden'}>Retirer la photo</button></div>
        <input type="hidden" name="photo" value="${esc(p.photo || '')}"></div>
      ${FLAGS.map(([key, label]) => `<label class="ck"><input type="checkbox" name="${key}" ${p[key] ? 'checked' : ''}> ${label}</label>`).join('')}
      <div class="row"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" id="person-cancel">Annuler</button></div>
    </form><span id="person-status" class="sr-only" role="status"></span><p class="muted">Les autorisations et les jours filtrent les questions liées à cette personne. Les liens se modifient dans l’onglet Questions.</p></div>`;
  }
  return {
    render() {
      const people = getPeople(), bankEntries = entries(getBank());
      const list = people.filter(p => (!group || p[group]) && `${p.name} ${p.role} ${p.precision || ''}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')));
      return `${PEOPLE_GUIDE}<div class="bank-toolbar"><label class="fl">Chercher une personne<input type="search" id="person-search" value="${esc(search)}"></label><button class="btn primary" id="person-add">Ajouter une personne</button></div>
        <label class="fl">Groupe<select id="person-group">${[['', 'Tous'], ['groupClose', 'Proches'], ['groupCare', 'Soins à domicile'], ['groupCentre', 'Centre'], ['referent', 'Référents']].map(([key, label]) => `<option value="${key}" ${group === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <p class="muted">${list.length} personne(s) sur ${people.length}</p>${editing || adding ? form() : ''}
        <div class="card"><ul class="rows">${list.map(p => {
          const links = bankEntries.filter(e => e.node.personId === p.id).length;
          const groups = FLAGS.slice(0, 3).filter(([key]) => p[key]).map(([, label]) => label).join(' · ');
          const permissions = FLAGS.slice(3, 6).filter(([key]) => p[key] !== false).map(([, label]) => label.toLowerCase()).join(', ') || 'Aucune action autorisée';
          return `<li>${p.photo ? `<img class="av" src="${esc(p.photo)}" alt="">` : ''}<div class="t"><b>${esc(p.name)}</b>${p.paused ? ' <span class="pill">En pause</span>' : ''}<small>${esc([p.role, p.precision, groups].filter(Boolean).join(' · '))}</small><small>${esc(permissions)} · poids ${p.weight ?? 1}${p.days ? ` · ${esc(p.days)}` : ''}${p.referent ? ' · référent' : ''} · ${links} question(s) liée(s)</small></div>
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
      const setPhoto = photo => {
        root.querySelector('#person-form [name="photo"]').value = photo;
        root.querySelector('#person-photo-preview').innerHTML = photoPreview(photo);
        root.querySelector('#person-photo-remove').hidden = !photo;
      };
      on('#person-photo', 'change', async e => {
        const file = e.target.files[0]; if (!file) return;
        try { setPhoto(await resizePhoto(file)); root.querySelector('#person-status').textContent = 'Photo prête, pensez à enregistrer.'; }
        catch { root.querySelector('#person-status').textContent = ''; alert('Cette image ne peut pas être lue. Essayez une autre photo (JPEG ou PNG).'); }
        e.target.value = '';
      });
      on('#person-photo-remove', 'click', () => setPhoto(''));
      on('[data-person-delete]', 'click', async e => {
        const id = e.currentTarget.dataset.personDelete;
        if (armed !== id) { armed = id; rerender(); return; }
        if (await mutate('delete-person', { id }, 'Personne supprimée')) { armed = null; rerender(); }
      });
      on('#person-form', 'submit', async e => {
        e.preventDefault(); if (saving) return;
        const data = Object.fromEntries(new FormData(e.currentTarget));
        delete data.photoFile;
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
