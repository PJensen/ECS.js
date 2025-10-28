// ecs/crossWorld.js
// Cross-world (multi-world) entity references (optional utility).
// Patched to avoid reliance on non-existent World APIs and to be backward-compatible
// with { entityId } while also supporting { id }.

export function createCrossWorldReference(world, id){
  const eid = id|0;
  // store both keys for compatibility with any existing callers
  return { world, id: eid, entityId: eid };
}

function _aliveHas(world, id){
  if (!world) return false;
  if (typeof world.isAlive === 'function') return !!world.isAlive(id);
  return !!world.alive?.has?.(id);
}

export function isCrossWorldReferenceValid(ref){
  const id = ref?.id ?? ref?.entityId;
  return !!(ref && ref.world && typeof id === 'number' && _aliveHas(ref.world, id));
}

// Return the raw entity id if valid, otherwise 0 (falsy sentinel).
// Consumers can then use world.get(id, Comp) as usual.
export function resolveCrossWorldReference(ref){
  return isCrossWorldReferenceValid(ref) ? (ref.id ?? ref.entityId) : 0;
}
