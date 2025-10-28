// ecs/serialization.js
// Snapshot (serialize/deserialize/apply) utilities
/**
 * @module ecs/serialization
 * Serialize and restore World state as plain JSON snapshots. Flexible include/exclude,
 * registry-based component resolution, and append/replace application modes.
 */

/**
 * @typedef {import('./core.js').World} World
 * @typedef {import('./core.js').Component} Component
 */

/**
 * @typedef {object} SnapshotMeta
 * @property {number} seed
 * @property {number} frame
 * @property {number} time
 * @property {string} store - Store mode (e.g., 'map' | 'soa').
 * @property {string} [note]
 */

/**
 * @typedef {object} Snapshot
 * @property {1} v - Version marker.
 * @property {SnapshotMeta} meta
 * @property {Record<string, Array<[number, object]>>} comps - Map of component name to rows [id, record].
 * @property {number[]} alive - Alive entity ids (optional if derivable from comps).
 */

/**
 * @typedef {Map<string, Component> | Record<string, Component>} Registry
 */

/** Build a name->Component registry from components or arrays of components.
 * Later used for deserialization to map names to constructors.
 * @param {...(Component|Component[]) } comps
 * @returns {Map<string, Component>}
 */
export function makeRegistry(...comps) {
  const reg = new Map();
  for (const c of comps.flat()) if (c && c.key && typeof c.name === 'string') reg.set(c.name, c);
  return reg;
}

/** Serialize the entire world into a snapshot.
 * @param {World} world
 * @param {{ include?: string[]|Set<string>|string, exclude?: string[], pickEntity?:(id:number)=>boolean, note?:string }} [opts]
 * @returns {Snapshot}
 */
export function serializeWorld(world, opts = {}) {
  const pickEntity = opts.pickEntity || (() => true);
  const include = _normalizeInclude(opts.include);
  const exclude = new Set(opts.exclude || []);
  const comps = {};
  const alive = Array.from(world.alive).sort((a, b) => a - b).filter(pickEntity);

  for (const [ckey, store] of world._store) {
    const name = _guessCompName(world, ckey, store);
    if (!name) continue;
    if (include && !include.has(name)) continue;
    if (exclude.has(name)) continue;

    const rows = [];
    const ids = store.entityIds ? store.entityIds() : alive;
    for (const id of ids) {
      if (!world.alive.has(id)) continue;
      if (!pickEntity(id)) continue;
      const rec = store.get ? store.get(id) : world.get(id, _lookupCompByName(world, name));
      if (!rec) continue;
      rows.push([id, _clonePlain(rec)]);
    }
    if (rows.length) comps[name] = rows;
  }

  const meta = {
    seed: world.seed >>> 0,
    frame: world.frame | 0,
    time: +world.time || 0,
    store: world.storeMode || (_guessStore(world) || 'map'),
    note: opts.note || undefined
  };
  return { v: 1, meta, comps, alive };
}

/** Serialize a subset of entities.
 * @param {World} world @param {number[]} ids @param {Parameters<typeof serializeWorld>[1]} [opts]
 * @returns {Snapshot}
 */
export function serializeEntities(world, ids, opts = {}) {
  const set = new Set(ids.filter(id => world.alive.has(id)));
  return serializeWorld(world, { ...opts, pickEntity: (id) => set.has(id) });
}

/** Serialize a single entity as a Snapshot. @param {World} world @param {number} id @param {Parameters<typeof serializeWorld>[1]} [opts] */
export function serializeEntity(world, id, opts = {}) {
  return serializeEntities(world, [id], opts);
}

/** Construct a new World and populate it from a snapshot.
 * @param {Snapshot} data
 * @param {Registry} registry - Component registry by name.
 * @param {{ World?: new (opts:any)=>World, seed?:number, store?:string }} [opts]
 * @returns {World}
 */
export function deserializeWorld(data, registry, opts = {}) {
  const storeMode = opts.store || (data?.meta?.store) || undefined;
  const seed = (opts.seed != null) ? (opts.seed >>> 0) : (data?.meta?.seed >>> 0);
  const WorldCtor = opts.World || (globalThis.World);
  if (!WorldCtor) throw new Error('deserializeWorld: supply opts.World or expose World globally');

  const w = new WorldCtor({ seed, store: storeMode });
  return applySnapshot(w, data, registry, opts);
}

/** Apply a snapshot to an existing world.
 * @param {World} world
 * @param {Snapshot} data
 * @param {Registry} registry
 * @param {{ mode?: 'replace'|'append', skipUnknown?: boolean, remapId?:(oldId:number)=>number }} [opts]
 * @returns {World}
 */
export function applySnapshot(world, data, registry, opts = {}) {
  _assertSnapshot(data);

  const mode = opts.mode || 'replace'; // 'replace' | 'append'
  const mapNameToComp = _normalizeRegistry(registry);
  const remap = opts.remapId || null;

  return world.batch?.(() => _apply()) ?? _apply();

  function _apply() {
    if (mode === 'replace') {
      for (const id of Array.from(world.alive)) world.destroy(id);
    }
    const idMap = new Map();
    const sourceAlive = (data.alive || _collectAliveFromComps(data)).sort((a, b) => a - b);
    for (const oldId of sourceAlive) {
      const newId = remap ? (remap(oldId) | 0) || world.create() : world.create();
      idMap.set(oldId, newId);
    }
    for (const [name, rows] of Object.entries(data.comps || {})) {
      const Comp = mapNameToComp.get(name);
      if (!Comp) { if (!opts.skipUnknown) throw new Error(`applySnapshot: unknown component '${name}'`); continue; }
      for (const [oldId, payload] of rows) {
        const id = idMap.get(oldId);
        if (!id) continue;
        world.add(id, Comp, _clonePlain(payload));
      }
    }
    if (data.meta) {
      world.time = +data.meta.time || world.time || 0;
      world.frame = (data.meta.frame | 0) || world.frame || 0;
    }
    return world;
  }
}

/* helpers */
/** @private */
function _normalizeInclude(val) { if (!val) return null; if (val instanceof Set) return val; return new Set(Array.isArray(val) ? val : [val]); }
/** @private */
function _assertSnapshot(d) { if (!d || typeof d !== 'object' || d.v !== 1 || !d.comps) throw new Error('snapshot: invalid format'); }
/** @private */
function _normalizeRegistry(reg) { if (!reg) throw new Error('registry required'); if (reg instanceof Map) return reg; const m = new Map(); for (const [k, v] of Object.entries(reg)) m.set(k, v); return m; }
/** @private */
function _clonePlain(x) { if (!x || typeof x !== 'object') return x; return JSON.parse(JSON.stringify(x)); }
/** @private */
function _guessCompName(world, ckey, store) { if (store?._comp?.name) return store._comp.name; const d = ckey?.description; return (typeof d === 'string') ? d : null; }
/** @private */
function _lookupCompByName(world, name) { for (const [ck, s] of world._store) { const n = _guessCompName(world, ck, s); if (n === name && s._comp) return s._comp; } return null; }
/** @private */
function _collectAliveFromComps(data) { const s = new Set(); for (const rows of Object.values(data.comps || {})) for (const [id] of rows) s.add(id | 0); return Array.from(s); }
/** @private */
function _guessStore(world) { return world.storeMode || 'map'; }
