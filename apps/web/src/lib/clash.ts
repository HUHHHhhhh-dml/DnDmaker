import type { CoinRoll, CombatEvent } from "@protocol-life/shared";

/**
 * Lectura de la cinemática de clash (Fase 3F.5).
 *
 * El motor ya resolvió la ronda: aquí solo se interpretan los `CombatEvent`
 * para pintar monedas, totales, ganador y daño. El daño no viaja en el evento
 * `clash`; llega en los eventos `damage` inmediatamente posteriores, así que
 * se correlaciona por índice y por objetivo.
 */

export type ClashWinner = "attacker" | "defender" | "tie";

export interface ClashView {
  id: string;
  /** Posición del evento `clash` dentro del array de eventos. */
  eventIndex: number;
  round: number;
  attackerId: string;
  defenderId: string;
  attackerSkillId?: string;
  defenderSkillId?: string;
  attackerRoll: CoinRoll;
  /** Ausente en ataques sin respuesta. */
  defenderRoll?: CoinRoll;
  oneSided: boolean;
  winner: ClashWinner;
  tie: boolean;
  cancelled: boolean;
}

export interface ClashDamage {
  targetId: string;
  final: number;
  hpBefore?: number;
  hpAfter?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asCoinRoll(value: unknown): CoinRoll | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const coins = asNumber(raw.coins);
  const clashPower = asNumber(raw.clashPower);
  if (coins === undefined || clashPower === undefined) return undefined;

  const count = Math.max(0, Math.trunc(coins));
  const heads = Math.min(
    count,
    Math.max(0, Math.trunc(asNumber(raw.heads) ?? 0)),
  );
  const rawFaces = Array.isArray(raw.faces) ? raw.faces : [];
  const faces =
    rawFaces.length > 0
      ? Array.from({ length: count }, (_, index) => rawFaces[index] === true)
      : Array.from({ length: count }, (_, index) => index < heads);

  return {
    coins: count,
    heads: faces.filter(Boolean).length,
    faces,
    probability: asNumber(raw.probability) ?? 0,
    clashPower,
    rawDamage: asNumber(raw.rawDamage) ?? 0,
    fullHeads: raw.fullHeads === true,
  };
}

/**
 * Convierte un evento `clash` en datos de cinemática. Devuelve `null` si el
 * payload no tiene la forma esperada: la UI nunca debe romper por un evento
 * antiguo o desconocido.
 */
export function clashViewFromEvent(
  event: CombatEvent,
  eventIndex: number,
): ClashView | null {
  if (event.type !== "clash") return null;
  const data = asRecord(event.data) ?? {};

  const attackerId = asId(data.attackerId) ?? event.actorId;
  const defenderId = asId(data.defenderId) ?? event.targetId;
  const attackerRoll = asCoinRoll(data.attackerRoll);
  if (!attackerId || !defenderId || !attackerRoll) return null;

  const winner: ClashWinner =
    data.winner === "defender" || data.winner === "tie"
      ? data.winner
      : "attacker";

  return {
    id: event.id,
    eventIndex,
    round: event.round,
    attackerId,
    defenderId,
    attackerSkillId: asId(data.attackerSkillId),
    defenderSkillId: asId(data.defenderSkillId),
    attackerRoll,
    defenderRoll: asCoinRoll(data.defenderRoll),
    oneSided: data.oneSided === true || !data.defenderRoll,
    winner,
    tie: data.tie === true || winner === "tie",
    cancelled: data.cancelled === true,
  };
}

/** Eventos `clash` nuevos a partir de `fromIndex` (exclusive hacia atrás). */
export function clashViewsFromEvents(
  events: CombatEvent[],
  fromIndex = 0,
): ClashView[] {
  const views: ClashView[] = [];
  for (let index = Math.max(0, fromIndex); index < events.length; index += 1) {
    const view = clashViewFromEvent(events[index]!, index);
    if (view) views.push(view);
  }
  return views;
}

/**
 * Daño asociado a un clash: los `damage` que van justo después, hasta el
 * siguiente clash, el fin de ronda o el fin del combate. Puede haber dos
 * (reglas de empate con daño mutuo).
 */
export function damagesForClash(
  events: CombatEvent[],
  view: ClashView,
): ClashDamage[] {
  const damages: ClashDamage[] = [];
  for (let index = view.eventIndex + 1; index < events.length; index += 1) {
    const event = events[index]!;
    if (
      event.type === "clash" ||
      event.type === "roundStart" ||
      event.type === "roundEnd" ||
      event.type === "combatEnd"
    ) {
      break;
    }
    if (event.type !== "damage" || !event.targetId) continue;
    if (
      event.targetId !== view.attackerId &&
      event.targetId !== view.defenderId
    ) {
      continue;
    }
    const data = asRecord(event.data) ?? {};
    const final = asNumber(data.final);
    if (final === undefined) continue;
    // Descarta daño de triggers/efectos colado entre el clash y el siguiente:
    // el golpe del clash siempre lleva el skillId de uno de los participantes.
    const skillId = asId(data.skillId);
    const clashSkills = [view.attackerSkillId, view.defenderSkillId].filter(
      (id): id is string => Boolean(id),
    );
    if (skillId && clashSkills.length > 0 && !clashSkills.includes(skillId)) {
      continue;
    }
    damages.push({
      targetId: event.targetId,
      final,
      hpBefore: asNumber(data.hpBefore),
      hpAfter: asNumber(data.hpAfter),
    });
  }
  return damages;
}

/** Daño total recibido por una unidad en este clash. */
export function damageTakenBy(
  damages: ClashDamage[],
  unitId: string,
): number {
  return damages
    .filter((damage) => damage.targetId === unitId)
    .reduce((total, damage) => total + damage.final, 0);
}
