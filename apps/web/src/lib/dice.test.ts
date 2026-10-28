import { describe, expect, it } from "vitest";
import type { DiceRoll } from "@protocol-life/shared";
import { diceOutcome } from "./dice";

function roll(
  sides: DiceRoll["sides"],
  results: number[],
): Pick<DiceRoll, "sides" | "results"> {
  return { sides, results };
}

describe("diceOutcome", () => {
  it("detecta Nat 20 por cara individual, no por la suma", () => {
    expect(diceOutcome(roll(20, [20]))).toEqual({ kind: "nat20", hits: 1 });
    expect(diceOutcome(roll(20, [20, 20]))).toEqual({
      kind: "nat20",
      hits: 2,
    });
    // 10 + 10 = 20 no es un Nat 20.
    expect(diceOutcome(roll(20, [10, 10]))).toBeNull();
    expect(diceOutcome(roll(100, [100]))).toBeNull();
  });

  it("detecta Nat 1 y da prioridad al 20 si coinciden", () => {
    expect(diceOutcome(roll(20, [1]))).toEqual({ kind: "nat1", hits: 1 });
    expect(diceOutcome(roll(20, [1, 1]))).toEqual({
      kind: "nat1",
      hits: 2,
    });
    expect(diceOutcome(roll(20, [20, 1]))).toEqual({
      kind: "nat20",
      hits: 1,
    });
    expect(diceOutcome(roll(6, [1]))).toBeNull();
  });
});
