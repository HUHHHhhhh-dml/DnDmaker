/**
 * PRNG determinista del motor de combate.
 *
 * - Semilla string → hash xmur3 de 32 bits.
 * - Generador mulberry32 (rápido, sin dependencias, reproducible).
 * - No usa `Math.random` en ningún punto.
 *
 * Para que la resolución sobreviva a guardar/recargar el estado, cada ronda
 * usa una corriente derivada de `seed:round`; no hay un cursor mutable que
 * perder.
 */

export interface Rng {
  /** Siguiente número en [0, 1). */
  next(): number;
  /** Entero en [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Hash xmur3: convierte una semilla arbitraria en 32 bits. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    h = Math.imul(h ^ seed.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Mulberry32: secuencia determinista de 32 bits. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): Rng {
  const next = mulberry32(hashSeed(seed));
  return {
    next,
    int(maxExclusive: number): number {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
      return Math.floor(next() * Math.floor(maxExclusive));
    },
  };
}

/** Corriente independiente por ronda: la misma seed+ronda da lo mismo. */
export function createRoundRng(seed: string, round: number): Rng {
  return createRng(`${seed}:round:${round}`);
}
