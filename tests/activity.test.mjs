import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivity } from '../static/activity.js';

function storage() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}
const answer = () => ({ kind: 'answer', conversationId: crypto.randomUUID(), questionId: 'q:mal_dos', question: 'Tu as mal au dos ?', answer: 'oui', ms: 1000 });

test('la file conserve les mêmes identifiants après une panne réseau et une réouverture', async () => {
  const local = storage(), received = [];
  let online = false;
  const request = async (path, options) => {
    received.push(JSON.parse(options.body).events);
    if (!online) throw new Error('offline');
    return Response.json({ ok: true });
  };
  const first = createActivity({ storage: local, request });
  first.enqueue(answer());
  await assert.rejects(first.flush());
  assert.equal(first.count(), 1);
  online = true;
  const reopened = createActivity({ storage: local, request });
  await reopened.flush();
  assert.equal(reopened.count(), 0);
  assert.equal(received[0][0].id, received[1][0].id);
});

test('deux onglets du même navigateur ne suppriment pas les réponses en attente de l’autre', async () => {
  const local = storage(), sent = [];
  const request = async (path, options) => { sent.push(...JSON.parse(options.body).events); return Response.json({ ok: true }); };
  const a = createActivity({ storage: local, request }), b = createActivity({ storage: local, request });
  a.enqueue(answer()); b.enqueue(answer());
  await b.flush();
  assert.equal(new Set(sent.map(e => e.id)).size, 2);
  assert.equal(JSON.parse(local.getItem('anna-activity-outbox-v1')).length, 0);
  await a.flush(); // Un éventuel renvoi conserve l’identifiant pour la déduplication serveur.
  assert.equal(new Set(sent.map(e => e.id)).size, 2);
});
