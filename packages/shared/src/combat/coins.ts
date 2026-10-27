import { DEFAULT_RULES } from "../defaults";
import { coinChance } from "../stats";
import type { Ruleset, Skill, Stats } from "../types";
import type { CoinRoll } from "./types";
import type { Rng } from "./rng";

/**
 * Tira las monedas de una skill.
 *
 * REGLAS CERRADAS:
 *   probCara = clamp(0.5 + LUCK/100, luckFloor, luckCap)
 *   clashPower = baseClash + caras * coinClash
 *   raw = ATK + baseDamage + caras * coinDamage
 *   si todas caras -> raw *= fullHeadsMultiplier
 */
export function rollCoins(
  skill: Skill,
  stats: Stats,
  rng: Rng,
  rules: Ruleset = DEFAULT_RULES,
): CoinRoll {
  const probability = coinChance(stats.luck, rules);
  const coinCount = Math.max(1, Math.trunc(skill.coins));
  const faces: boolean[] = [];
  for (let index = 0; index < coinCount; index += 1) {
    faces.push(rng.next() < probability);
  }

  const heads = faces.filter(Boolean).length;
  const fullHeads = heads === coinCount;
  const multiplier = skill.fullHeadsMultiplier ?? rules.fullHeadsMultiplier;
  const clashPower = skill.baseClash + heads * skill.coinClash;
  const baseRaw = stats.atk + skill.baseDamage + heads * skill.coinDamage;
  const rawDamage = fullHeads ? baseRaw * multiplier : baseRaw;

  return {
    coins: coinCount,
    heads,
    faces,
    probability,
    clashPower,
    rawDamage,
    fullHeads,
  };
}
