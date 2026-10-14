export const LEVELS = ['master', 'category', 'subcategory', 'question', 'subquestion'];
export const LEVEL_NAMES = ['Question de départ', 'Catégorie', 'Sous-catégorie', 'Question', 'Sous-question'];

export function entries(bank) {
  const result = [];
  function walk(node, parent, path) {
    result.push({ node, parent, path });
    for (const child of node.children || []) walk(child, node, [...path, node]);
  }
  walk(bank.root, null, []);
  return result;
}
export const findEntry = (bank, id) => entries(bank).find(e => e.node.id === id);

// Les ordres renseignés priment ; les autres restent dans leur ordre d’import.
export function orderedNodes(nodes, answer) {
  const order = node => (node.level === 'category' && answer
    ? node[answer === 'oui' ? 'orderYes' : 'orderNo'] ?? node.order
    : node.order) ?? Infinity;
  return nodes.map((node, index) => ({ node, index })).sort((a, b) => order(a.node) - order(b.node) || a.index - b.index).map(x => x.node);
}

export function availableChildren(node, answer, context = 'tous') {
  return orderedNodes((node.children || []).filter(child =>
    (context === 'tous' ? child.centre !== false || child.domicile !== false : child[context] !== false)
    && (child.level !== 'subcategory' || !answer || !child.branch || child.branch === 'les_deux' || child.branch === answer)
  ), answer);
}

export function bankRows(bank) {
  const types = [], themes = [], questions = [];
  for (const category of orderedNodes(bank.root.children)) {
    types.push({ id: category.id, name: category.label, short_label: category.label, icon: category.icon || 'autre', hue: category.hue || 0 });
    for (const sub of orderedNodes(category.children)) {
      themes.push({ id: sub.id, type_id: category.id, label: sub.label, subtitle: sub.q, icon: category.icon || 'autre', is_private: !!sub.private, people_kinds: null });
      function walk(nodes, parentId) {
        for (const node of orderedNodes(nodes)) {
          questions.push({ id: node.id, theme_id: sub.id, parent_id: parentId, label: node.label, text: node.q,
            kind: 'question', is_private: !!node.private, is_urgent: false, has_intensity: false });
          walk(node.children, node.id);
        }
      }
      walk(sub.children, null);
    }
  }
  return { types, themes, questions, followups: [] };
}

export function startHierarchy(bank, { context = 'tous', targetId = null } = {}) {
  return { current: bank.root, answer: null, context, targetId, frames: [], path: [], selected: [], done: false, result: null };
}

export function answerHierarchy(bank, previous, answer) {
  const state = structuredClone(previous);
  const node = state.current;
  if (state.done || !['oui', 'non'].includes(answer)) return state;
  if (node.level === 'master') {
    state.answer = answer;
    let children = availableChildren(node, answer, state.context);
    if (state.targetId) {
      const target = findEntry(bank, state.targetId);
      const category = target?.node.level === 'category' ? target.node : target?.path.find(p => p.level === 'category');
      if (category) children = children.filter(c => c.id === category.id);
    }
    state.frames = [{ nodes: children, index: 0 }];
    state.path = [{ ...node, response: answer }];
    if (children.length) state.current = children[0];
    else finish(state, false);
    return state;
  }
  if (answer === 'oui') {
    state.selected.push(node);
    state.path.push({ ...node, response: answer });
    let children = availableChildren(node, state.answer, state.context);
    if (node.level === 'category' && state.targetId) {
      const target = findEntry(bank, state.targetId);
      const sub = target?.node.level === 'subcategory' ? target.node : target?.path.find(p => p.level === 'subcategory');
      if (sub) children = children.filter(c => c.id === sub.id);
    }
    if (children.length) { state.frames.push({ nodes: children, index: 0 }); state.current = children[0]; }
    else finish(state, true, node.yesText || node.label);
  } else if (node.noText) {
    state.path.push({ ...node, response: answer });
    finish(state, true, node.noText);
  } else {
    const frame = state.frames.at(-1);
    frame.index++;
    if (frame.index < frame.nodes.length) state.current = frame.nodes[frame.index];
    else {
      const parent = state.selected.at(-1);
      finish(state, !!parent, parent?.yesText || parent?.label);
    }
  }
  return state;
}

function finish(state, found, text) {
  state.done = true;
  state.result = { found, text: text || 'Aucune réponse trouvée dans cette branche.' };
}
