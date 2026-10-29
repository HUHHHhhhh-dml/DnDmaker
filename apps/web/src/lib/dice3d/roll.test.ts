import { describe, expect, it } from "vitest";
import type { DiceRoll, DiceTrajectory } from "@protocol-life/shared";
import {
  expectedTrajectoryCount,
  isPhysicalD20Roll,
  isPhysicalDiceRoll,
  isSingleD20,
  rollTrajectories,
  uniformBounces,
} from "./roll";

function trajectory(face: number, bounces = 1): DiceTrajectory {
  return {
    frames: [
      { p: [0, 1, 0], q: [0, 0, 0, 1] },
      { p: [0, 0.18, 0], q: [0, 0, 0, 1] },
    ],
    durationMs: 500,
    face,
    impacts: [{ atMs: 400, x: 0, z: 0, strength: 0.8 }],
    bounces,
  };
}

type RollInput = Pick<
  DiceRoll,
  "sides" | "count" | "results" | "trajectory" | "trajectories"
>;

function single(sides: DiceRoll["sides"], face: number, bounces = 1): RollInput {
  return {
    sides,
    count: 1,
    results: [face],
    trajectory: trajectory(face, bounces),
  };
}

function multi(sides: DiceRoll["sides"], faces: number[]): RollInput {
  return {
    sides,
    count: faces.length,
    results: faces,
    trajectories: faces.map((face) => trajectory(face)),
  };
}

function d100(results: number[], faces: number[]): RollInput {
  return {
    sides: 100,
    count: results.length,
    results,
    trajectories: faces.map((face) => trajectory(face)),
  };
}

describe("trayectorias de una tirada", () => {
  it("el dado único usa trajectory y el multi usa trajectories", () => {
    expect(rollTrajectories(single(20, 17))).toHaveLength(1);
    expect(rollTrajectories(single(20, 17))[0]!.face).toBe(17);
    const many = rollTrajectories(multi(20, [3, 20, 1]));
    expect(many.map((item) => item.face)).toEqual([3, 20, 1]);
    expect(rollTrajectories(d100([52], [5, 2]))).toHaveLength(2);
  });

  it("no inventa trayectorias si no hay datos", () => {
    expect(rollTrajectories({ count: 1 })).toEqual([]);
  });

  it("cuenta los cuerpos esperados (d100 son dos d10)", () => {
    expect(expectedTrajectoryCount(20, 1)).toBe(1);
    expect(expectedTrajectoryCount(6, 4)).toBe(4);
    expect(expectedTrajectoryCount(100, 1)).toBe(2);
    expect(expectedTrajectoryCount(100, 5)).toBe(10);
  });
});

describe("isPhysicalDiceRoll", () => {
  it("acepta un dado de cada tipo con su cara o vértice", () => {
    expect(isPhysicalDiceRoll(single(4, 2))).toBe(true);
    expect(isPhysicalDiceRoll(single(6, 6))).toBe(true);
    expect(isPhysicalDiceRoll(single(8, 8))).toBe(true);
    expect(isPhysicalDiceRoll(single(10, 10))).toBe(true);
    expect(isPhysicalDiceRoll(single(12, 12))).toBe(true);
    expect(isPhysicalDiceRoll(single(20, 20))).toBe(true);
  });

  it("acepta d20 y otros dados múltiples con caras coincidentes", () => {
    expect(isPhysicalDiceRoll(multi(20, [3, 20, 1]))).toBe(true);
    expect(isPhysicalDiceRoll(multi(6, [3, 2, 6, 1]))).toBe(true);
    expect(isPhysicalDiceRoll(multi(4, [1, 4, 2]))).toBe(true);
  });

  it("acepta un d100 como dos d10 y detecta la combinación", () => {
    expect(isPhysicalDiceRoll(d100([52], [5, 2]))).toBe(true);
    expect(isPhysicalDiceRoll(d100([100], [10, 10]))).toBe(true);
    expect(isPhysicalDiceRoll(d100([52, 100], [5, 2, 10, 10]))).toBe(true);
    expect(isPhysicalDiceRoll(d100([53], [5, 2]))).toBe(false);
    expect(isPhysicalDiceRoll(d100([52], [5]))).toBe(false);
  });

  it("rechaza tiradas sin física, caras fuera de rango o cuerpos de más", () => {
    expect(isPhysicalDiceRoll({ sides: 20, count: 1, results: [7] })).toBe(
      false,
    );
    expect(isPhysicalDiceRoll({ sides: 6, count: 1, results: [7] })).toBe(
      false,
    );
    expect(
      isPhysicalDiceRoll({
        sides: 6,
        count: 2,
        results: [3, 4],
        trajectories: [trajectory(3)],
      }),
    ).toBe(false);
    expect(
      isPhysicalDiceRoll({
        sides: 100,
        count: 1,
        results: [52],
        trajectory: trajectory(5),
      }),
    ).toBe(false);
  });

  it("rechaza caras que no coinciden o resultados inválidos", () => {
    expect(
      isPhysicalDiceRoll({
        sides: 20,
        count: 2,
        results: [3, 4],
        trajectories: [trajectory(3), trajectory(5)],
      }),
    ).toBe(false);
    expect(
      isPhysicalDiceRoll({
        sides: 20,
        count: 2,
        results: [3],
        trajectories: [trajectory(3), trajectory(4)],
      }),
    ).toBe(false);
    expect(
      isPhysicalDiceRoll({
        sides: 4,
        count: 1,
        results: [5],
        trajectory: trajectory(5),
      }),
    ).toBe(false);
    expect(
      isPhysicalDiceRoll({
        sides: 20,
        count: 1,
        results: [7],
        trajectory: { ...trajectory(7), frames: [] },
      }),
    ).toBe(false);
  });

  it("el atajo de d20 único no acepta otros dados ni tiradas múltiples", () => {
    expect(isSingleD20(single(20, 12))).toBe(true);
    expect(isSingleD20(multi(20, [12, 13]))).toBe(false);
    expect(isSingleD20(single(6, 3))).toBe(false);
    expect(isPhysicalD20Roll(single(6, 3))).toBe(false);
  });
});

describe("rebotes uniformes", () => {
  it("devuelve el conteo si todos los cuerpos coinciden", () => {
    expect(uniformBounces(single(20, 5, 4))).toBe(4);
    expect(uniformBounces(multi(6, [1, 2, 3]))).toBeNull();
    expect(uniformBounces(d100([52], [5, 2]))).toBe(1);
  });

  it("no lo devuelve en multi o si los cuerpos no coinciden", () => {
    expect(uniformBounces(multi(20, [1, 2]))).toBeNull();
    const mixed = d100([52], [5, 2]);
    mixed.trajectories![1] = trajectory(2, 3);
    expect(uniformBounces(mixed)).toBeNull();
    expect(uniformBounces({ sides: 20, count: 1, results: [5] })).toBeNull();
  });
});
