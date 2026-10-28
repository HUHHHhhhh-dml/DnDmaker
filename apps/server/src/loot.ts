import { and, eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import {
  applyLootPick,
  closeLootDraft,
  lootBaseOrder,
  lootDraftSchema,
  newId,
  skipLootTurn,
  type Character,
  type LootDraft,
} from "@protocol-life/shared";
import type { AppDatabase } from "./db";
import { HttpError, Repository } from "./repository";
import { lootDrafts } from "./schema";
import { SessionService } from "./sessions";

/**
 * Reparto de botín por turnos (Fase 4A-2).
 *
 * Solo se crea cuando la campaña tiene `shareLoot: false` y el encuentro
 * dejó objetos. El reparto pertenece a una sesión y se destruye con ella
 * (FK cascade). La lógica de turnos es pura (`@protocol-life/shared/loot`);
 * aquí solo se autentica, se persiste y se entregan los objetos.
 */

export interface CreateLootDraftInput {
  campaignId: string;
  sessionId: string;
  combatId?: string;
  encounterId: string;
  /** Unidades de la party con su SPD de combate. */
  units: { characterId: string; spd: number }[];
  itemIds: string[];
}

export interface LootPickResult {
  draft: LootDraft;
  itemId: string;
  character: Character;
}

const nowIso = (): string => new Date().toISOString();

export class LootService {
  constructor(
    private readonly db: AppDatabase,
    private readonly sqlite: Database.Database,
    private readonly repo: Repository,
    private readonly sessions: SessionService,
  ) {}

  /** Reparto activo de la sesión, si lo hay. */
  getBySession(sessionId: string): LootDraft | null {
    const row = this.db
      .select()
      .from(lootDrafts)
      .where(
        and(
          eq(lootDrafts.sessionId, sessionId),
          eq(lootDrafts.status, "active"),
        ),
      )
      .get();
    return row ? (row.state as LootDraft) : null;
  }

  /**
   * Crea el reparto al ganar un encuentro. **No abre transacción propia**: se
   * llama dentro de la transacción de cierre de combate para que botín y HP
   * sean atómicos. Cierra cualquier reparto anterior de la sesión.
   */
  createForVictory(input: CreateLootDraftInput): LootDraft | null {
    const order = lootBaseOrder(input.units);
    const pool = [...input.itemIds];
    if (order.length === 0 || pool.length === 0) return null;

    const now = nowIso();
    this.closeActiveForSession(input.sessionId, now);

    const draft: LootDraft = {
      id: newId("loot"),
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      ...(input.combatId ? { combatId: input.combatId } : {}),
      encounterId: input.encounterId,
      status: "active",
      pool,
      order,
      round: 1,
      turnIndex: 0,
      picks: [],
      createdAt: now,
      updatedAt: now,
    };
    const parsed = lootDraftSchema.parse(draft) as LootDraft;
    this.db
      .insert(lootDrafts)
      .values({
        id: parsed.id,
        campaignId: parsed.campaignId,
        sessionId: parsed.sessionId,
        combatId: parsed.combatId ?? null,
        encounterId: parsed.encounterId,
        status: parsed.status,
        state: parsed,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
      })
      .run();
    return parsed;
  }

  /** Cierra el reparto activo de una sesión (al empezar otro combate). */
  closeActiveForSession(sessionId: string, at = nowIso()): void {
    const drafts = this.db
      .select()
      .from(lootDrafts)
      .where(
        and(
          eq(lootDrafts.sessionId, sessionId),
          eq(lootDrafts.status, "active"),
        ),
      )
      .all();
    for (const row of drafts) {
      const current = row.state as LootDraft;
      const next = closeLootDraft({ ...current, updatedAt: at }, at);
      if (next) this.save(next);
    }
  }

  /** Un jugador elige un objeto. Solo su turno y solo para su ficha. */
  pick(code: string, token: string | null, itemIndex: number): LootPickResult {
    const identity = this.sessions.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
    }
    if (identity.role !== "player") {
      throw new HttpError(
        403,
        "dm_cannot_pick",
        "El DM no elige botín: cada jugador elige en su turno.",
      );
    }
    const characterId = identity.player.characterId;
    if (!characterId) {
      throw new HttpError(
        409,
        "no_character",
        "Todavía no tienes un personaje asignado en esta mesa.",
      );
    }

    const draft = this.getBySession(identity.session.id);
    if (!draft) {
      throw new HttpError(
        404,
        "loot_not_found",
        "No hay ningún reparto de botín activo.",
      );
    }

    const result = applyLootPick(draft, characterId, itemIndex);
    if (!result.ok) {
      if (result.error === "not_your_turn") {
        throw new HttpError(
          409,
          "not_your_turn",
          "No es tu turno: espera a que te toque elegir.",
        );
      }
      if (result.error === "invalid_item") {
        throw new HttpError(
          422,
          "invalid_item",
          "Ese objeto ya no está disponible en el reparto.",
        );
      }
      throw new HttpError(409, "loot_closed", "El reparto ya está cerrado.");
    }

    const itemId = result.itemId;
    if (!itemId) {
      throw new HttpError(422, "invalid_item", "Ese objeto ya no está disponible.");
    }
    // El DM pudo borrar el objeto entre el fin del combate y la elección.
    const campaign = this.repo.getCampaign(draft.campaignId);
    if (!campaign.content.items.some((item) => item.id === itemId)) {
      throw new HttpError(
        422,
        "invalid_item",
        "Ese objeto ya no existe en la campaña. El DM puede cerrar el reparto.",
      );
    }

    return this.sqlite.transaction(() => {
      // Entrega primero el objeto: si la ficha no se puede guardar, el reparto
      // no avanza y nada queda a medias.
      const character = this.repo.addInventoryItem(characterId, itemId, 1);
      this.save(result.draft);
      return { draft: result.draft, itemId, character };
    })();
  }

  /** Saltar el turno actual (DM). Útil si un jugador no está. */
  skip(code: string, token: string | null): LootDraft {
    const identity = this.requireDm(code, token);
    const draft = this.getBySession(identity.session.id);
    if (!draft) {
      throw new HttpError(404, "loot_not_found", "No hay ningún reparto activo.");
    }
    const next = skipLootTurn(draft);
    if (!next) {
      throw new HttpError(409, "loot_closed", "El reparto ya está cerrado.");
    }
    return this.sqlite.transaction(() => {
      this.save(next);
      return next;
    })();
  }

  /** Cerrar el reparto (DM). Los objetos que queden se pierden. */
  close(code: string, token: string | null): LootDraft {
    const identity = this.requireDm(code, token);
    const draft = this.getBySession(identity.session.id);
    if (!draft) {
      throw new HttpError(404, "loot_not_found", "No hay ningún reparto activo.");
    }
    const next = closeLootDraft(draft);
    if (!next) {
      throw new HttpError(409, "loot_closed", "El reparto ya está cerrado.");
    }
    return this.sqlite.transaction(() => {
      this.save(next);
      return next;
    })();
  }

  private requireDm(code: string, token: string | null) {
    const identity = this.sessions.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
    }
    if (identity.role !== "dm") {
      throw new HttpError(403, "dm_only", "Solo el DM puede hacer esta acción.");
    }
    return identity;
  }

  private save(draft: LootDraft): void {
    const parsed = lootDraftSchema.parse(draft) as LootDraft;
    this.db
      .update(lootDrafts)
      .set({
        status: parsed.status,
        state: parsed,
        updatedAt: parsed.updatedAt,
      })
      .where(eq(lootDrafts.id, parsed.id))
      .run();
  }
}
