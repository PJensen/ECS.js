// Demo that touches most ecs-js features
// Open demo/index.html in a browser

import {
  World, defineComponent, defineTag, Not, Changed
} from '../core.js';
import {
  defineArchetype, compose, createFrom, createMany, createDeferred, withOverrides, cloneFrom
} from '../archetype.js';
import {
  registerSystem, setSystemOrder, getOrderedSystems, runSystems, runPhases, composeScheduler, clearSystems
} from '../systems.js';
import {
  Parent, Sibling, ensureParent, isChild, getParent, children, childrenWith, childCount, attach, detach, destroySubtree, reparent, indexOf, nthChild
} from '../hierarchy.js';
import {
  createCrossWorldReference, isCrossWorldReferenceValid, resolveCrossWorldReference
} from '../crossWorld.js';
import {
  makeRegistry, serializeWorld, serializeEntities, serializeEntity, deserializeWorld, applySnapshot
} from '../serialization.js';

const out = document.getElementById('out');
const log = (msg, cls='') => { out.textContent += (out.textContent ? '\n' : '') + msg; if (cls) out.classList.add(cls); };
out.textContent = '';

// ----- Components -----
const Position = defineComponent('Position', { x: 0, y: 0 }, {
  validate: (r) => Number.isFinite(r.x) && Number.isFinite(r.y)
});
const Health   = defineComponent('Health',   { hp: 10, max: 10 });
const Name     = defineComponent('Name',     { value: 'anon' });
const Visible  = defineTag('Visible');

// ----- World -----
const world = new World({ seed: 0xC0FFEE, store: 'map' });
log(`World created (seed=${world.seed})`);

// Events
const offSpawn = world.on('spawn', (p) => log(`Spawn event: ${JSON.stringify(p)}`));

// ----- Archetypes -----
const Actor = defineArchetype('Actor',
  [Position, (p)=>({ x: p.x ?? 0, y: p.y ?? 0 })],
  [Health,   { hp: 12, max: 12 }],
  (w, id, p) => w.add(id, Name, { value: p.name ?? 'actor' })
);
const VisibleActor = withOverrides(Actor, { Visible: {}, Health: (p, w, id, base) => ({ ...base, hp: Math.min(base.max, base.hp + 3) }) });
const ActorPlus = compose('ActorPlus', Actor, [Visible, {}]);

const a1 = createFrom(world, Actor, { name: 'hero', x: 2, y: 3 });
log(`createFrom -> id=${a1}`);
const many = createMany(world, ActorPlus, 3, (i)=>({ name: 'm'+i, x: i, y: i }));
log(`createMany -> ids=${many.join(',')}`);
createDeferred(world, VisibleActor, { name: 'late', x: 9, y: 9 });
log('createDeferred scheduled (will materialize on tick)');

// ----- Systems & Scheduler -----
clearSystems();
const intentPhase = 'intent', updatePhase = 'update', renderPhase = 'render';
registerSystem((w)=>{ w.emit('spawn', { phase:intentPhase }); }, intentPhase);
registerSystem((w)=>{ for (const [id, pos] of w.query(Position)) { pos.x += 1; } }, updatePhase);
registerSystem((w)=>{ /* no-op render */ }, renderPhase);
setSystemOrder(updatePhase, getOrderedSystems(updatePhase));

world.setScheduler(composeScheduler(intentPhase, updatePhase, renderPhase));
world.tick(1);
log('tick(1) executed (deferred entity created, positions advanced)');

// ----- Queries -----
// Flag one entity as changed (simulate)
world.set(a1, Position, { x: world.get(a1, Position).x + 1 });
const q = [...world.query(Position, Not(Visible))];
log(`query(Position, Not(Visible)) -> ${q.length} tuples`);
const q2 = [...world.query(Position, Changed(Position), { where: (pos)=>pos.x>0, project: (id, pos)=>({ id, x: pos.x }), orderBy: (A,B)=>A.x-B.x })];
log(`query(Position, Changed(Position), opts) -> ${q2.map(r=>r.id+':'+r.x).join(', ')}`);

// ----- Hierarchy -----
ensureParent(world, a1);
for (const id of many) attach(world, id, a1); // append
log(`children count (a1) -> ${childCount(world, a1)}`);
const before = many[1];
const extra = createFrom(world, Actor, { name: 'inserted' });
attach(world, extra, a1, { before });
log(`indexOf(extra) -> ${indexOf(world, extra)}, nthChild(a1,1) -> ${nthChild(world, a1, 1)}`);

// ----- Cross-world refs -----
const ref = createCrossWorldReference(world, a1);
log(`xworld ref valid? ${isCrossWorldReferenceValid(ref)} resolves to ${resolveCrossWorldReference(ref)}`);

// ----- Serialization -----
const reg = makeRegistry(Position, Health, Name, Visible, Parent, Sibling);
const snap = serializeWorld(world, { note: 'demo-snap' });
log(`serializeWorld -> comps=${Object.keys(snap.comps).length}, alive=${snap.alive.length}`);
const clone = deserializeWorld(snap, reg, { World });
log(`deserializeWorld -> new World with alive=${clone.alive.size}`);

// ----- Clone entity -----
const c1 = cloneFrom(world, a1);
log(`cloneFrom -> ${c1}`);

// ----- Deferral example -----
world.command(['remove', a1, Visible]);
log('Deferred: remove Visible from a1');
world.tick(1);
log('tick(1) executed (deferred removal applied)');

// Cleanup
offSpawn();

log('\nDemo complete.', 'ok');
