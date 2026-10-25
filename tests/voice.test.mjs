import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoice } from '../static/voice.js';
import { allPhrases, HELLO } from '../static/phrases.js';
import { QUESTION_BANK } from '../static/question-bank.js';

// Faux navigateur : un AudioContext qui « joue » instantanément et une synthèse vocale qui note les phrases.
function fakeBrowser({ recorded = {}, locked = false, failAudio = false } = {}) {
  const played = [], listeners = {};
  let activation = !locked;
  class Ctx {
    state = locked ? 'suspended' : 'running';
    // Comme un vrai navigateur : la reprise n’aboutit que pendant un geste qui compte.
    resume() { if (activation) this.state = 'running'; return Promise.resolve(); }
    createBuffer() { return {}; }
    decodeAudioData(data) { return Promise.resolve(new TextDecoder().decode(data)); }
    createBufferSource() { return { connect() {}, stop() {}, start() { if (typeof this.buffer === 'string') { played.push(`enregistré:${this.buffer}`); setTimeout(() => this.onended(), 1); } } }; }
    get destination() { return {}; }
  }
  const window = {
    AudioContext: Ctx, navigator: { audioSession: { type: 'auto' } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    speechSynthesis: { speak(u) { played.push(`navigateur:${u.text}`); setTimeout(() => u.onend(), 1); }, cancel() {} },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  };
  const fetch = async url => url === '/api/voices'
    ? { ok: true, json: async () => ({ configured: true, phrases: recorded }) }
    : failAudio ? { ok: false } : { ok: true, arrayBuffer: async () => new TextEncoder().encode(url.split('/').pop().replace('.mp3', '')).buffer };
  // Au doigt : pointerdown ne compte pas comme geste, pointerup / click oui.
  const fire = (type, counts) => { const before = activation; activation = counts; listeners[type]?.(); activation = before; };
  const fingerTap = () => { fire('pointerdown', false); fire('pointerup', true); fire('click', true); };
  return { window, fetch, played, tap: () => listeners.pointerdown(), fire, fingerTap, listeners };
}

test('une phrase enregistrée est jouée, les autres passent par la voix du navigateur, dans l’ordre', async () => {
  const b = fakeBrowser({ recorded: { 'Ça va ?': 'k1' } });
  const voice = createVoice(b);
  await voice.load(); b.tap();
  await voice.say(['Ça va ?', 'Message : bonjour']);
  assert.deepEqual(b.played, ['enregistré:k1', 'navigateur:Message : bonjour']);
});

test('si l’audio est bloqué ou introuvable, la voix du navigateur prend le relais', async () => {
  for (const options of [{ locked: true }, { failAudio: true }]) {
    const b = fakeBrowser({ recorded: { Oui: 'k1' }, ...options });
    const voice = createVoice(b);
    await voice.load(); b.tap();
    await voice.say('Oui');
    assert.deepEqual(b.played, ['navigateur:Oui']);
  }
});

test('une nouvelle phrase coupe la précédente, sauf si elle est mise en file', async () => {
  const b = fakeBrowser();
  const voice = createVoice(b);
  voice.say(['Une', 'Deux']);
  await new Promise(r => setTimeout(r, 0));  // « Une » a commencé.
  await voice.say('Trois');
  assert.deepEqual(b.played, ['navigateur:Une', 'navigateur:Trois']);
  b.played.length = 0;
  voice.say('Oui');
  await voice.say('Question suivante ?', { queue: true });
  assert.deepEqual(b.played, ['navigateur:Oui', 'navigateur:Question suivante ?']);
});

test('la liste des phrases à enregistrer couvre questions, phrases, suivis, personnes et épellation', () => {
  const people = [{ id: 'maman', name: 'maman', groupClose: true, canContact: true, canSee: true, canTalk: true }];
  const list = allPhrases(QUESTION_BANK, people, 'Anna');
  for (const text of ['Oui', 'Non', HELLO, 'Ça va ?', 'Tu as mal au dos ?', "J'ai mal au dos.", "C'est une douleur forte ?",
    'C’est à propos de maman.', 'Tu veux voir maman ?', 'C’est quelqu’un de tes proches ?', 'Lettre dans : E S A I N T R U L ?', '« E » ?', 'Anna veut parler']) {
    assert.ok(list.includes(text), text);
  }
  assert.equal(new Set(list).size, list.length);
});

test('au doigt, l’audio se débloque quand le doigt se lève, pas quand il se pose', async () => {
  const b = fakeBrowser({ recorded: { Oui: 'k1' }, locked: true });
  const voice = createVoice(b);
  await voice.load();
  b.fire('pointerdown', false);  // Doigt posé : pas encore autorisé.
  await voice.say('Oui');
  assert.deepEqual(b.played, ['navigateur:Oui']);
  b.played.length = 0;
  b.fingerTap();
  await voice.say('Oui');
  assert.deepEqual(b.played, ['enregistré:k1']);
});

test('sur iPhone, le son enregistré passe malgré le bouton silencieux', () => {
  const b = fakeBrowser();
  createVoice(b);
  assert.equal(b.window.navigator.audioSession.type, 'playback');
});
