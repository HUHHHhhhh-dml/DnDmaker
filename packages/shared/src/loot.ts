import type { Id, IsoDate, LootDraft } from "./types";

/**
 * Reparto de botín por turnos (Fase 4A-2).
 *
 * Reglas cerradas con el usuario:
 * - Orden por iniciativa del combate: SPD descendente, empate por `characterId`.
 * - Serpiente: la ronda 1 va hacia delante, la 2 hacia atrás, la 3 hacia
 *   delante… así el primero en elegir no arrasa en todas las rondas.
 * - Un objeto por turno; el turno avanza aunque queden objetos.
 * - Los objetos se entregan al elegirlos (no al cerrar).
 *
 * Todo es puro: el servidor valida y persiste, el cliente solo pinta.
 */

export interface LootUnitRef {
  characterId: Id;
  spd: number;
}

/** Orden base del reparto: más rápido primero, empate por `characterId`. */
export function lootBaseOrder(units: readonly LootUnitRef[]): Id[] {
  const best = new Map<Id, number>();
  for (const unit of units) {
    const current = best.get(unit.characterId);
    if (current === undefined || unit.spd > current) {
      best.set(unit.characterId, unit.spd);
    }
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([characterId]) => characterId);
}

type TurnState = Pick<LootDraft, "order" | "round" | "turnIndex">;

/** Posición 0-based dentro de la ronda, ya invertida en las rondas pares. */
function turnPosition(draft: TurnState): number {
  const count = draft.order.length;
  if (count === 0) return -1;
  const step = draft.turnIndex % count;
  return draft.round % 2 === 1 ? step : count - 1 - step;
}

/** `characterId` al que le toca elegir, o `null` si no hay participantes. */
export function lootTurnCharacter(draft: TurnState): Id | null {
  const position = turnPosition(draft);
  if (position < 0) return null;
  return draft.order[position] ?? null;
}

/** Turno 1-based dentro de la ronda, para la UI ("turno 2 de 3"). */
export function lootTurnNumber(draft: TurnState): number {
  if (draft.order.length === 0) return 0;
  return (draft.turnIndex % draft.order.length) + 1;
}

/** Total de objetos que ya había al empezar (pool + elegidos). */
export function lootTotalItems(draft: Pick<LootDraft, "pool" | "picks">): number {
  return draft.pool.length + draft.picks.length;
}

function advanceTurn<T extends TurnState>(draft: T): T {
  const count = draft.order.length;
  if (count === 0) return draft;
  const next = draft.turnIndex + 1;
  if (next >= count) {
    return { ...draft, turnIndex: 0, round: draft.round + 1 };
  }
  return { ...draft, turnIndex: next };
}

export type LootActionResult =
  | { ok: true; draft: LootDraft; itemId?: Id }
  | { ok: false; error: "not_active" | "not_your_turn" | "invalid_item" };

/**
 * Elige el objeto `itemIndex` del pool para `characterId`. Devuelve el draft
 * actualizado y el objeto entregado. El llamador entrega el objeto en el
 * inventario y persiste.
 */
export function applyLootPick(
  draft: LootDraft,
  characterId: Id,
  itemIndex: number,
  at: IsoDate = new Date().toISOString(),
): LootActionResult {
  if (draft.status !== "active") return { ok: false, error: "not_active" };
  if (lootTurnCharacter(draft) !== characterId) {
    return { ok: false, error: "not_your_turn" };
  }
  const itemId = draft.pool[itemIndex];
  if (
    !Number.isInteger(itemIndex) ||
    itemIndex < 0 ||
    itemIndex >= draft.pool.length ||
    itemId === undefined
  ) {
    return { ok: false, error: "invalid_item" };
  }

  const pool = draft.pool.filter((_, index) => index !== itemIndex);
  const picks = [...draft.picks, { characterId, itemId, at }];
  const advanced = advanceTurn({ ...draft, pool, picks });
  return {
    ok: true,
    itemId,
    draft: {
      ...advanced,
      status: pool.length === 0 ? "done" : "active",
      updatedAt: at,
    },
  };
}

/** Salta el turno actual sin gastar objeto (lo usa el DM si alguien no está). */
export function skipLootTurn(
  draft: LootDraft,
  at: IsoDate = new Date().toISOString(),
): LootDraft | null {
  if (draft.status !== "active" || draft.order.length === 0) return null;
  return { ...advanceTurn(draft), updatedAt: at };
}

/** Cierra el reparto; los objetos que queden se pierden (decisión del DM). */
export function closeLootDraft(
  draft: LootDraft,
  at: IsoDate = new Date().toISOString(),
): LootDraft | null {
  if (draft.status !== "active") return null;
  return { ...draft, status: "done", updatedAt: at };
}
