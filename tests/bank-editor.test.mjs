import test from 'node:test';
import assert from 'node:assert/strict';
import { createBankEditor } from '../static/bank-editor.js';
import { entries } from '../static/hierarchy.js';

const item = (id, level, order, children = []) => ({ id, level, order, q: id, label: id, children });

test('l’admin trie chaque niveau, même si les éléments ont été créés dans un autre ordre', () => {
  const bank = { root: item('départ', 'master', null, [
    item('cat2', 'category', 2),
    item('cat1', 'category', 1, [
      item('sub2', 'subcategory', 2),
      item('sub1', 'subcategory', 1, [
        item('q2', 'question', 2),
        item('q1', 'question', 1, [
          item('sqVide', 'subquestion', null), item('sq2', 'subquestion', 2), item('sq1', 'subquestion', 1),
        ]),
      ]),
    ]),
  ]) };
  assert.deepEqual(entries(bank).map(e => e.node.id), ['départ', 'cat1', 'sub1', 'q1', 'sq1', 'sq2', 'sqVide', 'q2', 'sub2', 'cat2']);
  const editor = createBankEditor({ getBank: () => bank, mutate: () => {}, rerender: () => {} });
  const html = editor.render();
  for (const [first, second] of [['cat1', 'cat2'], ['sub1', 'sub2'], ['q1', 'q2'], ['sq1', 'sq2'], ['sq2', 'sqVide']]) {
    assert.ok(html.indexOf(`data-bank-edit="${first}"`) < html.indexOf(`data-bank-edit="${second}"`));
  }
  assert.ok(html.includes('<span class="bank-rank">Ordre 1</span> cat1'));
});

test('une modification d’ordre est reflétée au rendu suivant', () => {
  const a = item('a', 'category', 1), b = item('b', 'category', 2);
  const bank = { root: item('départ', 'master', null, [a, b]) };
  const editor = createBankEditor({ getBank: () => bank, mutate: () => {}, rerender: () => {} });
  a.order = 3;
  const html = editor.render();
  assert.ok(html.indexOf('data-bank-edit="b"') < html.indexOf('data-bank-edit="a"'));
});
