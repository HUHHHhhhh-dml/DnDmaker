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

export interface DamageOptions {
  /** El objetivo está OVERCHARGED: recibe 1.5× el daño final. */
  overcharged?: boolean;
}

/**
 * Daño final de un golpe.
 *
 * - `physical` y `mystic` mitigan con DEF.
 * - `pure` ignora DEF.
 * - Un objetivo OVERCHARGED recibe 1.5× el daño final.
 * - Siempre respeta `rules.minDamage`.
 */
export function computeDamage(
  raw: number,
  def: number,
  rules: Ruleset = DEFAULT_RULES,
  damageType: DamageType = "physical",
  options: DamageOptions = {},
): number {
  const value = damageType === "pure" ? raw : raw * (1 - damageMitigation(def, rules));
  const multiplier = options.overcharged ? 1.5 : 1;
  return Math.max(rules.minDamage, Math.floor(value * multiplier));
}
