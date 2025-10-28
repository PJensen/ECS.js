// ecs/hierarchy.js
// Parent/child linked-list hierarchy (domain-neutral).

const KEY = Object.freeze({ Parent: Symbol('Parent'), Sibling: Symbol('Sibling') });

export const Parent  = { key: KEY.Parent,  name: 'Parent',  defaults: Object.freeze({ first:0, last:0, count:0 }) };
export const Sibling = { key: KEY.Sibling, name: 'Sibling', defaults: Object.freeze({ parent:0, prev:0, next:0, index:0 }) };

export function ensureParent(world, id){ if (!world.has(id, Parent)) world.add(id, Parent, { first:0, last:0, count:0 }); return id; }
export function isChild(world, id){ return world.has(id, Sibling); }
export function getParent(world, child){ const s = world.get(child, Sibling); return s ? s.parent|0 : 0; }

export function *children(world, parent){
  const p = world.get(parent, Parent); if (!p) return;
  let c = p.first|0;
  while (c){ yield c; const s = world.get(c, Sibling); c = s ? (s.next|0) : 0; }
}

export function *childrenWith(world, parent, ...comps){
  for (const c of children(world, parent)){
    let ok = true;
    for (const k of comps){ if (!world.has(c, k)) { ok=false; break; } }
    if (ok) yield [c, ...comps.map(k=>world.get(c,k))];
  }
}

export function childCount(world, parent){ const p = world.get(parent, Parent); return p ? p.count|0 : 0; }

/* ---- NEW: cycle guard helper ---- */
function _isDescendant(world, maybeChild, maybeAncestor){
  for (let p = getParent(world, maybeChild); p; p = getParent(world, p)){
    if (p === maybeAncestor) return true;
  }
  return false;
}

export function attach(world, child, parent, opts = {}){
  if (child === parent) throw new Error('attach: cannot parent to self');
  ensureParent(world, parent);

  /* ---- NEW: prevent cycles (parent must not be a descendant of child) ---- */
  if (_isDescendant(world, parent, child)) throw new Error('attach: cannot create a cycle (parent is a descendant of child)');

  if (isChild(world, child)){
    const curP = getParent(world, child);
    if (curP === parent) return _reinsertSameParent(world, child, parent, opts);
    detach(world, child);
  }

  world.add(child, Sibling, { parent, prev:0, next:0, index:0 });

  const p = world.get(parent, Parent);
  let before = (opts.before|0) || 0;
  let after  = (opts.after|0)  || 0;
  let useIndex = (typeof opts.index === 'number') ? (opts.index|0) : null;
  if (before && after) throw new Error('attach: provide at most one of before/after');

  if (useIndex != null){
    useIndex = Math.max(0, Math.min(p.count, useIndex));
    if (useIndex === p.count) after = p.last|0;
    else if (useIndex === 0) before = p.first|0;
    else { let i=0, c = p.first|0; while (c && i < useIndex){ c = (world.get(c, Sibling).next|0); i++; } before = c|0; }
  }

  let prev=0, next=0, idx=0;
  if (before){
    const bs = world.get(before, Sibling);
    if (!bs || bs.parent !== parent) throw new Error('attach: before target not child of parent');
    next = before; prev = bs.prev|0; idx = bs.index|0;
    if (prev){ world.set(prev, Sibling, { next: child }); } else { world.set(parent, Parent, { first: child }); }
    world.set(next, Sibling, { prev: child });
    _bumpIndices(world, parent, idx, +1);
  } else if (after){
    const as = world.get(after, Sibling);
    if (!as || as.parent !== parent) throw new Error('attach: after target not child of parent');
    prev = after; next = as.next|0; idx = (as.index|0)+1;
    if (next){ world.set(next, Sibling, { prev: child }); } else { world.set(parent, Parent, { last: child }); }
    world.set(prev, Sibling, { next: child });
    _bumpIndices(world, parent, idx, +1);
  } else {
    prev = p.last|0; idx = p.count|0;
    if (prev){ world.set(prev, Sibling, { next: child }); } else { world.set(parent, Parent, { first: child }); }
    world.set(parent, Parent, { last: child });
  }

  world.set(child, Sibling, { parent, prev, next, index: idx });
  world.set(parent, Parent, { count: p.count + 1 });
  return child;
}

export function detach(world, child, opts = {}){
  const s = world.get(child, Sibling);
  if (!s || !s.parent) return child;
  const parent = s.parent|0; const p = world.get(parent, Parent);
  if (!p){ _clearSibling(world, child); return child; }

  const prev = s.prev|0, next = s.next|0, idx = s.index|0;
  if (prev){ world.set(prev, Sibling, { next }); } else { world.set(parent, Parent, { first: next }); }
  if (next){ world.set(next, Sibling, { prev }); } else { world.set(parent, Parent, { last: prev }); }

  _bumpIndices(world, parent, idx+1, -1);
  world.set(parent, Parent, { count: Math.max(0, p.count - 1) });
  if (opts.remove) world.remove(child, Sibling);
  else world.set(child, Sibling, { parent:0, prev:0, next:0, index:0 });
  return child;
}

function _reinsertSameParent(world, child, parent, opts){
  const s = world.get(child, Sibling), curIdx = s.index|0;
  let targetIdx = curIdx;
  if (typeof opts.index === 'number') targetIdx = Math.max(0, Math.min(childCount(world, parent), opts.index|0));
  else if (opts.before){ const bs = world.get(opts.before|0, Sibling); if (!bs || bs.parent !== parent) throw new Error('attach: before target not child of same parent'); targetIdx = bs.index|0; }
  else if (opts.after){ const as = world.get(opts.after|0, Sibling); if (!as || as.parent !== parent) throw new Error('attach: after target not child of same parent'); targetIdx = (as.index|0) + 1; }
  else { const p = world.get(parent, Parent); targetIdx = p ? p.count : curIdx; }
  if (targetIdx === curIdx) return child;
  detach(world, child);
  attach(world, child, parent, { index: targetIdx });
  return child;
}

function _bumpIndices(world, parent, startIdx, delta){
  let i=0;
  for (const c of children(world, parent)){
    if (i >= startIdx){ const s = world.get(c, Sibling); world.set(c, Sibling, { index: (s.index|0) + delta }); }
    i++;
  }
}
function _clearSibling(world, id){ if (world.has(id, Sibling)) world.set(id, Sibling, { parent:0, prev:0, next:0, index:0 }); }

/* ---- PATCH: iterative destroySubtree to avoid recursion depth issues ---- */
export function destroySubtree(world, root){
  const stack = [root];
  const order = [];
  while (stack.length){
    const id = stack.pop();
    order.push(id);
    for (const c of children(world, id)) stack.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) world.destroy(order[i]);
}

export function reparent(world, child, newParent, opts = {}){ detach(world, child); ensureParent(world, newParent); return attach(world, child, newParent, opts); }
export function indexOf(world, child){ const s = world.get(child, Sibling); return s ? (s.index|0) : -1; }
export function nthChild(world, parent, n){ const p = world.get(parent, Parent); if (!p) return 0; if (n<0 || n>=p.count) return 0; let i=0; for (const c of children(world, parent)) { if (i++===n) return c; } return 0; }
