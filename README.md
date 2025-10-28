# ecs-js

Entity–Component–System architecture for JavaScript
Zero dependencies. No build step. Deterministic, phase-agnostic, and caller-driven — your loop, your rules.

Suitable for both discrete-event and real-time updates.

`ecs-js` is a minimal, browser-friendly ECS core designed for simulations, roguelikes, and other logic-driven systems that demand determinism and composability.

---

## ✳️ Design Principles

**Caller-driven**
 You decide when and how often a tick runs — from discrete events to real-time loops.

**Phase-agnostic**
 Define your own lifecycle phases (`"intent"`, `"resolve"`, `"effects"`, etc.).

**Deterministic**
 Built-in seeded RNG (`mulberry32`) ensures reproducible runs.

**Deferred-safe**
 Structural mutations during iteration are automatically queued.

**Store-flexible**
 `'map'` for clarity, `'soa'` for raw performance.

**Pure logic**
 No rendering or timing assumptions — plug into any UI, engine, or visualization layer.

---

## 🧩 Core Concepts

### World

```js
import { World } from 'ecs-js/core.js'
const world = new World({ seed: 12345, store: 'map' })
```

A `World` manages all entities, components, and systems.
Each call to `world.tick(dt)` advances the simulation deterministically by one step.

---

### Components

```js
import { defineComponent, defineTag } from 'ecs-js/core.js'

export const Position = defineComponent('Position', { x: 0, y: 0 })
export const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 })
export const Visible  = defineTag('Visible')
```

Components are pure data containers.
Tags are zero-data markers for boolean traits or group membership.

---

### Entities

```js
const e = world.create()
world.add(e, Position, { x: 10, y: 5 })
world.add(e, Velocity, { dx: 1, dy: 0 })
```

Entities are lightweight IDs with dynamically attached components.

---

### Queries

```js
for (const [id, pos, vel] of world.query(Position, Velocity)) {
  pos.x += vel.dx
  pos.y += vel.dy
}
```

Queries return iterable tuples.
Supports `Not(Comp)`, `Changed(Comp)`, and query options like `orderBy`, `limit`, and `offset`.

---

## ⚙️ Systems & Scheduling

Systems are pure functions operating over queries.
You register them under named phases and compose those phases into a scheduler.

```js
import { registerSystem, composeScheduler } from 'ecs-js/systems.js'

function moveSystem(world) {
  for (const [id, pos, vel] of world.query(Position, Velocity)) {
    world.set(id, Position, { x: pos.x + vel.dx, y: pos.y + vel.dy })
  }
}

registerSystem(moveSystem, 'update')
world.setScheduler(composeScheduler('update'))
world.tick(1)
```

Each phase name is arbitrary — you decide the lifecycle.
System order can be declared via `before` / `after` or pinned explicitly with `setSystemOrder`.

---

🛰️ Events & Messaging

The world includes a built-in event bus for lightweight signaling between systems or external logic.

```js
// Subscribe
const unsubscribe = world.on('damage', (payload, world) => {
  console.log('damage event:', payload)
})

// Emit
world.emit('damage', { id: 1, amount: 10 })

// Unsubscribe
unsubscribe()
```


Events are synchronous and scoped per World.

Each listener receives (payload, world) arguments.

Useful for decoupling input handlers, UI triggers, or cross-system notifications.

---

## 🌳 Hierarchies

```js
import { attach, detach, children, destroySubtree } from 'ecs-js/hierarchy.js'

const parent = world.create()
const child  = world.create()
attach(world, child, parent)

for (const c of children(world, parent))
  console.log('child', c)

attach() prevents cycles automatically.
destroySubtree() is iterative to avoid recursion limits.
```

---

## 🌐 Cross-World References

```js
import { createCrossWorldReference, resolveCrossWorldReference } from 'ecs-js/crossWorld.js'

const ref = createCrossWorldReference(worldA, entityId)
const id = resolveCrossWorldReference(ref)
```

Enables entity references that remain valid across multiple `World` instances — ideal for multi-scene simulations or client/server worlds.
Works seamlessly with `world.isAlive(id)` (O(1) Set check).

---

## 🧱 Archetypes

Prefab-style entity definitions for repeatable or composite setups.

```js
import { defineArchetype, compose, createFrom, createMany, cloneFrom } from 'ecs-js/archetype.js'

// --- Define a base archetype ---
export const MovingEntity = defineArchetype('MovingEntity',
  [Position, { x: 0, y: 0 }],
  [Velocity, { dx: 0, dy: 0 }],
  (world, id) => world.add(id, Visible)
)

// --- Compose from other archetypes ---
export const Player = compose('Player', MovingEntity, [Velocity, { dx: 1, dy: 0 }])

// --- Create entities from archetypes ---
const e = createFrom(world, Player)
const swarm = createMany(world, MovingEntity, 10, i => ({ x: i * 2, y: 0 }))
```

Supports composition, deferred creation (`createDeferred`), and parameterized overrides via `withOverrides()`.
Archetypes can nest, clone existing entities, or define reusable spawn logic.

---

## 💾 Serialization

```js
import { serializeWorld, deserializeWorld, makeRegistry } from 'ecs-js/serialization.js'

const reg = makeRegistry(Position, Velocity, Visible)
const snap = serializeWorld(world)
const clone = deserializeWorld(snap, reg, { World })
```

Serialization is schema-driven via a component registry, ensuring name-based round-tripping across runs.
Snapshots include metadata: seed, frame, store, and time.
Supports filters, partial exports, and append/replace modes.

---

## 🧠 System Ordering

```js
registerSystem(fn, phase, { before, after })
setSystemOrder(phase, [fnA, fnB])
```

Deterministic, topologically sorted order between systems within each phase.

---

## 🧱 Store Modes

* `'map'` – HashMap per component, simple and readable
* `'soa'` – Struct-of-Arrays, optimized for numeric and heavy iteration workloads

---

## 🧰 Utilities Summary

| File                 | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| **core.js**          | World, Components, Queries, Deferred ops         |
| **systems.js**       | System registration, ordering, composition       |
| **hierarchy.js**     | Parent–child tree operations                     |
| **serialization.js** | Snapshot, registry, deserialization              |
| **crossWorld.js**    | Entity linking across worlds                     |
| **archetype.js**     | Prefab-style archetypes and reusable spawn logic |

---

## 🚀 Usage Examples

### 1. As a Git Submodule

```bash
git submodule add https://github.com/your-org/ecs-js.git lib/ecs-js
git commit -m "Add ecs-js as submodule"
```

### 2. Integrating ecs-js with requestAnimationFrame

This example connects a turn-based ECS world to a render loop using the browser’s native requestAnimationFrame.

The ECS remains deterministic and pure — rendering is handled externally.

```js
import { World, defineComponent } from '../core.js'
import { registerSystem, composeScheduler } from '../systems.js'

// --- Components ---
const Position = defineComponent('Position', { x: 0, y: 0 })
const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 })

// --- Systems ---
function moveSystem(world) {
  for (const [id, pos, vel] of world.query(Position, Velocity)) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}

function renderSystem(world) {
  const ctx = world.ctx
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = 'lime'
  for (const [id, pos] of world.query(Position)) {
    ctx.fillRect(pos.x, pos.y, 8, 8)
  }
}

// --- Setup ---
const canvas = document.createElement('canvas')
canvas.width = 320
canvas.height = 240
document.body.appendChild(canvas)

const world = new World({ seed: 1 })
world.ctx = canvas.getContext('2d')

registerSystem(moveSystem, 'update')
registerSystem(renderSystem, 'render')
world.setScheduler(composeScheduler('update', 'render'))

// --- Entities ---
const e = world.create()
world.add(e, Position, { x: 10, y: 10 })
world.add(e, Velocity, { dx: 0.5, dy: 0.25 })

// --- Render Loop ---
let last = performance.now()
function frame(now) {
  const dt = (now - last) / 16.6667 // ~1 = 60fps
  last = now
  world.tick(dt)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

### 3. Serialization Example

```js
import { World, defineComponent, defineTag } from './core.js'
import { serializeWorld, makeRegistry } from './serialization.js'

// Components (examples)
const Position = defineComponent('Position', { x: 0, y: 0 })
const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 })
const Visible  = defineTag('Visible')

// Build a world with a couple entities
const world = new World({ seed: 1234 })
const e = world.create()
world.add(e, Position, { x: 10, y: 5 })
world.add(e, Velocity, { dx: 1, dy: 0 })
world.add(e, Visible)

// Create a registry so names round-trip
const reg = makeRegistry(Position, Velocity, Visible)

// Serialize the entire world
const snapshot = serializeWorld(world)

// Download helper
function downloadJSON(obj, filename = 'world-snapshot.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// Trigger save
downloadJSON(snapshot)
```

---

## 🧠 Notes

* The ECS has no built-in `requestAnimationFrame`, so simulation remains deterministic and replayable.
* You control the time step (`dt`) passed to `world.tick(dt)`.
* Rendering is just another system phase (`'render'`), which can use WebGL, Canvas2D, or DOM updates.
* Works seamlessly with snapshot/replay systems — only the visual layer depends on real time.

---

## 📦 Install

```bash
npm install ecs-js
```

or directly in the browser:

```html
<script type="module" src="ecs/core.js"></script>
```

---

## ⚖️ License

MIT © 2025 Pete Jensen
Lightweight, deterministic, and proudly build-free.
