// ecs/archetype.js
// Prefab-like entity creation.

export function defineArchetype(name, ...steps) {
  return Object.freeze({ name: String(name || 'Archetype'), steps: _norm(steps) });
}
export function compose(name, ...parts) {
  const steps = [];
  for (const p of parts) {
    if (!p) continue;
    if (_isArchetype(p)) steps.push({ use: p });
    else if (Array.isArray(p)) steps.push(..._norm(p));
    else steps.push(p);
  }
  return Object.freeze({ name: String(name || 'Composite'), steps });
}

export function createFrom(world, archetype, params = {}) {
  if (!_isArchetype(archetype)) throw new Error('createFrom: not an Archetype');
  let created = 0;
  const run = () => {
    const id = world.create(); created = id;
    _apply(world, id, archetype, params, null);
    return id;
  };
  return world.batch ? world.batch(run) : run();
}

export function createMany(world, archetype, count, paramsMaker) {
  const out = new Array(Math.max(0, count | 0));
  const run = () => {
    for (let i = 0; i < out.length; i++) {
      const id = world.create(); out[i] = id;
      const params = paramsMaker ? paramsMaker(i, id) : {};
      _apply(world, id, archetype, params, null);
    }
    return out;
  };
  return world.batch ? world.batch(run) : run();
}

export function createDeferred(world, archetype, params = {}) {
  if (!_isArchetype(archetype)) throw new Error('createDeferred: not an Archetype');
  world.command(() => createFrom(world, archetype, params));
}

export function withOverrides(archetype, overrides) {
  if (!_isArchetype(archetype)) throw new Error('withOverrides: not an Archetype');
  const ov = (overrides instanceof Map) ? new Map(overrides) : new Map();
  if (!(overrides instanceof Map)) for (const k of Object.keys(overrides || {})) ov.set(k, overrides[k]);
  return Object.freeze({ name: archetype.name + '+with', steps: [{ use: archetype, with: ov }] });
}

export function cloneFrom(world, sourceId, comps = null) {
  const all = comps ?? _allComponentsOn(world, sourceId);
  const run = () => {
    const id = world.create();
    for (const Comp of all) {
      const src = world.get(sourceId, Comp);
      if (src) world.add(id, Comp, src);
    }
    return id;
  };
  return world.batch ? world.batch(run) : run();
}

/* internals */
function _isArchetype(x) { return !!(x && Array.isArray(x.steps)); }
function _norm(steps) {
  const out = [];
  for (const s of steps) {
    if (!s) continue;
    if (typeof s === 'function') { out.push(s); continue; }
    if (Array.isArray(s) && Array.isArray(s[0])) { for (const sub of s) out.push(..._norm([sub])); continue; }
    if (Array.isArray(s)) { const [Comp, init] = s; if (!Comp || !Comp.key) throw new Error('step: expected [Component, init]'); out.push({ t: 'comp', Comp, init }); continue; }
    if (_isArchetype(s) || (s.use && _isArchetype(s.use))) { out.push({ use: s.use || s, with: s.with || null }); continue; }
    if (s.Comp && s.t === 'comp') { out.push(s); continue; }
    if (typeof s.run === 'function') { out.push((w, id, p) => s.run(w, id, p)); continue; }
    throw new Error('archetype step: unknown form');
  }
  return out;
}
function _apply(world, id, archetype, params, inheritedOverrides) {
  for (const step of archetype.steps) {
    if (step && step.use && _isArchetype(step.use)) { _apply(world, id, step.use, params, _mergeOverrides(inheritedOverrides, step.with)); continue; }
    if (typeof step === 'function') { step(world, id, params); continue; }
    if (step && step.t === 'comp') {
      const Comp = step.Comp, init = step.init;
      const base = (typeof init === 'function') ? init(params, world, id) : (init || {});
      const ov = _overrideFor(inheritedOverrides, Comp);
      const data = (typeof ov === 'function') ? ov(params, world, id, base) : (ov ? { ...base, ...ov } : base);
      world.add(id, Comp, data); continue;
    }
  }
}
function _mergeOverrides(a, b) { if (!a && !b) return null; const m = new Map(); if (a) for (const [k, v] of a) m.set(k, v); if (b) for (const [k, v] of b) m.set(k, v); return m; }
function _overrideFor(map, Comp) { if (!map) return null; if (map.has(Comp.key)) return map.get(Comp.key); if (map.has(Comp.name)) return map.get(Comp.name); return null; }
function _allComponentsOn(world, id) {
  const out = [];
  const stores = world && world._store;
  if (stores && typeof stores[Symbol.iterator] === 'function') {
    for (const entry of stores) {
      const store = Array.isArray(entry) ? entry[1] : entry;
      try { if (store && typeof store.has === 'function' && store.has(id)) { if (store._comp) out.push(store._comp); } } catch {}
    }
  }
  return out;
}
