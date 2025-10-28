// ecs/hierarchy.js
// Parent/child linked-list hierarchy (domain-neutral).
/**
 * @module ecs/hierarchy
 * Linked-list based parent/child hierarchy utilities implemented via two components:
 * - Parent: stores first/last child ids and count
 * - Sibling: stores parent link and prev/next/index among siblings
 *
 * Composition-friendly and domain-neutral; works with {@link module:ecs/core~World}.
 */

/**
 * @typedef {import('./core.js').World} World
 */

const KEY = Object.freeze({ Parent: Symbol('Parent'), Sibling: Symbol('Sibling') });

/** Parent component: tracks first/last child and count. */
export const Parent  = { key: KEY.Parent,  name: 'Parent',  defaults: Object.freeze({ first:0, last:0, count:0 }) };
/** Sibling component: holds parent id, prev/next sibling ids, and stable index. */
export const Sibling = { key: KEY.Sibling, name: 'Sibling', defaults: Object.freeze({ parent:0, prev:0, next:0, index:0 }) };

/** Ensure entity has a Parent component. @param {World} world @param {number} id @returns {number} */
export function ensureParent(world, id){ if (!world.has(id, Parent)) world.add(id, Parent, { first:0, last:0, count:0 }); return id; }
/** Is the entity a child (has Sibling)? @param {World} world @param {number} id @returns {boolean} */
export function isChild(world, id){ return world.has(id, Sibling); }
/** Get the parent id of a child or 0 if none. @param {World} world @param {number} child @returns {number} */
export function getParent(world, child){ const s = world.get(child, Sibling); return s ? s.parent|0 : 0; }

/** Iterate direct children of a parent, in stable index order. @param {World} world @param {number} parent */
export function *children(world, parent){
  const p = world.get(parent, Parent); if (!p) return;
  let c = p.first|0;
  while (c){ yield c; const s = world.get(c, Sibling); c = s ? (s.next|0) : 0; }
}

/** Iterate children and project requested component records: yields [childId, ...records].
 * @param {World} world @param {number} parent @param {...import('./core.js').Component} comps
 */
export function *childrenWith(world, parent, ...comps){
  for (const c of children(world, parent)){
    let ok = true;
    for (const k of comps){ if (!world.has(c, k)) { ok=false; break; } }
    if (ok) yield [c, ...comps.map(k=>world.get(c,k))];
  }
}

/** Number of direct children for a parent. @param {World} world @param {number} parent @returns {number} */
export function childCount(world, parent){ const p = world.get(parent, Parent); return p ? p.count|0 : 0; }

/* ---- NEW: cycle guard helper ---- */
/** @private */
function _isDescendant(world, maybeChild, maybeAncestor){
  for (let p = getParent(world, maybeChild); p; p = getParent(world, p)){
    if (p === maybeAncestor) return true;
  }
  return false;
}

/** Attach a child to a parent with optional ordering controls.
 * Options: { before?:id, after?:id, index?:number }
 * Guards against cycles and supports re-insertion within same parent.
 * @param {World} world @param {number} child @param {number} parent @param {{before?:number, after?:number, index?:number}} [opts]
 * @returns {number} child id
 */
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

/** Detach child from its current parent. If opts.remove, removes Sibling component.
 * @param {World} world @param {number} child @param {{remove?:boolean}} [opts]
 * @returns {number} child id
 */
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

/** @private */
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

/** @private */
function _bumpIndices(world, parent, startIdx, delta){
  let i=0;
  for (const c of children(world, parent)){
    if (i >= startIdx){ const s = world.get(c, Sibling); world.set(c, Sibling, { index: (s.index|0) + delta }); }
    i++;
  }
}
/** @private */
function _clearSibling(world, id){ if (world.has(id, Sibling)) world.set(id, Sibling, { parent:0, prev:0, next:0, index:0 }); }

/* ---- PATCH: iterative destroySubtree to avoid recursion depth issues ---- */
/** Destroy a node and all descendants (post-order) iteratively to avoid deep recursion.
 * @param {World} world @param {number} root
 */
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

/** Move a child under a new parent with optional ordering. @param {World} world @param {number} child @param {number} newParent @param {{before?:number, after?:number, index?:number}} [opts] */
export function reparent(world, child, newParent, opts = {}){ detach(world, child); ensureParent(world, newParent); return attach(world, child, newParent, opts); }
/** Sibling index of a child, or -1 if none. @param {World} world @param {number} child @returns {number} */
export function indexOf(world, child){ const s = world.get(child, Sibling); return s ? (s.index|0) : -1; }
/** Get the nth child id (0-based) or 0 if out of range. @param {World} world @param {number} parent @param {number} n @returns {number} */
export function nthChild(world, parent, n){ const p = world.get(parent, Parent); if (!p) return 0; if (n<0 || n>=p.count) return 0; let i=0; for (const c of children(world, parent)) { if (i++===n) return c; } return 0; }
