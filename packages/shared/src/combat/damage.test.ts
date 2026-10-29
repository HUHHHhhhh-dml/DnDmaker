import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "../defaults";
import { computeDamage } from "./damage";

/**
 * Regla de sobrecarga: un objetivo OVERCHARGED recibe 1.5× el daño final,
 * después de la mitigación de DEF.
 */
describe("daño OVERCHARGED", () => {
  const rules = { ...DEFAULT_RULES, defenseConstant: 100, minDamage: 1 };

  it("multiplica por 1.5 el daño físico final", () => {
    expect(computeDamage(100, 0, rules)).toBe(100);
    expect(
      computeDamage(100, 0, rules, "physical", { overcharged: true }),
    ).toBe(150);
  });

  it("aplica la mitigación de DEF antes del multiplicador", () => {
    // 100 × (1 - 100/200) = 50; 50 × 1.5 = 75
    expect(
      computeDamage(100, 100, rules, "physical", { overcharged: true }),
    ).toBe(75);
  });

  it("también multiplica el daño puro", () => {
    expect(computeDamage(10, 500, rules, "pure", { overcharged: true })).toBe(
      15,
    );
  });

  it("respeta el daño mínimo sin sobrecarga", () => {
    expect(computeDamage(0, 999, rules, "physical", { overcharged: true })).toBe(
      rules.minDamage,
    );
  });
});
