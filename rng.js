// ecs-js/rng.js
// Deterministic RNG utilities built around mulberry32
// Exports:
// - mulberry32(seed): () => float [0,1)
// - createRng(seed): object with bound helpers (next, float, int, choice, shuffle, shuffleInPlace, normal)
// - seedFromString(str): 32-bit FNV-1a hash for stable seeding
// - Helper fns operating on a generator: rngFloat, rngInt, rngChoice, rngShuffle, rngShuffleInPlace

/**
 * Create a mulberry32 PRNG from a 32-bit integer seed.
 * @param {number} seed - 32-bit integer seed
 * @returns {() => number} A function returning floats in [0,1)
 */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convenience: create an RNG object with common helpers bound.
 * Includes a Box–Muller normal() with internal spare caching.
 * @param {number} seed
 */
export function createRng(seed) {
  const gen = mulberry32(seed >>> 0);
  let spare = null; // cached normal deviate
  return {
    seed: seed >>> 0,
    // core
    next: gen,
    // helpers
    float: (a = 0, b = 1) => rngFloat(gen, a, b),
    int: (a, b) => rngInt(gen, a, b),
    choice: (arr) => rngChoice(gen, arr),
    shuffle: (arr) => rngShuffle(gen, arr),
    shuffleInPlace: (arr) => rngShuffleInPlace(gen, arr),
    /**
     * Normal (Gaussian) deviate using Box–Muller transform.
     * Deterministic given seed and call order.
     * @param {number} [mean=0]
     * @param {number} [std=1]
     */
    normal(mean = 0, std = 1) {
      if (spare != null) { const z = spare; spare = null; return mean + std * z; }
      // Generate two uniforms in (0,1]
      let u = 0, v = 0;
      // Avoid u==0 to prevent log(0)
      do { u = gen(); } while (u === 0);
      v = gen();
      const mag = Math.sqrt(-2.0 * Math.log(u));
      const z0 = mag * Math.cos(2 * Math.PI * v);
      const z1 = mag * Math.sin(2 * Math.PI * v);
      spare = z1;
      return mean + std * z0;
    }
  };
}

/**
 * Simple string -> numeric seed helper (FNV-1a 32-bit).
 * @param {string} str
 * @returns {number}
 */
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ===== Generator-based helpers =====

/** @param {() => number} rng @param {number} [a=0] @param {number} [b=1] */
export function rngFloat(rng, a = 0, b = 1) {
  return a + (b - a) * rng();
}

/** Inclusive int in [a,b]. @param {() => number} rng @param {number} a @param {number} b */
export function rngInt(rng, a, b) {
  const lo = Math.ceil(a);
  const hi = Math.floor(b);
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** @param {() => number} rng @param {any[]} arr */
export function rngChoice(rng, arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

/** Non-mutating Fisher–Yates. @param {() => number} rng @param {any[]} array */
export function rngShuffle(rng, array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

/** In-place Fisher–Yates. @param {() => number} rng @param {any[]} array */
export function rngShuffleInPlace(rng, array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = array[i]; array[i] = array[j]; array[j] = tmp;
  }
  return array;
}

/** Tiny self-test helper (returns true when basic invariants hold). */
export function rngSelfTest() {
  const s = 123456789;
  const r = mulberry32(s);
  const v0 = Math.floor(r() * 1e9);
  const r2 = mulberry32(s);
  const v1 = Math.floor(r2() * 1e9);
  return v0 === v1;
}
