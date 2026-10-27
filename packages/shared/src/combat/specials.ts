import type {
  CombatState,
  CombatUnit,
  Id,
  SpecialAbility,
} from "../types";
import type { EngineEvent } from "./types";

/**
 * Dominios y hábitats (Fase 3B).
 *
 * Se guardan como efectos sintéticos con id = id del special, duración y
 * `modifyStat` continuo. La marca de “usado” vive en
 * `CombatState.specialCooldowns[unitId][specialId]`; para una habilidad de
 * una vez por combate usamos un centinela que no decrece.
 */
export const SPECIAL_USED = 9999;

export function canUseSpecial(
  state: Pick<CombatState, "specialCooldowns">,
  unitId: Id,
  special: SpecialAbility,
): boolean {
  const used = state.specialCooldowns[unitId]?.[special.id] ?? 0;
  // Una vez por combate usa un centinela > 0; las reutilizables guardan
  // rondas de cooldown. En ambos casos 0 significa disponible.
  return used <= 0;
}

/** Marca el special como usado en el estado draft. */
export function markSpecialUsed(
  state: CombatState,
  unitId: Id,
  special: SpecialAbility,
): void {
  state.specialCooldowns[unitId] ??= {};
  state.specialCooldowns[unitId][special.id] =
    special.oncePerCombat === false
      ? Math.max(0, special.cooldown ?? 0)
      : SPECIAL_USED;
}

/** Baja los cooldowns reutilizables; los de una vez por combate no caducan. */
export function tickSpecialCooldowns(
  state: CombatState,
  specials: SpecialAbility[],
): EngineEvent[] {
  const byId = new Map(specials.map((special) => [special.id, special]));
  const events: EngineEvent[] = [];

  for (const [unitId, cooldowns] of Object.entries(state.specialCooldowns)) {
    for (const [specialId, value] of Object.entries(cooldowns)) {
      if (value <= 0) continue;
      const special = byId.get(specialId);
      if (!special) continue;
      if (special.oncePerCombat !== false) continue;
      const remaining = Math.max(0, value - 1);
      cooldowns[specialId] = remaining;
      events.push({
        type: "cooldown",
        actorId: unitId,
        message:
          remaining > 0
            ? `${special.name}: ${remaining} ronda${remaining === 1 ? "" : "s"} de espera.`
            : `${special.name} vuelve a estar disponible para ${unitId}.`,
        data: { specialId, remaining },
      });
    }
  }

  return events;
}

/** Objetivos de un special según su `target`. */
export function specialTargets(
  state: CombatState,
  caster: CombatUnit,
  special: SpecialAbility,
): CombatUnit[] {
  const alive = (unit: CombatUnit): boolean =>
    !unit.defeated && unit.hpCurrent > 0;

  if (special.target === "self") return [caster];
  if (special.target === "field") {
    return state.units.filter((unit) => alive(unit));
  }
  return state.units.filter(
    (unit) => unit.team === caster.team && alive(unit),
  );
}
