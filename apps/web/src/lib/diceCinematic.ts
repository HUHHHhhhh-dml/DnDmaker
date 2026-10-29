import { useSyncExternalStore } from "react";
import type { DiceRoll } from "@protocol-life/shared";
import { isPhysicalDiceRoll } from "./dice3d/roll";

/**
 * Coordinación entre el overlay 3D y los pops actuales (toast y celebración).
 *
 * El overlay anima tiradas de **dados con física** (uno o varios cuerpos). Mientras
 * una tirada está en manos del overlay, el toast y la celebración la ignoran;
 * cuando aterriza (o falla), se marca y vuelven a procesarla. Si no hay WebGL o
 * el usuario prefiere movimiento reducido, `isHeld` es siempre `false` y todo
 * funciona como antes.
 *
 * El estado vive a nivel de módulo porque el header se remonta al cambiar de
 * vista, igual que los `Set` de ids de los pops existentes.
 */

type RollKey = Pick<
  DiceRoll,
  "id" | "sides" | "count" | "results" | "trajectory" | "trajectories"
>;

export { isSingleD20 } from "./dice3d/roll";

const REMEMBER_LIMIT = 40;

const landed = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

let capability: boolean | null = null;
let disabled = false;
let directors = 0;
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function remember(target: Set<string>, id: string): void {
  target.add(id);
  if (target.size <= REMEMBER_LIMIT) return;
  const oldest = target.values().next().value;
  if (oldest !== undefined) target.delete(oldest);
}

/**
 * ¿Se puede usar el overlay 3D en este navegador? Se cachea porque sondear
 * WebGL crea un contexto. `failIfMajorPerformanceCaveat` descarta render por
 * software: ahí el pop se ve mejor que una animación a 5 fps.
 */
export function supportsDiceCinematic(): boolean {
  if (disabled) return false;
  if (capability !== null) return capability;

  if (typeof window === "undefined" || typeof document === "undefined") {
    capability = false;
    return capability;
  }

  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      capability = false;
      return capability;
    }
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!gl) {
      capability = false;
      return capability;
    }
    // Libera el contexto de sondeo; los navegadores limitan cuántos hay vivos.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    capability = true;
  } catch {
    capability = false;
  }

  return capability;
}

/** El overlay se registra mientras está montado. */
export function registerCinematic(): () => void {
  directors += 1;
  return () => {
    directors = Math.max(0, directors - 1);
  };
}

/**
 * ¿Está esta tirada reservada por el overlay 3D? Si es así, toast y celebración
 * deben esperar a `markLanded`/`markFailed`.
 */
export function isHeld(roll: RollKey): boolean {
  if (directors === 0) return false;
  if (!isPhysicalDiceRoll(roll)) return false;
  if (!supportsDiceCinematic()) return false;
  return !landed.has(roll.id) && !failed.has(roll.id);
}

export function markLanded(id: string): void {
  if (landed.has(id)) return;
  remember(landed, id);
  emit();
}

export function markFailed(id: string): void {
  if (failed.has(id)) return;
  remember(failed, id);
  emit();
}

/**
 * Un fallo del chunk o del contexto WebGL desactiva el 3D para el resto de la
 * sesión: es preferible el pop a reintentar la animación en cada tirada.
 */
export function disableDiceCinematic(): void {
  if (disabled) return;
  disabled = true;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return version;
}

/** Re-renderiza a toast/celebración cuando una tirada deja de estar retenida. */
export function useDiceCinematicVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
