import { DEFAULT_RULES } from "../defaults";
import type { Ruleset } from "../types";
import { rollCoins } from "./coins";
import { computeDamage } from "./damage";
import type { ClashParticipant, ClashResult } from "./types";
import type { Rng } from "./rng";

/**
 * Resuelve un clash entre dos acciones que se apuntan mutuamente.
 *
 * No aplica daño ni cambia HP: devuelve el resultado para que `round.ts`
 * decida a quién golpear y dispare triggers. Si empatan, la regla cerrada de
 * v0.1 (`cancel_both`) cancela ambas acciones.
 */
export function resolveClash(
  attacker: ClashParticipant,
  defender: ClashParticipant,
  rules: Ruleset = DEFAULT_RULES,
  rng: Rng,
): ClashResult {
  const attackerRoll = rollCoins(
    attacker.skill,
    attacker.unit.stats,
    rng,
    rules,
  );
  const defenderRoll = rollCoins(
    defender.skill,
    defender.unit.stats,
    rng,
    rules,
  );

  const attackerWins = attackerRoll.clashPower > defenderRoll.clashPower;
  const defenderWins = defenderRoll.clashPower > attackerRoll.clashPower;

  if (!attackerWins && !defenderWins) {
    if (rules.tieRule === "defender_wins") {
      const damageToAttacker = computeDamage(
        defenderRoll.rawDamage,
        attacker.unit.stats.def,
        rules,
      );
      return {
        winner: "defender",
        tie: true,
        cancelled: false,
        attackerRoll,
        defenderRoll,
        damageToAttacker,
        damageToDefender: 0,
        damage: damageToAttacker,
      };
    }

    if (rules.tieRule === "both_half") {
      const damageToAttacker = Math.max(
        1,
        Math.floor(
          computeDamage(
            defenderRoll.rawDamage,
            attacker.unit.stats.def,
            rules,
          ) / 2,
        ),
      );
      const damageToDefender = Math.max(
        1,
        Math.floor(
          computeDamage(
            attackerRoll.rawDamage,
            defender.unit.stats.def,
            rules,
          ) / 2,
        ),
      );
      return {
        winner: "tie",
        tie: true,
        cancelled: false,
        attackerRoll,
        defenderRoll,
        damageToAttacker,
        damageToDefender,
        damage: 0,
      };
    }

    return {
      winner: "tie",
      tie: true,
      cancelled: true,
      attackerRoll,
      defenderRoll,
      damageToAttacker: 0,
      damageToDefender: 0,
      damage: 0,
    };
  }

  if (attackerWins) {
    const damageToDefender = computeDamage(
      attackerRoll.rawDamage,
      defender.unit.stats.def,
      rules,
    );
    return {
      winner: "attacker",
      tie: false,
      cancelled: false,
      attackerRoll,
      defenderRoll,
      damageToAttacker: 0,
      damageToDefender,
      damage: damageToDefender,
    };
  }

  const damageToAttacker = computeDamage(
    defenderRoll.rawDamage,
    attacker.unit.stats.def,
    rules,
  );
  return {
    winner: "defender",
    tie: false,
    cancelled: false,
    attackerRoll,
    defenderRoll,
    damageToAttacker,
    damageToDefender: 0,
    damage: damageToAttacker,
  };
}
