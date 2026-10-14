import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_BANK } from '../static/question-bank.js';
import { categoryRows, nodeIcon } from '../static/bank-board.js';
import { availableChildren } from '../static/hierarchy.js';

test('la première vue contient les catégories et leurs seules sous-catégories dans l’ordre de la réponse', () => {
  for (const answer of ['oui', 'non', null]) {
    const rows = categoryRows(QUESTION_BANK, answer);
    assert.deepEqual(rows.map(r => r.category.id), availableChildren(QUESTION_BANK.root, answer).map(n => n.id));
    for (const { category, children } of rows) {
      assert.equal(category.level, 'category');
      assert(children.every(n => n.level === 'subcategory'));
      assert.deepEqual(children, availableChildren(category, answer));
    }
  }
  assert.equal(categoryRows(QUESTION_BANK, 'oui')[0].category.sourceId, 'ressenti');
  assert.equal(categoryRows(QUESTION_BANK, 'non')[0].category.sourceId, 'corps');
});
test('les catégories respectent les lieux et les sous-catégories respectent les branches', () => {
  const bank = {root:{children:[{id:'a',level:'category',centre:true,domicile:false,children:[
    {id:'oui',level:'subcategory',branch:'oui'}, {id:'non',level:'subcategory',branch:'non'},
  ]}]}};
  assert.equal(categoryRows(bank, 'oui', 'domicile').length,0);
  assert.deepEqual(categoryRows(bank,'oui','centre')[0].children.map(n=>n.id),['oui']);
});
test('les pictogrammes suivent le niveau et le contenu sans faux mots-clés', () => {
  assert.equal(nodeIcon({level:'subcategory',sourceId:'contacter'}),'tel');
  assert.equal(nodeIcon({level:'question',personId:'maman',label:'maman'}),'personnes');
  assert.equal(nodeIcon({level:'question',label:'Nouveau',q:'Un nouveau sujet ?'}),'question');
  assert.equal(nodeIcon({level:'question',label:'Mal dos',q:'Tu as mal au dos ?'}),'position');
  assert.equal(nodeIcon({level:'question',label:'Ice tea',q:'Tu veux boire un ice tea ?'}),'eau');
});
