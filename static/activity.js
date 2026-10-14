const KEY = 'anna-activity-outbox-v1';

export function createActivity({ storage, request = globalThis.fetch, onPending = () => {}, onSaved = () => {} }) {
  let queue = [], pending = null, timer;
  const stored = () => {
    try { const data = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(data) ? data : []; }
    catch { return []; }
  };
  const merge = (...lists) => [...new Map(lists.flat().map(e => [e.id, e])).values()];
  queue = stored();

  function persist() {
    storage.setItem(KEY, JSON.stringify(queue));
    onPending(queue.length);
  }

  async function flush() {
    if (pending) return pending;
    queue = merge(stored(), queue);
    pending = (async () => {
      while (queue.length) {
        const events = queue.slice(0, 50);
        const response = await request('/api/interactions', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events }),
        });
        if (!response.ok) throw new Error('Envoi de l’historique impossible. Une nouvelle tentative sera faite.');
        const sent = new Set(events.map(e => e.id));
        queue = merge(stored(), queue).filter(e => !sent.has(e.id));
        try { persist(); } catch { onPending(queue.length); }
      }
      onSaved();
    })().finally(() => { pending = null; });
    return pending;
  }

  return {
    count: () => queue.length,
    flush,
    enqueue(event) {
      queue = merge(stored(), queue);
      queue.push({ id: crypto.randomUUID(), at: Date.now(), ...event });
      // Conserver la file tant que le serveur n’a pas confirmé, y compris hors ligne.
      try { persist(); } catch { onPending(queue.length); }
      clearTimeout(timer);
      timer = setTimeout(() => flush().catch(() => {}), 250);
    },
  };
}
