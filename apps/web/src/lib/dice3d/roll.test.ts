import { describe, expect, it } from "vitest";
import type { DiceRoll, DiceTrajectory } from "@protocol-life/shared";
import { isPhysicalD20Roll, isSingleD20, rollTrajectories } from "./roll";

function trajectory(face: number): DiceTrajectory {
  return {
    frames: [
      { p: [0, 1, 0], q: [0, 0, 0, 1] },
      { p: [0, 0.18, 0], q: [0, 0, 0, 1] },
    ],
    durationMs: 500,
    face,
    impacts: [{ atMs: 400, x: 0, z: 0, strength: 0.8 }],
    bounces: 1,
  };
}

type RollInput = Pick<
  DiceRoll,
  "sides" | "count" | "results" | "trajectory" | "trajectories"
>;

function single(face: number): RollInput {
  return { sides: 20, count: 1, results: [face], trajectory: trajectory(face) };
}

function multi(faces: number[]): RollInput {
  return {
    sides: 20,
    count: faces.length,
    results: faces,
    trajectories: faces.map(trajectory),
  };
}

describe("trayectorias de una tirada", () => {
  it("el d20 único usa trajectory y el multi usa trajectories", () => {
    expect(rollTrajectories(single(17))).toHaveLength(1);
    expect(rollTrajectories(single(17))[0]!.face).toBe(17);
    const many = rollTrajectories(multi([3, 20, 1]));
    expect(many.map((trajectory) => trajectory.face)).toEqual([3, 20, 1]);
  });

  it("no inventa trayectorias si la cantidad no coincide", () => {
    const mismatched = {
      sides: 20,
      count: 2,
      results: [3, 4],
      trajectories: [trajectory(3)],
    } as RollInput;
    expect(rollTrajectories(mismatched)).toEqual([]);
    expect(rollTrajectories({ count: 1 })).toEqual([]);
  });
});

describe("isPhysicalD20Roll", () => {
  it("acepta d20 únicos y múltiples con caras coincidentes", () => {
    expect(isPhysicalD20Roll(single(1))).toBe(true);
    expect(isPhysicalD20Roll(single(20))).toBe(true);
    expect(isPhysicalD20Roll(multi([3, 20, 1]))).toBe(true);
    expect(isPhysicalD20Roll(multi([20, 20]))).toBe(true);
  });

  it("rechaza tiradas sin física u otro tipo de dado", () => {
    expect(
      isPhysicalD20Roll({ sides: 20, count: 1, results: [7] }),
    ).toBe(false);
    expect(isPhysicalD20Roll({ sides: 6, count: 1, results: [3] })).toBe(false);
    expect(
      isPhysicalD20Roll({ sides: 100, count: 1, results: [42] }),
    ).toBe(false);
  });

  it("rechaza caras que no coinciden o resultados inválidos", () => {
    expect(
      isPhysicalD20Roll({
        sides: 20,
        count: 2,
        results: [3, 4],
        trajectories: [trajectory(3), trajectory(5)],
      }),
    ).toBe(false);
    expect(
      isPhysicalD20Roll({
        sides: 20,
        count: 2,
        results: [3],
        trajectories: [trajectory(3), trajectory(4)],
      }),
    ).toBe(false);
    expect(
      isPhysicalD20Roll({
        sides: 20,
        count: 1,
        results: [21],
        trajectory: trajectory(21),
      }),
    ).toBe(false);
    expect(
      isPhysicalD20Roll({
        sides: 20,
        count: 1,
        results: [7],
        trajectory: { ...trajectory(7), frames: [] },
      }),
    ).toBe(false);
  });

  it("el atajo de d20 único no acepta tiradas múltiples", () => {
    expect(isSingleD20(single(12))).toBe(true);
    expect(isSingleD20(multi([12, 13]))).toBe(false);
  });
});
