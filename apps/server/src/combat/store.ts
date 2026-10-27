import { and, desc, eq, ne } from "drizzle-orm";
import type Database from "better-sqlite3";
import {
  combatEventSchema,
  combatStateSchema,
  type CombatEvent,
  type CombatState,
} from "@protocol-life/shared";
import type { AppDatabase } from "../db";
import { HttpError } from "../repository";
import { combatEvents, combatStates } from "../schema";

/**
 * Persistencia del combate (Fase 3).
 *
 * - `combat_states` guarda el JSON completo y validado con Zod.
 * - `combat_events` es un log append-only; cada evento del estado se inserta
 *   una sola vez gracias a `onConflictDoNothing` y `seq` = posición en el log.
 *
 * El estado es la fuente de verdad del motor. La tabla de eventos sirve para
 * auditoría/replay y no se modifica ni se borra por separado.
 */

export interface CombatStateMeta {
  campaignId: string;
  sessionId: string;
}

export interface StoredCombatState {
  id: string;
  campaignId: string;
  sessionId: string | null;
  encounterId: string;
  phase: CombatState["phase"];
  round: number;
  seed: string;
  state: CombatState;
  createdAt: string;
  updatedAt: string;
}

export type CombatEventRow = typeof combatEvents.$inferSelect;

const nowIso = (): string => new Date().toISOString();

export class CombatStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly sqlite: Database.Database,
  ) {}

  /** Crea un combate nuevo. El servicio valida antes que no haya otro vivo. */
  create(state: CombatState, meta: CombatStateMeta): CombatState {
    const parsed = this.parseState(state);
    const now = nowIso();

    this.sqlite.transaction(() => {
      this.db
        .insert(combatStates)
        .values({
          id: parsed.id,
          campaignId: meta.campaignId,
          sessionId: meta.sessionId,
          encounterId: parsed.encounterId,
          phase: parsed.phase,
          round: parsed.round,
          seed: parsed.seed,
          state: parsed,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      this.syncEvents(parsed, now);
    })();

    return parsed;
  }

  /** Actualiza el estado existente y sincroniza los eventos nuevos. */
  save(state: CombatState): CombatState {
    const parsed = this.parseState(state);
    const existing = this.db
      .select()
      .from(combatStates)
      .where(eq(combatStates.id, parsed.id))
      .get();
    if (!existing) {
      throw new HttpError(404, "combat_not_found", "Ese combate no existe.");
    }

    const now = nowIso();
    this.sqlite.transaction(() => {
      this.db
        .update(combatStates)
        .set({
          encounterId: parsed.encounterId,
          phase: parsed.phase,
          round: parsed.round,
          seed: parsed.seed,
          state: parsed,
          updatedAt: now,
        })
        .where(eq(combatStates.id, parsed.id))
        .run();
      this.syncEvents(parsed, now);
    })();

    return parsed;
  }

  get(id: string): StoredCombatState | null {
    const row = this.db
      .select()
      .from(combatStates)
      .where(eq(combatStates.id, id))
      .get();
    if (!row) return null;

    return {
      id: row.id,
      campaignId: row.campaignId,
      sessionId: row.sessionId,
      encounterId: row.encounterId,
      phase: row.phase,
      round: row.round,
      seed: row.seed,
      state: this.parseState(row.state),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  getState(id: string): CombatState | null {
    return this.get(id)?.state ?? null;
  }

  /** Combate no terminado de una campaña, si existe. */
  findLiveByCampaign(campaignId: string): StoredCombatState | null {
    const row = this.db
      .select()
      .from(combatStates)
      .where(
        and(
          eq(combatStates.campaignId, campaignId),
          ne(combatStates.phase, "ended"),
        ),
      )
      .orderBy(desc(combatStates.createdAt))
      .get();
    return row ? this.get(row.id) : null;
  }

  /**
   * Último combate terminado de una campaña (Fase 3F, riesgo 2).
   *
   * El TTL y el permiso de participación los aplica `CombatService`; el store
   * solo devuelve la fila más reciente en fase `ended`.
   */
  findLatestByCampaign(campaignId: string): StoredCombatState | null {
    const row = this.db
      .select()
      .from(combatStates)
      .where(
        and(
          eq(combatStates.campaignId, campaignId),
          eq(combatStates.phase, "ended"),
        ),
      )
      .orderBy(desc(combatStates.updatedAt))
      .get();
    return row ? this.get(row.id) : null;
  }

  /** Eventos persistidos en orden de resolución. */
  listEvents(combatId: string): CombatEventRow[] {
    return this.db
      .select()
      .from(combatEvents)
      .where(eq(combatEvents.combatId, combatId))
      .orderBy(combatEvents.seq)
      .all();
  }

  private parseState(state: unknown): CombatState {
    const parsed = combatStateSchema.safeParse(state);
    if (!parsed.success) {
      throw new HttpError(
        500,
        "invalid_combat_state",
        "El estado de combate guardado no es válido.",
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  private syncEvents(state: CombatState, now: string): void {
    state.log.forEach((event, index) => {
      this.insertEvent(event, state.id, index + 1, now);
    });
  }

  private insertEvent(
    event: CombatEvent,
    combatId: string,
    seq: number,
    now: string,
  ): void {
    // Validamos también el evento suelto para que una fila corrupta no pase
    // desapercibida aunque el estado completo haya parseado.
    const parsed = combatEventSchema.parse(event);
    this.db
      .insert(combatEvents)
      .values({
        id: parsed.id,
        combatId,
        seq,
        round: parsed.round,
        type: parsed.type,
        actorId: parsed.actorId ?? null,
        targetId: parsed.targetId ?? null,
        message: parsed.message,
        data: parsed.data ?? {},
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
  }
}
