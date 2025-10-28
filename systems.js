// ecs/systems.js
// System registration, dependency ordering, and execution.
// No built-in phases. Phases are arbitrary strings chosen by the client.

const _systems = Object.create(null);      // { phase: [ { system, before:Set, after:Set } ] }
const _explicitOrder = Object.create(null); // { phase: [fn, fn, ...] }

/** Register a system for a client-defined phase. */
export function registerSystem(system, phase, opts = {}) {
  if (typeof system !== 'function') throw new Error('registerSystem: system must be a function');
  if (typeof phase !== 'string' || !phase) throw new Error('registerSystem: phase must be a non-empty string');
  const rec = { system, before: new Set(opts.before || []), after: new Set(opts.after || []) };
  (_systems[phase] ||= []).push(rec);
}

/** Override execution order for a phase explicitly. */
export function setSystemOrder(phase, systemList) {
  if (typeof phase !== 'string' || !phase) throw new Error('setSystemOrder: phase must be a non-empty string');
  if (!Array.isArray(systemList)) throw new Error('setSystemOrder: systemList must be an array of functions');
  _explicitOrder[phase] = systemList;
}

/** Resolve the ordered list of system functions for a phase. */
export function getOrderedSystems(phase) {
  if (_explicitOrder[phase]) return _explicitOrder[phase];
  const nodes = _systems[phase] || [];
  // Build a graph: edge A->B means A must run before B
  const graph = new Map(); // fn -> Set<fn>
  nodes.forEach(({ system }) => graph.set(system, new Set()));
  nodes.forEach(({ system, before, after }) => {
    for (const dep of after)   if (graph.has(dep)) graph.get(dep).add(system); // dep -> system
    for (const dep of before)  if (graph.has(dep)) graph.get(system).add(dep); // system -> dep
  });
  const out = [];
  const visited = new Set();
  function dfs(n) {
    if (visited.has(n)) return;
    visited.add(n);
    for (const m of graph.get(n) || []) dfs(m);
    out.push(n);
  }
  graph.forEach((_, n) => dfs(n));
  return out.reverse();
}

/** Execute all systems registered under a phase. */
export function runSystems(phase, world, dt) {
  const list = getOrderedSystems(phase);
  for (let i = 0; i < list.length; i++) {
    try { list[i](world, dt); } catch (e) { console.warn(`[systems] error in phase "${phase}"`, e); }
  }
}

/** Utility: run multiple phases with no repetition boilerplate. */
export function runPhases(phases, world, dt) {
  for (const ph of phases) runSystems(ph, world, dt);
}

/** DRY helper: compose a scheduler from phases and/or custom functions.
 *  Usage:
 *    world.setScheduler(composeScheduler('intents','resolve','effects','cleanup')); or: composeScheduler('resolve', (w,dt)=>{
 */
export function composeScheduler(...steps) {
  // step ∈ string(phase) | function(world, dt)
  const norm = steps.flat().filter(Boolean).map(s => {
    if (typeof s === 'string') return (w, dt) => runSystems(s, w, dt);
    if (typeof s === 'function') return s;
    throw new Error('composeScheduler: steps must be phase names or functions');
  });
  return (world, dt) => { for (const f of norm) f(world, dt); };
}

/** Testing/hot-reload helper. */
export function clearSystems() {
  for (const k of Object.keys(_systems)) delete _systems[k];
  for (const k of Object.keys(_explicitOrder)) delete _explicitOrder[k];
}
