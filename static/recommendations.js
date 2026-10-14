import { availableChildren, orderedNodes, entries } from './hierarchy.js';
import { calendar, peakNow } from './question-rules.js';

export function themeOrder(bank, answer, context = 'tous') {
  return orderedNodes(bank.root.children, answer)
    .filter(c => context === 'tous' ? c.centre !== false || c.domicile !== false : c[context] !== false)
    .flatMap(c => availableChildren(c, answer, context).map(n => n.id));
}

export function usageScore(stat, maxAsked = 1, hour = 12) {
  if (!stat?.a) return 0.3;
  const hit = (stat.y + 1) / (stat.a + 2);
  const use = stat.a / Math.max(1, maxAsked);
  const speed = Math.max(0, 1 - stat.rt / stat.a / 8000);
  const habitual = Object.entries(stat.hours || {}).reduce((sum, [h, count]) => {
    const distance = Math.abs(Number(h) - hour);
    return sum + (Math.min(distance, 24 - distance) <= 2 ? count : 0);
  }, 0) / Math.max(1, stat.y);
  return 0.5 * hit + 0.3 * use + 0.2 * speed + 0.1 * habitual;
}

export function topQuestions(bank, stats = {}, { answer = null, context = 'tous', hour, date = new Date() } = {}) {
  const time = calendar(date);
  if (hour != null) { time.hour = hour; time.minute = hour * 60; }
  const all = entries(bank);
  const maxAsked = Math.max(1, ...all.filter(e => ['question', 'subquestion'].includes(e.node.level) || (e.node.level === 'subcategory' && !e.node.children.length)).map(e => stats[e.node.id]?.a || 0));
  const groups = themeOrder(bank, answer, context).map(themeId => {
    const sub = all.find(e => e.node.id === themeId).node;
    const collect = node => availableChildren(node, answer, context).flatMap(n => [n, ...collect(n)]);
    const nodes = collect(sub);
    return (nodes.length ? nodes : [sub]).map(node => {
      const peak = peakNow(node.peakHours, time);
      const action = /^(contacter|voir|parler)_/.exec(node.sourceId || '')?.[1];
      const label = node.personId && action ? `${{ contacter: 'Contacter', voir: 'Voir', parler: 'Parler à' }[action]} ${node.label}` : node.label;
      return { nodeId: node.id, themeId, label, q: node.q, oppositeId: node.oppositeId,
        pinned: !!node.pinned && (!node.peakHours || peak),
        score: usageScore(stats[node.id], maxAsked, time.hour) * (node.weight ?? 1) * (peak ? 1.5 : 1),
      };
    }).sort((a, b) => b.score - a.score);
  }).filter(g => g.length);
  const allCandidates = groups.flat().sort((a, b) => b.score - a.score), result = [];
  const add = item => {
    if (result.length < 3 && !result.some(o => o.nodeId === item.nodeId || o.nodeId === item.oppositeId || o.oppositeId === item.nodeId)) result.push(item);
  };
  allCandidates.filter(c => c.pinned).forEach(add);
  (answer ? groups.map(g => g[0]) : allCandidates).forEach(add);
  allCandidates.forEach(add);
  return result;
}
