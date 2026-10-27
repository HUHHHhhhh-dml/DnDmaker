import { DEFAULT_RULES } from "../defaults";
import type { DamageType, Ruleset } from "../types";

/**
 * Mitigación porcentual: DEF / (DEF + defenseConstant).
 * La DEF negativa se trata como 0 (v0.1).
 */
export function damageMitigation(
  def: number,
  rules: Ruleset = DEFAULT_RULES,
): number {
  const safeDef = Math.max(0, def);
  if (safeDef === 0) return 0;
  const constant = Math.max(1, rules.defenseConstant);
  return safeDef / (safeDef + constant);
}

/**
 * Daño final de un golpe.
 *
 * - `physical` y `mystic` mitigan con DEF.
 * - `pure` ignora DEF.
 * - Siempre respeta `rules.minDamage`.
 */
export function computeDamage(
  raw: number,
  def: number,
  rules: Ruleset = DEFAULT_RULES,
  damageType: DamageType = "physical",
): number {
  const value = damageType === "pure" ? raw : raw * (1 - damageMitigation(def, rules));
  return Math.max(rules.minDamage, Math.floor(value));
}
