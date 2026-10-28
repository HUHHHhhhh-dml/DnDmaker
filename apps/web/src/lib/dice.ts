import type { DiceRoll } from "@protocol-life/shared";

export type DiceOutcomeKind = "nat20" | "nat1";

export interface DiceOutcome {
  kind: DiceOutcomeKind;
  /** Cuántas caras iguales salieron (20 o 1). */
  hits: number;
}

/**
 * Un Nat 20/Nat 1 solo existe en un d20 y se detecta por la **cara individual**,
 * no por la suma de varios dados. Si en una tirada múltiple hay 20 y 1, el 20
 * tiene prioridad.
 */
export function diceOutcome(
  roll: Pick<DiceRoll, "sides" | "results">,
): DiceOutcome | null {
  if (roll.sides !== 20) return null;
  const twenties = roll.results.filter((value) => value === 20).length;
  if (twenties > 0) return { kind: "nat20", hits: twenties };
  const ones = roll.results.filter((value) => value === 1).length;
  if (ones > 0) return { kind: "nat1", hits: ones };
  return null;
}
