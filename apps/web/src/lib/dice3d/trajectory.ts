import { Quaternion, Vector3 } from "three";
import {
  DIE_REST_Y,
  type DiceTrajectory,
  type DiceTrajectoryImpact,
} from "@protocol-life/shared";

/**
 * Reproduce en el cliente la trayectoria grabada por el servidor.
 *
 * El servidor ya ha decidido la cara y ha grabado la caída; aquí no hay física
 * ni búsqueda: solo interpolación de posiciones y quaternions. El último frame
 * es la pose de reposo y su cara superior es el resultado de la tirada.
 */

const RING_MS = 380;

export interface DicePose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly glow: number;
  readonly shadowScale: number;
  readonly shadowOpacity: number;
  readonly contactGlow: number;
  readonly ringScale: number;
  readonly ringOpacity: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function ringAt(
  tMs: number,
  impacts: readonly DiceTrajectoryImpact[],
): { scale: number; opacity: number } {
  let latest: DiceTrajectoryImpact | null = null;
  for (const impact of impacts) {
    if (tMs < impact.atMs || tMs > impact.atMs + RING_MS) continue;
    if (!latest || impact.atMs > latest.atMs) latest = impact;
  }
  if (!latest) return { scale: 0.6, opacity: 0 };

  const u = clamp01((tMs - latest.atMs) / RING_MS);
  return {
    scale: 0.6 + 1.3 * u,
    opacity: latest.strength * 0.8 * (1 - u) ** 2,
  };
}

export function sampleTrajectory(
  tMs: number,
  trajectory: DiceTrajectory,
  restY = DIE_REST_Y,
): DicePose {
  const frames = trajectory.frames;
  if (frames.length < 2) {
    throw new Error("La trayectoria del d20 necesita al menos dos frames");
  }

  const duration = Math.max(1, trajectory.durationMs);
  const t = Math.min(duration, Math.max(0, tMs));
  const last = frames.length - 1;

  // Los frames se grabaron a intervalos regulares; el último es el reposo.
  const u = (t / duration) * last;
  const index = Math.min(last, Math.floor(u));
  const next = Math.min(last, index + 1);
  const alpha = index === last ? 0 : u - index;

  const a = frames[index]!;
  const b = frames[next]!;
  const position = new Vector3(a.p[0], a.p[1], a.p[2]).lerp(
    new Vector3(b.p[0], b.p[1], b.p[2]),
    alpha,
  );
  const quaternion = new Quaternion(a.q[0], a.q[1], a.q[2], a.q[3]).slerp(
    new Quaternion(b.q[0], b.q[1], b.q[2], b.q[3]),
    alpha,
  );

  // En el instante final, copia exacta del último frame (sin deriva).
  if (t >= duration) {
    const final = frames[last]!;
    position.set(final.p[0], final.p[1], final.p[2]);
    quaternion.set(final.q[0], final.q[1], final.q[2], final.q[3]);
  }

  const clearance = Math.max(0, position.y - restY);
  const shadowScale = 1 / (1 + clearance * 1.7);
  const shadowOpacity = 0.7 / (1 + clearance * 1.1);
  const contactGlow = 0.26 + 0.34 * (1 - clamp01(clearance / 2.2));
  const ring = ringAt(t, trajectory.impacts);

  return {
    position,
    quaternion,
    glow:
      t >= duration
        ? 1
        : smoothstep((t - (duration - 500)) / 500),
    shadowScale,
    shadowOpacity,
    contactGlow,
    ringScale: ring.scale,
    ringOpacity: ring.opacity,
  };
}
