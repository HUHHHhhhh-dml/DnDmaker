import type { BossPhase, CombatUnit } from "../types";
import type { EngineEvent } from "./types";

/**
 * Cambio de fase de un jefe (fase 1 = ficha base, fase 2 = `bossPhase`).
 *
 * El motor evalúa esta transición al final de la ronda, después de resolver
 * daño/efectos y antes de avanzar `round`. Es unidireccional: una vez activada,
 * `bossPhaseActive` queda fijado y curarse por encima del umbral no revierte
 * sprite ni habilidades.
 *
 * Un jefe que muere en la misma ronda no entra en fase 2.
 */

export const BOSS_PHASE_FINAL = 2;

/**
 * Devuelve la fase a activar, o `null` si el jefe no debe cambiar todavía.
 *
 * Se compara contra `stats.hpMax` (HP máximo del snapshot, ya derivado con
 * equipo/efectos). Si `hpMax` no es positivo no se divide ni se activa.
 */
export function bossPhaseToActivate(unit: CombatUnit): BossPhase | null {
  const phase = unit.bossPhase;
  if (!phase) return null;
  if (unit.kind !== "boss") return null;
  if (unit.bossPhaseActive) return null;
  if (unit.defeated || unit.hpCurrent <= 0) return null;

  const hpMax = unit.stats.hpMax;
  if (!(hpMax > 0)) return null;

  const ratio = unit.hpCurrent / hpMax;
  if (ratio > phase.thresholdPct / 100) return null;
  return phase;
}

/** Aplica los overrides de fase 2 sin tocar stats, equipo ni efectos. */
export function applyBossPhase(
  unit: CombatUnit,
  phase: BossPhase,
): CombatUnit {
  return {
    ...unit,
    bossPhaseActive: true,
    name: phase.name ?? unit.name,
    description: phase.description ?? unit.description,
    portrait: phase.portrait ?? unit.portrait,
    visualMode: phase.visualMode ?? unit.visualMode,
    battleSprite: phase.battleSprite ?? unit.battleSprite,
    bodyImage: phase.bodyImage ?? unit.bodyImage,
    skills: phase.skills ? [...phase.skills] : [...unit.skills],
  };
}

/** Evento de log del cambio de fase; incluye nombre/HP y skills resultantes. */
export function bossPhaseEvent(
  before: CombatUnit,
  after: CombatUnit,
  phase: BossPhase,
): EngineEvent {
  const label = phase.label?.trim();
  return {
    type: "bossPhase",
    actorId: after.id,
    message: label
      ? `${before.name} cambia de fase: ${label}.`
      : `${before.name} cambia de fase.`,
    data: {
      unitId: after.id,
      phase: BOSS_PHASE_FINAL,
      thresholdPct: phase.thresholdPct,
      label: label ?? null,
      previousName: before.name,
      name: after.name,
      hpCurrent: after.hpCurrent,
      hpMax: after.stats.hpMax,
      skills: after.skills,
    },
  };
}
