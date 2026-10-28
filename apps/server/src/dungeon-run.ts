import { and, eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import {
  calculateStats,
  dungeonRunSchema,
  newId,
  sharesLoot,
  type Campaign,
  type CombatRewardSummary,
  type CombatState,
  type Dungeon,
  type DungeonRoom,
  type DungeonRoomAction,
  type DungeonRoomKind,
  type DungeonRun,
  type DungeonStartInput,
  type PublicDungeonRoom,
  type PublicDungeonRun,
  type Session,
} from "@protocol-life/shared";
import type { AppDatabase } from "./db";
import type { CombatService } from "./combat/service";
import type { LootService } from "./loot";
import { HttpError, Repository } from "./repository";
import { dungeonRuns } from "./schema";
import { SessionService, type SessionIdentity } from "./sessions";

/**
 * Run de la dungeon lineal+ (Fase 4C).
 *
 * La run pertenece a una sesión y guarda en qué sala está y cuáles ya se
 * resolvieron. El servicio orquesta combate, descanso y cofres, pero **no**
 * mete reglas en el motor puro: el ganador se marca desde el hook
 * `onCombatEnded` de `app.ts` cuando el `combatId` de la run coincide.
 *
 * El jugador recibe un `PublicDungeonRun` sin notas privadas; el DM recibe el
 * mismo snapshot y usa el contenido completo de la campaña para el editor.
 */

export interface DungeonChestResult {
  run: PublicDungeonRun;
  rewards: CombatRewardSummary | null;
}

const nowIso = (): string => new Date().toISOString();

function roomKind(room: DungeonRoom): DungeonRoomKind {
  return room.kind ?? "encounter";
}

/** Sala de encuentro sin encuentro vinculado: se puede avanzar sin combatir. */
function isAmbience(room: DungeonRoom): boolean {
  const kind = roomKind(room);
  return (kind === "encounter" || kind === "boss") && !room.encounterId;
}

function addOnce(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

export class DungeonRunService {
  /** Evita que el hook de combate cierre la run que acaba de abrir la sala. */
  private pendingDungeonCombat = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly sqlite: Database.Database,
    private readonly repo: Repository,
    private readonly sessions: SessionService,
    private readonly combat: CombatService,
    private readonly loot: LootService,
  ) {}

  /** Run activa de una sesión, ya saneada. */
  getBySession(sessionId: string): PublicDungeonRun | null {
    const row = this.activeRow(sessionId);
    if (!row) return null;
    const run = row.state as DungeonRun;
    const campaign = this.repo.getCampaign(run.campaignId);
    const dungeon = campaign.content.dungeons.find(
      (entry) => entry.id === run.dungeonId,
    );
    if (!dungeon) {
      // La mazmorra se borró con la run activa: la run deja de existir.
      this.endRun(run, nowIso());
      return null;
    }
    if (!dungeon.rooms.some((room) => room.id === run.currentRoomId)) {
      // El DM quitó la sala actual en el editor: la run queda inservible.
      this.endRun(run, nowIso());
      return null;
    }
    return this.buildPublic(run, dungeon);
  }

  /** GET de la mesa: DM y jugadores autenticados. */
  getByCode(code: string, token: string | null): PublicDungeonRun | null {
    const identity = this.authenticate(code, token);
    return this.getBySession(identity.session.id);
  }

  /** El DM inicia (o reinicia) la run. Cierra la anterior si existía. */
  start(
    code: string,
    token: string | null,
    input: DungeonStartInput,
  ): PublicDungeonRun {
    const identity = this.requireDm(code, token);
    if (this.combat.getLiveCombat(identity.session.campaignId)) {
      throw new HttpError(
        423,
        "combat_lock",
        "Termina el combate antes de empezar una mazmorra.",
      );
    }

    const campaign = this.repo.getCampaign(identity.session.campaignId);
    const dungeon = campaign.content.dungeons.find(
      (entry) => entry.id === input.dungeonId,
    );
    if (!dungeon) {
      throw new HttpError(404, "dungeon_not_found", "La mazmorra no existe.");
    }

    const entryRoomId =
      input.entryRoomId ?? dungeon.entryRoomId ?? dungeon.rooms[0]?.id;
    const entryRoom = dungeon.rooms.find((room) => room.id === entryRoomId);
    if (!entryRoom) {
      throw new HttpError(
        404,
        "room_not_found",
        "La sala de entrada no existe en la mazmorra.",
      );
    }

    const now = nowIso();
    const run: DungeonRun = {
      id: newId("run"),
      campaignId: identity.session.campaignId,
      sessionId: identity.session.id,
      dungeonId: dungeon.id,
      status: "active",
      currentRoomId: entryRoom.id,
      clearedRoomIds: [],
      openedRoomIds: [],
      restedRoomIds: [],
      startedAt: now,
      updatedAt: now,
    };
    const parsed = dungeonRunSchema.parse(run) as DungeonRun;

    this.sqlite.transaction(() => {
      // Una fila por sesión: empezar otra run reemplaza la anterior.
      this.db
        .delete(dungeonRuns)
        .where(eq(dungeonRuns.sessionId, identity.session.id))
        .run();
      this.insert(parsed);
    })();

    return this.buildPublic(parsed, dungeon);
  }

  /** Lanza el encuentro de la sala actual y guarda su `combatId` en la run. */
  startRoomEncounter(
    code: string,
    token: string | null,
  ): PublicDungeonRun {
    const { run, campaign, room } = this.requireCurrentContext(code, token);
    if (this.combat.getLiveCombat(campaign.id)) {
      throw new HttpError(
        423,
        "combat_lock",
        "Ya hay un combate en curso en la campaña.",
      );
    }

    const kind = roomKind(room);
    if (kind !== "encounter" && kind !== "boss") {
      throw new HttpError(
        422,
        "encounter_missing",
        "La sala actual no lanza encuentro.",
      );
    }
    if (!room.encounterId) {
      throw new HttpError(
        422,
        "encounter_missing",
        "La sala actual no tiene un encuentro vinculado.",
      );
    }
    if (run.clearedRoomIds.includes(room.id)) {
      throw new HttpError(
        409,
        "room_already_resolved",
        "La sala actual ya está superada.",
      );
    }
    if (
      !campaign.content.encounters.some(
        (encounter) => encounter.id === room.encounterId,
      )
    ) {
      throw new HttpError(
        422,
        "encounter_missing",
        "El encuentro de esta sala ya no existe.",
      );
    }

    this.pendingDungeonCombat = true;
    let combat: CombatState;
    try {
      combat = this.combat.startEncounter(
        campaign.id,
        room.encounterId,
        run.sessionId,
      );
    } finally {
      this.pendingDungeonCombat = false;
    }

    const next = this.save({
      ...run,
      combatId: combat.id,
      updatedAt: nowIso(),
    });
    return this.buildPublic(next, this.dungeonOf(campaign, run));
  }

  /** Cura a la party una vez por sala de descanso. */
  rest(code: string, token: string | null): PublicDungeonRun {
    const { run, campaign, room } = this.requireCurrentContext(code, token);
    if (this.combat.getLiveCombat(campaign.id)) {
      throw new HttpError(
        423,
        "combat_lock",
        "Termina el combate antes de descansar.",
      );
    }
    if (roomKind(room) !== "rest") {
      throw new HttpError(
        422,
        "room_action_mismatch",
        "La sala actual no es de descanso.",
      );
    }
    if (
      run.restedRoomIds.includes(room.id) ||
      run.clearedRoomIds.includes(room.id)
    ) {
      throw new HttpError(
        409,
        "room_already_resolved",
        "La party ya descansó en esta sala.",
      );
    }

    const next = this.sqlite.transaction(() => {
      this.repo.restParty(campaign.id);
      return this.save({
        ...run,
        restedRoomIds: addOnce(run.restedRoomIds, room.id),
        clearedRoomIds: addOnce(run.clearedRoomIds, room.id),
        updatedAt: nowIso(),
      });
    })();
    return this.buildPublic(next, this.dungeonOf(campaign, run));
  }

  /**
   * Abre el cofre de la sala actual una sola vez. La moneda va a la bolsa y
   * los objetos a la party (o a un reparto por turnos con `shareLoot` off).
   */
  openChest(code: string, token: string | null): DungeonChestResult {
    const { identity, run, campaign, room } = this.requireCurrentContext(
      code,
      token,
    );
    if (this.combat.getLiveCombat(campaign.id)) {
      throw new HttpError(
        423,
        "combat_lock",
        "Termina el combate antes de abrir el cofre.",
      );
    }
    if (roomKind(room) !== "treasure") {
      throw new HttpError(
        422,
        "room_action_mismatch",
        "La sala actual no tiene cofre.",
      );
    }
    if (
      run.openedRoomIds.includes(room.id) ||
      run.clearedRoomIds.includes(room.id)
    ) {
      throw new HttpError(
        409,
        "room_already_resolved",
        "El cofre de esta sala ya está abierto.",
      );
    }

    const characterIds = [
      ...new Set(
        identity.session.players
          .map((player) => player.characterId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const itemIds = room.rewards?.itemIds ?? [];
    const canDraft =
      !sharesLoot(campaign.settings) &&
      characterIds.length > 1 &&
      itemIds.length > 0;

    const result = this.sqlite.transaction(() => {
      const summary = this.repo.grantRewards({
        campaignId: campaign.id,
        rewards: room.rewards,
        characterIds,
        grantItems: !canDraft,
        // Cofre A: además de repartir/entregar, desbloquea para la campaña.
        unlockItems: room.unlockRewards === true,
      });

      let rewards = summary;
      if (canDraft) {
        const draft = this.loot.createForVictory({
          campaignId: campaign.id,
          sessionId: run.sessionId,
          // El cofre no es un encuentro: se guarda la sala como origen.
          encounterId: room.id,
          units: this.partySpd(campaign, characterIds),
          itemIds: [...itemIds],
        });
        rewards = {
          ...(summary ?? {}),
          pendingItemIds: [...itemIds],
          ...(draft ? { lootDraftId: draft.id } : {}),
        };
      }

      const next = this.save({
        ...run,
        openedRoomIds: addOnce(run.openedRoomIds, room.id),
        clearedRoomIds: addOnce(run.clearedRoomIds, room.id),
        updatedAt: nowIso(),
      });
      return { run: next, rewards: rewards ?? null };
    })();

    return {
      run: this.buildPublic(result.run, this.dungeonOf(campaign, run)),
      rewards: result.rewards,
    };
  }

  /**
   * Pasa a la siguiente sala. Solo si la actual está resuelta (o no tiene
   * acción); en la última sala termina la run.
   */
  advance(code: string, token: string | null): PublicDungeonRun | null {
    const { run, campaign, dungeon, room } = this.requireCurrentContext(
      code,
      token,
    );
    if (this.combat.getLiveCombat(campaign.id)) {
      throw new HttpError(
        423,
        "combat_lock",
        "Termina el combate antes de avanzar de sala.",
      );
    }

    const resolved =
      run.clearedRoomIds.includes(room.id) || isAmbience(room);
    if (!resolved) {
      throw new HttpError(
        409,
        "room_pending",
        "La sala actual todavía tiene una acción pendiente.",
      );
    }

    const index = dungeon.rooms.findIndex((entry) => entry.id === room.id);
    const nextRoom = dungeon.rooms[index + 1];
    if (!nextRoom) {
      this.endRun(run, nowIso());
      return null;
    }

    // `combatId` ya no aplica: al avanzar no hay combate vivo.
    const { combatId: _combatId, ...base } = run;
    const next = this.save({
      ...base,
      currentRoomId: nextRoom.id,
      updatedAt: nowIso(),
    });
    return this.buildPublic(next, dungeon);
  }

  /** Termina la run y devuelve a todos a su hoja. */
  end(code: string, token: string | null): void {
    const { run, campaign } = this.requireCurrentContext(code, token);
    if (this.combat.getLiveCombat(campaign.id)) {
      throw new HttpError(
        423,
        "combat_lock",
        "Termina el combate antes de cerrar la mazmorra.",
      );
    }
    this.endRun(run, nowIso());
  }

  /** Cierre interno (abrir una tienda en la mesa): no exige token. */
  closeForSession(sessionId: string): void {
    const row = this.activeRow(sessionId);
    if (!row) return;
    this.endRun(row.state as DungeonRun, nowIso());
  }

  /** Cierra la run si pertenece a la mazmorra que se acaba de borrar. */
  closeForDungeon(campaignId: string, dungeonId: string): void {
    const row = this.db
      .select()
      .from(dungeonRuns)
      .where(
        and(
          eq(dungeonRuns.campaignId, campaignId),
          eq(dungeonRuns.dungeonId, dungeonId),
          eq(dungeonRuns.status, "active"),
        ),
      )
      .get();
    if (!row) return;
    this.endRun(row.state as DungeonRun, nowIso());
  }

  /**
   * Hook al empezar un combate. Un combate normal (fuera de la dungeon)
   * cierra la run; el que lanza esta misma run queda marcado con `pending`.
   */
  handleCombatStarted(state: CombatState, session: Session): void {
    if (this.pendingDungeonCombat) {
      // Combate lanzado por la propia run: se marca antes de que el hook
      // termine para que el snapshot que se emite ya lleve el `combatId`.
      const current = this.activeRow(session.id);
      if (!current) return;
      const run = current.state as DungeonRun;
      if (run.combatId !== state.id) {
        this.save({ ...run, combatId: state.id, updatedAt: nowIso() });
      }
      return;
    }
    const row = this.activeRow(session.id);
    if (!row) return;
    const run = row.state as DungeonRun;
    if (run.combatId === state.id) return;
    this.endRun(run, nowIso());
  }

  /**
   * Hook al terminar un combate. Si es el combate de la run y gana la party,
   * la sala actual queda superada. En derrota/sin ganador no avanza, pero el
   * `combatId` se libera para poder reintentar.
   */
  handleCombatEnded(state: CombatState, session: Session): void {
    const row = this.activeRow(session.id);
    if (!row) return;
    const run = row.state as DungeonRun;
    if (run.combatId !== state.id) return;

    const { combatId: _combatId, ...base } = run;
    const next: DungeonRun = {
      ...base,
      ...(state.winner === "players"
        ? { clearedRoomIds: addOnce(run.clearedRoomIds, run.currentRoomId) }
        : {}),
      updatedAt: nowIso(),
    };
    this.save(next);
  }

  /* ---------------------------------------------------------------------- */
  /* Internos                                                               */
  /* ---------------------------------------------------------------------- */

  private buildPublic(run: DungeonRun, dungeon: Dungeon): PublicDungeonRun {
    const rooms: PublicDungeonRoom[] = dungeon.rooms.map((room) => {
      const kind = roomKind(room);
      return {
        id: room.id,
        name: room.name,
        ...(room.description ? { description: room.description } : {}),
        kind,
        ...(room.background ? { background: room.background } : {}),
        hasEncounter:
          (kind === "encounter" || kind === "boss") &&
          Boolean(room.encounterId),
        hasRewards: kind === "treasure" && Boolean(room.rewards),
        ...(kind === "treasure" && room.unlockRewards
          ? { unlockRewards: true }
          : {}),
      };
    });

    const current = rooms.find((room) => room.id === run.currentRoomId);
    const pendingAction = current ? this.pendingAction(run, current) : null;

    return {
      id: run.id,
      dungeonId: run.dungeonId,
      dungeonName: dungeon.name,
      ...(dungeon.description ? { dungeonDescription: dungeon.description } : {}),
      status: run.status,
      currentRoomId: run.currentRoomId,
      rooms,
      clearedRoomIds: [...run.clearedRoomIds],
      openedRoomIds: [...run.openedRoomIds],
      restedRoomIds: [...run.restedRoomIds],
      ...(run.combatId ? { combatId: run.combatId } : {}),
      canAdvance: pendingAction === null,
      pendingAction,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
    };
  }

  private pendingAction(
    run: DungeonRun,
    room: PublicDungeonRoom,
  ): DungeonRoomAction | null {
    if (run.clearedRoomIds.includes(room.id)) return null;
    if (room.kind === "rest") return "rest";
    if (room.kind === "treasure") return "chest";
    return room.hasEncounter ? "encounter" : null;
  }

  private partySpd(
    campaign: Campaign,
    characterIds: string[],
  ): { characterId: string; spd: number }[] {
    const characters = new Map(
      campaign.content.characters.map((character) => [character.id, character]),
    );
    const units: { characterId: string; spd: number }[] = [];
    for (const characterId of characterIds) {
      const character = characters.get(characterId);
      if (!character) continue;
      units.push({
        characterId,
        spd: calculateStats(character, campaign.content, campaign.rules).stats
          .spd,
      });
    }
    return units;
  }

  private dungeonOf(campaign: Campaign, run: DungeonRun): Dungeon {
    const dungeon = campaign.content.dungeons.find(
      (entry) => entry.id === run.dungeonId,
    );
    if (!dungeon) {
      throw new HttpError(404, "dungeon_not_found", "La mazmorra no existe.");
    }
    return dungeon;
  }

  private requireCurrentContext(
    code: string,
    token: string | null,
  ): {
    identity: Extract<SessionIdentity, { role: "dm" }>;
    run: DungeonRun;
    campaign: Campaign;
    dungeon: Dungeon;
    room: DungeonRoom;
  } {
    const identity = this.requireDm(code, token);
    const row = this.activeRow(identity.session.id);
    if (!row) {
      throw new HttpError(
        404,
        "no_active_run",
        "No hay ninguna mazmorra activa en la mesa.",
      );
    }
    const run = row.state as DungeonRun;
    const campaign = this.repo.getCampaign(run.campaignId);
    const dungeon = campaign.content.dungeons.find(
      (entry) => entry.id === run.dungeonId,
    );
    if (!dungeon) {
      throw new HttpError(404, "dungeon_not_found", "La mazmorra no existe.");
    }
    const room = dungeon.rooms.find(
      (entry) => entry.id === run.currentRoomId,
    );
    if (!room) {
      throw new HttpError(
        404,
        "room_not_found",
        "La sala actual ya no existe en la mazmorra.",
      );
    }
    return { identity, run, campaign, dungeon, room };
  }

  private activeRow(sessionId: string) {
    return this.db
      .select()
      .from(dungeonRuns)
      .where(
        and(
          eq(dungeonRuns.sessionId, sessionId),
          eq(dungeonRuns.status, "active"),
        ),
      )
      .get();
  }

  private insert(run: DungeonRun): void {
    const parsed = dungeonRunSchema.parse(run) as DungeonRun;
    this.db
      .insert(dungeonRuns)
      .values({
        id: parsed.id,
        campaignId: parsed.campaignId,
        sessionId: parsed.sessionId,
        dungeonId: parsed.dungeonId,
        status: parsed.status,
        state: parsed,
        createdAt: parsed.startedAt,
        updatedAt: parsed.updatedAt,
      })
      .run();
  }

  private save(run: DungeonRun): DungeonRun {
    const parsed = dungeonRunSchema.parse(run) as DungeonRun;
    this.db
      .update(dungeonRuns)
      .set({
        dungeonId: parsed.dungeonId,
        status: parsed.status,
        state: parsed,
        updatedAt: parsed.updatedAt,
      })
      .where(eq(dungeonRuns.id, parsed.id))
      .run();
    return parsed;
  }

  private endRun(run: DungeonRun, at: string): DungeonRun {
    return this.save({
      ...run,
      status: "ended",
      updatedAt: at,
    });
  }

  private authenticate(code: string, token: string | null) {
    const identity = this.sessions.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
    }
    return identity;
  }

  private requireDm(code: string, token: string | null) {
    const identity = this.authenticate(code, token);
    if (identity.role !== "dm") {
      throw new HttpError(
        403,
        "dm_only",
        "Solo el DM puede dirigir la mazmorra.",
      );
    }
    return identity;
  }
}
