// ecs/crossWorld.js
// Cross-world (multi-world) entity references (optional utility).
// Patched to avoid reliance on non-existent World APIs and to be backward-compatible
// with { entityId } while also supporting { id }.
/**
 * @module ecs/crossWorld
 * Utilities for holding references to entities that include their originating World.
 * Helpful when passing entity handles between systems spanning multiple worlds.
 */

/**
 * @typedef {import('./core.js').World} World
 */

/**
 * @typedef {object} CrossWorldRef
 * @property {World} world - Source world of the entity.
 * @property {number} id - Entity id (redundant with entityId for compatibility).
 * @property {number} entityId - Entity id (legacy name).
 */

/**
 * Create a stable cross-world reference to an entity id.
 * @param {World} world
 * @param {number} id
 * @returns {CrossWorldRef}
 */
export function createCrossWorldReference(world, id){
  const eid = id|0;
  // store both keys for compatibility with any existing callers
  return { world, id: eid, entityId: eid };
}

/** @private */
function _aliveHas(world, id){
  if (!world) return false;
  if (typeof world.isAlive === 'function') return !!world.isAlive(id);
  return !!world.alive?.has?.(id);
}

/**
 * Validate that a cross-world reference points to a currently alive entity.
 * @param {Partial<CrossWorldRef>} ref
 * @returns {boolean}
 */
export function isCrossWorldReferenceValid(ref){
  const id = ref?.id ?? ref?.entityId;
  return !!(ref && ref.world && typeof id === 'number' && _aliveHas(ref.world, id));
}

// Return the raw entity id if valid, otherwise 0 (falsy sentinel).
// Consumers can then use world.get(id, Comp) as usual.
/**
 * Resolve a cross-world ref into its raw entity id, or 0 if invalid.
 * @param {Partial<CrossWorldRef>} ref
 * @returns {number}
 */
export function resolveCrossWorldReference(ref){
  return isCrossWorldReferenceValid(ref) ? (ref.id ?? ref.entityId) : 0;
}
