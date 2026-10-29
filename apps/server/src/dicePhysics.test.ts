import { describe, expect, it } from "vitest";
import {
  D20_FACES,
  D20_TABLE_BOUNDS,
  DIE_REST_Y,
  DIE_SCALE,
  type DiceTrajectory,
} from "@protocol-life/shared";
import { simulateD20Roll, simulateD20Throw } from "./dicePhysics";

/**
 * Física pura del d20: rebotes controlados por el gesto, caras reales y varios
 * dados en el mismo mundo. Sin HTTP ni base de datos.
 */

const THROW = {
  velocity: [0, -2.6, 0] as [number, number, number],
  angular: [0, 0, 0] as [number, number, number],
  start: [0, 0] as [number, number],
};

/** Rota un vector por un cuaternión [x, y, z, w]. */
function rotate(
  [x, y, z]: readonly [number, number, number],
  [qx, qy, qz, qw]: readonly [number, number, number, number],
): [number, number, number] {
  // v' = v + 2 * q_vec × (q_vec × v + w * v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

function faceFromFinalFrame(trajectory: DiceTrajectory): number {
  const final = trajectory.frames[trajectory.frames.length - 1]!;
  let best = -Infinity;
  let face = 0;
  for (const candidate of D20_FACES) {
    const [, y] = rotate(candidate.normal, final.q);
    if (y > best) {
      best = y;
      face = candidate.number;
    }
  }
  return face;
}

function finalPosition(trajectory: DiceTrajectory): [number, number, number] {
  return trajectory.frames[trajectory.frames.length - 1]!.p;
}

function minPairDistance(trajectories: readonly DiceTrajectory[]): number {
  const frames = Math.min(
    ...trajectories.map((trajectory) => trajectory.frames.length),
  );
  let min = Infinity;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let a = 0; a < trajectories.length; a += 1) {
      for (let b = a + 1; b < trajectories.length; b += 1) {
        const p = trajectories[a]!.frames[frame]!.p;
        const q = trajectories[b]!.frames[frame]!.p;
        min = Math.min(
          min,
          Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]),
        );
      }
    }
  }
  return min;
}

describe("rebotes contra la mesa", () => {
  for (const bounces of [1, 2, 3, 4]) {
    it(`clava ${bounces} rebote${bounces === 1 ? "" : "s"} con la cara física`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const trajectory = simulateD20Throw({
          seed,
          throw: { ...THROW, bounces },
        });
        expect(trajectory, `seed ${seed}`).not.toBeNull();
        expect(trajectory!.bounces, `seed ${seed}`).toBe(bounces);
        // El primer contacto es el aterrizaje; los rebotes son los siguientes.
        expect(trajectory!.impacts).toHaveLength(bounces + 1);
        expect(trajectory!.face).toBeGreaterThanOrEqual(1);
        expect(trajectory!.face).toBeLessThanOrEqual(20);
        expect(faceFromFinalFrame(trajectory!)).toBe(trajectory!.face);

        const [, restY] = finalPosition(trajectory!);
        expect(Math.abs(restY - DIE_REST_Y)).toBeLessThanOrEqual(0.08);
        expect(trajectory!.durationMs).toBeGreaterThan(500);
        expect(trajectory!.durationMs).toBeLessThanOrEqual(5_000);

        // Los impactos están ordenados y separados: no es chatter del solver.
        for (let index = 1; index < trajectory!.impacts.length; index += 1) {
          const previous = trajectory!.impacts[index - 1]!;
          const current = trajectory!.impacts[index]!;
          expect(current.atMs).toBeGreaterThan(previous.atMs + 50);
        }
      }
    });
  }

  it("más rebotes no cambia la autoridad del servidor: la cara sale de la pose", () => {
    for (const bounces of [1, 4]) {
      const trajectory = simulateD20Throw({ seed: 99, throw: { ...THROW, bounces } });
      expect(trajectory).not.toBeNull();
      expect(faceFromFinalFrame(trajectory!)).toBe(trajectory!.face);
    }
  });
});

describe("varios d20 en la misma mesa", () => {
  it("simula de 2 a 5 dados con una trayectoria por dado", () => {
    for (const count of [2, 3, 4, 5]) {
      const roll = simulateD20Roll({ seed: 7, count });
      expect(roll, `count ${count}`).not.toBeNull();
      expect(roll!.results).toHaveLength(count);
      expect(roll!.trajectories).toHaveLength(count);
      const duration = roll!.trajectories[0]!.durationMs;
      const frames = roll!.trajectories[0]!.frames.length;
      for (let index = 0; index < count; index += 1) {
        const trajectory = roll!.trajectories[index]!;
        expect(roll!.results[index]).toBe(trajectory.face);
        expect(trajectory.frames.length).toBe(frames);
        expect(trajectory.durationMs).toBe(duration);
        expect(trajectory.bounces).toBeGreaterThanOrEqual(0);
        expect(faceFromFinalFrame(trajectory)).toBe(trajectory.face);
        const [x, y, z] = finalPosition(trajectory);
        expect(Math.abs(x)).toBeLessThanOrEqual(D20_TABLE_BOUNDS.x + 0.01);
        expect(Math.abs(z)).toBeLessThanOrEqual(D20_TABLE_BOUNDS.z + 0.01);
        expect(Math.abs(y - DIE_REST_Y)).toBeLessThanOrEqual(0.08);
      }
      // Los dados no acaban superpuestos: la física los ha separado.
      for (let a = 0; a < count; a += 1) {
        for (let b = a + 1; b < count; b += 1) {
          const p = finalPosition(roll!.trajectories[a]!);
          const q = finalPosition(roll!.trajectories[b]!);
          expect(Math.hypot(p[0] - q[0], p[2] - q[2])).toBeGreaterThan(0.3);
        }
      }
    }
  });

  it("los dados se cruzan y colisionan entre ellos", () => {
    const roll = simulateD20Roll({ seed: 1, count: 4 });
    expect(roll).not.toBeNull();
    // La suma de circunradios es 2 * DIE_SCALE; por debajo de eso los dados
    // se han tocado en algún frame.
    expect(minPairDistance(roll!.trajectories)).toBeLessThan(
      2 * DIE_SCALE * 1.05,
    );
  });

  it("sostiene la mesa llena: 12 dados y payload acotado", () => {
    const roll = simulateD20Roll({ seed: 3, count: 12 });
    expect(roll).not.toBeNull();
    expect(roll!.results).toHaveLength(12);
    expect(roll!.trajectories).toHaveLength(12);
    const size = JSON.stringify(roll!.trajectories).length;
    expect(size).toBeLessThan(150_000);
  });

  it("es determinista para la misma semilla y cantidad", () => {
    const first = simulateD20Roll({ seed: 123456, count: 3 });
    const second = simulateD20Roll({ seed: 123456, count: 3 });
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it("mantiene el payload de 5 dados por debajo de 80 KB", () => {
    const roll = simulateD20Roll({ seed: 5, count: 5 });
    expect(roll).not.toBeNull();
    const size = JSON.stringify(roll!.trajectories).length;
    expect(size).toBeLessThan(80_000);
    expect(size).toBeGreaterThan(10_000);
  });

  it("limita la cantidad simulada al rango de la mesa", () => {
    const low = simulateD20Roll({ seed: 11, count: 0 });
    expect(low).not.toBeNull();
    expect(low!.results).toHaveLength(1);
  });
});
