import { describe, expect, it } from "vitest";
import {
  combineD100,
  D20_FACES,
  D20_TABLE_BOUNDS,
  DIE_REST_Y,
  DIE_SCALE,
  getDieDefinition,
  restHeight,
  type DiceSides,
  type DiceTrajectory,
  type DieDefinition,
} from "@protocol-life/shared";
import {
  simulateD20Roll,
  simulateD20Throw,
  simulateDiceRoll,
} from "./dicePhysics";

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

/** Resultado que se lee de la pose final según el tipo de dado. */
function resultFromFinal(
  definition: DieDefinition,
  trajectory: DiceTrajectory,
): number {
  const final = trajectory.frames[trajectory.frames.length - 1]!;
  if (definition.resultMode === "top-vertex") {
    let best = -Infinity;
    let value = 0;
    definition.vertices.forEach((vertex, index) => {
      const [, y] = rotate(vertex, final.q);
      if (y > best) {
        best = y;
        value = definition.vertexNumbers?.[index] ?? 0;
      }
    });
    return value;
  }
  let best = -Infinity;
  let value = 0;
  for (const face of definition.faces) {
    const [, y] = rotate(face.normal, final.q);
    if (y > best) {
      best = y;
      value = face.number;
    }
  }
  return value;
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

  it("clava los rebotes pedidos en todos los dados", () => {
    for (const sides of [4, 6, 8, 10, 12, 20] as const) {
      const roll = simulateDiceRoll({
        seed: 7,
        sides,
        count: 1,
        throw: { ...THROW, bounces: 4 },
      });
      expect(roll, `d${sides}`).not.toBeNull();
      expect(roll!.trajectories).toHaveLength(1);
      expect(roll!.trajectories[0]!.bounces).toBe(4);
      expect(roll!.trajectories[0]!.impacts).toHaveLength(5);
    }

    const d100 = simulateDiceRoll({
      seed: 7,
      sides: 100,
      count: 1,
      throw: { ...THROW, bounces: 2 },
    });
    expect(d100).not.toBeNull();
    expect(d100!.trajectories).toHaveLength(2);
    for (const trajectory of d100!.trajectories) {
      expect(trajectory.bounces).toBe(2);
      expect(trajectory.impacts).toHaveLength(3);
    }
  });

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

  it("los dados de cada tipo se tocan en la misma mesa", () => {
    for (const sides of [4, 6, 8, 10, 12, 20] as const) {
      const roll = simulateDiceRoll({ seed: 2, sides, count: 3 });
      expect(roll, `d${sides}`).not.toBeNull();
      expect(minPairDistance(roll!.trajectories), `d${sides}`).toBeLessThan(
        2 * DIE_SCALE * 1.05,
      );
    }
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


describe("física de todos los dados", () => {
  for (const sides of [4, 6, 8, 10, 12, 20] as const) {
    it(`simula un d${sides} y lee su cara o vértice`, () => {
      const definition = getDieDefinition(sides);
      const roll = simulateDiceRoll({ seed: 3, sides, count: 1 });
      expect(roll, `d${sides}`).not.toBeNull();
      expect(roll!.results).toHaveLength(1);
      expect(roll!.trajectories).toHaveLength(1);
      const result = roll!.results[0]!;
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(sides);
      expect(resultFromFinal(definition, roll!.trajectories[0]!)).toBe(result);

      const [, y] = finalPosition(roll!.trajectories[0]!);
      expect(Math.abs(y - restHeight(definition, DIE_SCALE))).toBeLessThanOrEqual(
        0.08,
      );
    });

    it(`simula 3 d${sides} en la misma mesa`, () => {
      const roll = simulateDiceRoll({ seed: 11, sides, count: 3 });
      expect(roll, `d${sides}`).not.toBeNull();
      expect(roll!.results).toHaveLength(3);
      expect(roll!.trajectories).toHaveLength(3);
      const duration = roll!.trajectories[0]!.durationMs;
      for (let index = 0; index < 3; index += 1) {
        const trajectory = roll!.trajectories[index]!;
        expect(trajectory.durationMs).toBe(duration);
        expect(roll!.results[index]).toBe(
          resultFromFinal(getDieDefinition(sides), trajectory),
        );
      }
      expect(simulateDiceRoll({ seed: 11, sides, count: 3 })).toEqual(roll);
    });
  }

  it("simula el d100 como pareja de d10", () => {
    const definition = getDieDefinition(10);
    const roll = simulateDiceRoll({ seed: 5, sides: 100, count: 1 });
    expect(roll).not.toBeNull();
    expect(roll!.results).toHaveLength(1);
    expect(roll!.trajectories).toHaveLength(2);
    const result = roll!.results[0]!;
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(100);
    expect(
      combineD100(
        roll!.trajectories[0]!.face,
        roll!.trajectories[1]!.face,
      ),
    ).toBe(result);
    for (const trajectory of roll!.trajectories) {
      const [, y] = finalPosition(trajectory);
      expect(Math.abs(y - restHeight(definition, DIE_SCALE))).toBeLessThanOrEqual(
        0.08,
      );
    }
  });

  it("simula varios d100 y combina cada pareja", () => {
    const roll = simulateDiceRoll({ seed: 5, sides: 100, count: 3 });
    expect(roll).not.toBeNull();
    expect(roll!.results).toHaveLength(3);
    expect(roll!.trajectories).toHaveLength(6);
    for (let index = 0; index < 3; index += 1) {
      const tens = roll!.trajectories[index * 2]!;
      const units = roll!.trajectories[index * 2 + 1]!;
      expect(combineD100(tens.face, units.face)).toBe(roll!.results[index]);
    }
  });

  it("no simula dados fuera de la mesa física", () => {
    expect(simulateDiceRoll({ seed: 1, sides: 7 as DiceSides, count: 1 })).toBeNull();
  });
});
