import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeopleEditor } from '../static/people-editor.js';

test('l’onglet Personnes commence par le mode d’emploi pour ajouter une personne', () => {
  const editor = createPeopleEditor({ getPeople: () => [{ id: 'maman', name: 'maman', groupClose: true }], getBank: () => ({ root: { id: 'r', children: [] } }), mutate: () => {}, rerender: () => {} });
  const html = editor.render();
  assert.ok(html.indexOf('id="person-guide"') < html.indexOf('id="person-add"'));
  for (const field of ['Nom d’usage', 'Rôle', 'Groupe', 'Contacter / Voir / Parler', 'Poids', 'Enregistrer', 'Entourage']) assert.ok(html.includes(field), field);
});

test('le formulaire propose la photo et la pause, la liste les signale', () => {
  const photo = 'data:image/jpeg;base64,/9j/4AAQ';
  const people = [{ id: 'maman', name: 'maman', groupClose: true, photo, paused: true }];
  let rerender = () => {};
  const editor = createPeopleEditor({ getPeople: () => people, getBank: () => ({ root: { id: 'r', children: [] } }), mutate: () => {}, rerender: () => rerender() });
  const list = editor.render();
  assert.ok(list.includes(`<img class="av" src="${photo}"`));
  assert.ok(list.includes('En pause'));
  const root = { querySelectorAll: sel => sel === '[data-person-edit]' ? [{ dataset: { personEdit: 'maman' }, addEventListener: (_, fn) => { rerender = () => {}; fn({ currentTarget: { dataset: { personEdit: 'maman' } } }); } }] : [], querySelector: () => null };
  editor.bind(root);
  const form = editor.render();
  assert.ok(form.includes('name="photoFile"') && form.includes(`name="photo" value="${photo}"`));
  assert.ok(form.includes('name="paused" checked'));
});
