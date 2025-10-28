// ecs/archetype.js
// Prefab-like entity creation.
/**
 * @module ecs/archetype
 *
 * Prefab-style helpers for composing entities from a sequence of steps.
 * Steps can add components, run custom functions, or compose other archetypes.
 *
 * Key ideas:
 * - An Archetype is an immutable object: { name: string, steps: ArchetypeStep[] }.
 * - A step can be:
 *   - a function (world, id, params) => void executed after entity creation
 *   - a component tuple [Component, init], where init is an object or (params, world, id) => object
 *   - another archetype to be applied, optionally with per-component overrides
 * - Overrides can be a Map keyed by Component.key or Component.name with
 *   either a partial object patch or a function returning data given (params, world, id, baseData).
 *
 * The helpers here are designed to operate with the {@link module:ecs/core~World | World} defined in core.js.
 *
 * @example
 * import { defineComponent, World } from './core.js';
 * import { defineArchetype, createFrom, withOverrides } from './archetype.js';
 *
 * const Position = defineComponent('Position', { x:0, y:0 });
 * const Health   = defineComponent('Health',   { hp:10, max:10 });
 *
 * // Basic archetype adding two components
 * const Monster = defineArchetype('Monster',
 *   [Position, (p)=>({ x:p.x ?? 0, y:p.y ?? 0 })],
 *   [Health,   { hp:10, max:10 }]
 * );
 *
 * const world = new World();
 * const id = createFrom(world, Monster, { x:3, y:5 });
 *
 * // Extend with overrides
 * const ToughMonster = withOverrides(Monster, { Health: { hp:20, max:20 } });
 * const id2 = createFrom(world, ToughMonster, { x:1, y:1 });
 */

/**
 * @typedef {import('./core.js').World} World
 * @typedef {import('./core.js').Component} Component
 */

/**
 * @typedef {object} Archetype
 * @property {string} name - Human-readable name.
 * @property {ArchetypeStep[]} steps - Normalized list of steps to apply.
 */

/**
 * @typedef {Array} ComponentTuple
 * @property {[Component, (object|function)]} 0 - [Component, init]
 */

/**
 * @typedef {(w:World, id:number, params:object)=>void} ArchetypeFn
 */

/**
 * @typedef {object} UseStep
 * @property {Archetype} use - The nested archetype to apply.
 * @property {Map<string|symbol, (object|function)>} [with] - Per-component overrides by Component.key or Component.name.
 */

/**
 * @typedef {object} CompStep
 * @property {'comp'} t - Discriminant.
 * @property {Component} Comp - Component to add.
 * @property {(object|function)} init - Initializer object or function (params, world, id) => object.
 */

/**
 * @typedef {(ArchetypeFn|ComponentTuple|UseStep|CompStep)} ArchetypeStep
 */

/**
 * Define an immutable archetype from a list of steps.
 * Steps may be nested archetypes, component tuples, or functions.
 *
 * @param {string} name - Name for diagnostics.
 * @param {...ArchetypeStep} steps - Mixed steps; arrays will be normalized.
 * @returns {Archetype}
 */
export function defineArchetype(name, ...steps) {
  return Object.freeze({ name: String(name || 'Archetype'), steps: _norm(steps) });
}
/**
 * Compose a new archetype from parts that may already be archetypes,
 * component tuples, functions, or arrays thereof.
 *
 * @param {string} name
 * @param {...(Archetype|ArchetypeStep|ArchetypeStep[])} parts
 * @returns {Archetype}
 */
export function compose(name, ...parts) {
  const steps = [];
  for (const p of parts) {
    if (!p) continue;
    if (_isArchetype(p)) steps.push({ use: p });
    else if (Array.isArray(p)) steps.push(..._norm([p]));
    else steps.push(p);
  }
  return Object.freeze({ name: String(name || 'Composite'), steps });
}

/**
 * Create a single entity and apply an archetype to it.
 * Uses world.batch if available to wrap structural changes.
 *
 * @param {World} world
 * @param {Archetype} archetype
 * @param {object} [params]
 * @returns {number} The created entity id.
 * @throws {Error} if archetype is invalid.
 */
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

/**
 * Create many entities from an archetype.
 *
 * @param {World} world
 * @param {Archetype} archetype
 * @param {number} count - Number of entities to create.
 * @param {(i:number, id:number)=>object} [paramsMaker] - Per-entity params factory.
 * @returns {number[]} Array of created ids.
 */
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

/**
 * Defer creation of a single entity configured by an archetype.
 * The work will be queued via world.command and applied later.
 *
 * @param {World} world
 * @param {Archetype} archetype
 * @param {object} [params]
 */
export function createDeferred(world, archetype, params = {}) {
  if (!_isArchetype(archetype)) throw new Error('createDeferred: not an Archetype');
  world.command(() => createFrom(world, archetype, params));
}

/**
 * Return a wrapped archetype that applies per-component overrides.
 * Overrides can be provided as a Map keyed by Component.key or Component.name,
 * or as a plain object with those keys.
 * Values may be partial objects merged into the base init, or a function
 * (params, world, id, baseInit) => object to compute final data.
 *
 * @param {Archetype} archetype
 * @param {Map<string|symbol,(object|function)>|Record<string|symbol, (object|function)>} overrides
 * @returns {Archetype}
 */
export function withOverrides(archetype, overrides) {
  if (!_isArchetype(archetype)) throw new Error('withOverrides: not an Archetype');
  const ov = (overrides instanceof Map) ? new Map(overrides) : new Map();
  if (!(overrides instanceof Map)) for (const k of Object.keys(overrides || {})) ov.set(k, overrides[k]);
  return Object.freeze({ name: archetype.name + '+with', steps: [{ use: archetype, with: ov }] });
}

/**
 * Clone a source entity's components onto a new entity.
 * If comps is omitted, attempts to add all components present on sourceId.
 *
 * Notes:
 * - Component records are shallow-cloned by world.add; mutables inside are not deep-frozen.
 * - Uses world.batch if available.
 *
 * @param {World} world
 * @param {number} sourceId
 * @param {Component[]|null} [comps]
 * @returns {number} The new entity id.
 */
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
/** @private */
function _isArchetype(x) { return !!(x && Array.isArray(x.steps)); }
/** @private */
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
/** @private */
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
/** @private */
function _mergeOverrides(a, b) { if (!a && !b) return null; const m = new Map(); if (a) for (const [k, v] of a) m.set(k, v); if (b) for (const [k, v] of b) m.set(k, v); return m; }
/** @private */
function _overrideFor(map, Comp) { if (!map) return null; if (map.has(Comp.key)) return map.get(Comp.key); if (map.has(Comp.name)) return map.get(Comp.name); return null; }
/** @private */
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
