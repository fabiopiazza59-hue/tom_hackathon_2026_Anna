// Voix naturelle pré-enregistrée (ElevenLabs) quand la phrase existe, sinon la voix du navigateur.
// Les phrases s’enchaînent dans l’ordre ; une nouvelle phrase coupe la précédente sauf si on la met en file.
export function createVoice({ fetch: request = globalThis.fetch, window: w = globalThis } = {}) {
  let phrases = new Map(), configured = false, ctx = null, current = null, token = 0, chain = Promise.resolve();
  const buffers = new Map();

  // Les téléphones n’autorisent le son qu’après un geste : on débloque l’audio au premier toucher.
  const unlock = () => {
    try {
      ctx ||= new (w.AudioContext || w.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch { ctx = null; }
  };
  w.addEventListener?.('pointerdown', unlock, { capture: true });
  w.addEventListener?.('keydown', unlock, { capture: true });

  async function load() {
    try {
      const response = await request('/api/voices', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      phrases = new Map(Object.entries(data.phrases || {}));
      configured = !!data.configured;
    } catch { /* Garder la voix du navigateur. */ }
    return { configured, count: phrases.size, phrases };
  }

  async function buffer(key) {
    if (!buffers.has(key)) {
      const pending = request(`/api/voices/${key}.mp3`).then(r => { if (!r.ok) throw new Error(); return r.arrayBuffer(); }).then(data => ctx.decodeAudioData(data));
      buffers.set(key, pending);
      pending.catch(() => buffers.delete(key));
      if (buffers.size > 80) buffers.delete(buffers.keys().next().value);
    }
    return buffers.get(key);
  }

  function playRecorded(key, my) {
    if (!ctx || ctx.state !== 'running') return Promise.reject(new Error('audio verrouillé'));
    return buffer(key).then(decoded => new Promise(resolve => {
      if (my !== token) return resolve();
      const source = ctx.createBufferSource();
      source.buffer = decoded; source.connect(ctx.destination);
      source.onended = () => resolve();
      current = source; source.start();
    }));
  }

  function speakBrowser(text) {
    const synth = w.speechSynthesis;
    if (!synth || !w.SpeechSynthesisUtterance) return Promise.resolve();
    return new Promise(resolve => {
      try {
        const u = new w.SpeechSynthesisUtterance(text);
        u.lang = 'fr-FR'; u.rate = 0.95;
        // Chrome oublie parfois la fin d’une phrase : ne jamais bloquer la suite.
        const timer = setTimeout(resolve, 1500 + text.length * 120);
        u.onend = u.onerror = () => { clearTimeout(timer); resolve(); };
        synth.speak(u);
      } catch { resolve(); }
    });
  }

  async function playOne(text, my) {
    const key = phrases.get(text);
    if (key) {
      try { await playRecorded(key, my); return; } catch { /* Voix du navigateur. */ }
    }
    if (my === token) await speakBrowser(text);
  }

  function stop() {
    token++;
    try { current?.stop(); } catch { /* déjà terminé */ }
    current = null;
    try { w.speechSynthesis?.cancel(); } catch { /* indisponible */ }
  }

  function say(segments, { queue = false } = {}) {
    const list = [].concat(segments).filter(Boolean);
    if (!queue) { stop(); chain = Promise.resolve(); }
    const my = token;
    chain = chain.then(async () => { for (const text of list) { if (my !== token) return; await playOne(text, my); } }).catch(() => {});
    return chain;
  }

  return { load, say, stop, unlock, has: text => phrases.has(text), get configured() { return configured; } };
}
