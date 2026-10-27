import type { CombatState, CombatUnit, Id } from "@protocol-life/shared";

/**
 * Helpers de estado de combate compartidos por declaraciones y resolución
 * (Fase 3C).
 *
 * `CombatState.lockedUnits` es opcional para no invalidar estados guardados
 * antes de 3C. El lock de una unidad con acciones declaradas también se puede
 * deducir de `DeclaredAction.locked`, pero las unidades con 0 acciones solo
 * pueden bloquearse con el mapa por unidad.
 */

export function isAlive(unit: CombatUnit): boolean {
  return !unit.defeated && unit.hpCurrent > 0;
}

export function livingUnits(state: CombatState): CombatUnit[] {
  return state.units.filter(isAlive);
}

/** Lock explícito o, como compatibilidad, todas sus acciones bloqueadas. */
export function isUnitLocked(state: CombatState, unitId: Id): boolean {
  if (state.lockedUnits?.[unitId] === true) return true;
  const actions = state.actions[unitId] ?? [];
  return actions.length > 0 && actions.every((action) => action.locked);
}

/**
 * ¿Están bloqueadas todas las unidades vivas? Las derrotadas no cuentan: si
 * un bando ya no tiene unidades activas, esto no debe impedir cerrar la ronda.
 */
export function allAliveLocked(state: CombatState): boolean {
  return livingUnits(state).every((unit) => isUnitLocked(state, unit.id));
}

/** Marca el lock de una unidad, incluso si no tiene acciones declaradas. */
export function markUnitLocked(state: CombatState, unitId: Id): void {
  state.lockedUnits ??= {};
  state.lockedUnits[unitId] = true;
  state.actions[unitId] = (state.actions[unitId] ?? []).map((action) => ({
    ...action,
    locked: true,
  }));
}

/** Desbloquea una unidad al reemplazar sus acciones. */
export function markUnitUnlocked(state: CombatState, unitId: Id): void {
  state.lockedUnits ??= {};
  state.lockedUnits[unitId] = false;
}

/** ¿Queda alguna unidad activa en el bando? */
export function hasLivingTeam(
  state: CombatState,
  team: CombatUnit["team"],
): boolean {
  return state.units.some((unit) => unit.team === team && isAlive(unit));
}
