import { describe, expect, it } from "vitest";
import type { DiceRoll } from "@protocol-life/shared";
import { isSingleD20 } from "./diceCinematic";

function trajectory(face: number) {
  return {
    frames: [
      { p: [0, 1, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] },
      { p: [0, 0.18, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] },
    ],
    durationMs: 500,
    face,
    impacts: [],
  };
}

function roll(
  sides: DiceRoll["sides"],
  count: number,
  results: number[],
  withTrajectory = true,
): Pick<DiceRoll, "id" | "sides" | "count" | "results" | "trajectory"> {
  return {
    id: "dice_test",
    sides,
    count,
    results,
    ...(withTrajectory && sides === 20 && count === 1 && results.length === 1
      ? { trajectory: trajectory(results[0]!) }
      : {}),
  };
}

describe("isSingleD20", () => {
  it("acepta un d20 único con una cara válida", () => {
    expect(isSingleD20(roll(20, 1, [1]))).toBe(true);
    expect(isSingleD20(roll(20, 1, [17]))).toBe(true);
    expect(isSingleD20(roll(20, 1, [20]))).toBe(true);
  });

  it("rechaza otros dados y tiradas múltiples", () => {
    expect(isSingleD20(roll(100, 1, [100]))).toBe(false);
    expect(isSingleD20(roll(20, 2, [10, 10]))).toBe(false);
    expect(isSingleD20(roll(20, 1, [20, 1]))).toBe(false);
    expect(isSingleD20(roll(6, 1, [6]))).toBe(false);
  });

  it("rechaza resultados fuera de 1..20 o no enteros", () => {
    expect(isSingleD20(roll(20, 1, [0]))).toBe(false);
    expect(isSingleD20(roll(20, 1, [21]))).toBe(false);
    expect(isSingleD20(roll(20, 1, [1.5]))).toBe(false);
    expect(isSingleD20(roll(20, 1, []))).toBe(false);
  });

  it("exige una trayectoria física con la cara del resultado", () => {
    expect(isSingleD20(roll(20, 1, [17], false))).toBe(false);
    const mismatch = roll(20, 1, [17]);
    expect(
      isSingleD20({ ...mismatch, trajectory: { ...mismatch.trajectory!, face: 3 } }),
    ).toBe(false);
    const empty = roll(20, 1, [17]);
    expect(
      isSingleD20({ ...empty, trajectory: { ...empty.trajectory!, frames: [] } }),
    ).toBe(false);
  });
});
