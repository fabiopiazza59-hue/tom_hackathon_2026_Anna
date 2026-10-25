import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleGroups, orderedPeople, personSteps, personItem, peopleScan } from '../static/people-board.js';

const people = [
  { id: 'kine', name: 'Thierry', groupCentre: true, weight: 1 },
  { id: 'papa', name: 'papa', groupClose: true, weight: 1 },
  { id: 'maman', name: 'maman', groupClose: true, weight: 6 },
  { id: 'osteo', name: 'Jean-Marc', groupCare: true, weight: 1, canSee: false },
  { id: 'x', name: 'Sans groupe' },
];

test('les personnes sont groupées Proches → Soins → Centre → Autres, par poids puis ordre d’import', () => {
  assert.deepEqual(peopleGroups(people).map(g => [g.label, g.people.map(p => p.id)]),
    [['Proches', ['maman', 'papa']], ['Soins', ['osteo']], ['Centre', ['kine']], ['Autres', ['x']]]);
  assert.deepEqual(orderedPeople(people).map(p => p.id), ['maman', 'papa', 'osteo', 'kine', 'x']);
});
test('une personne dans plusieurs groupes n’apparaît qu’une fois', () => {
  assert.deepEqual(orderedPeople([{ id: 'a', name: 'A', groupClose: true, groupCentre: true }]).map(p => p.id), ['a']);
});
test('après un nom, on propose les actions autorisées puis « Autre chose »', () => {
  const steps = personSteps(people[3]);
  assert.deepEqual(steps.map(s => s.l), ['Contacter', 'Parler', 'Autre chose']);
  assert.equal(steps[0].q, 'Tu veux contacter Jean-Marc ?');
  assert.equal(steps[0].yesText, 'Je voudrais contacter Jean-Marc.');
  assert.equal(steps.at(-1).action, 'spell');
  const item = personItem(people[2]);
  assert.equal(item.yesText, 'C’est à propos de maman.');
  assert.equal(item.person, 'maman');
});
test('le parcours Oui / Non passe par le groupe puis le nom', () => {
  const scan = peopleScan(people);
  assert.equal(scan[0].q, 'C’est quelqu’un de tes proches ?');
  assert.deepEqual(scan[0].then.map(p => p.q), ['C’est maman ?', 'C’est papa ?']);
  assert.equal(scan.at(-1).q, 'C’est quelqu’un d’autre ?');
});
test('une personne en pause n’apparaît pas dans Entourage', () => {
  assert.deepEqual(orderedPeople([...people, { id: 'absent', name: 'Absent', groupClose: true, weight: 9, paused: true }]).map(p => p.id), ['maman', 'papa', 'osteo', 'kine', 'x']);
});
