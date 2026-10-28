import { randomUUID } from "node:crypto";
import {
  clamp,
  combatScenePatchSchema,
  createRng,
  newId,
  resolveRound,
  type Campaign,
  type CombatEvent,
  type CombatScene,
  type CombatScenePatch,
  type CombatState,
  type CombatUnit,
  type Encounter,
  type SessionPlayer,
  type Team,
} from "@protocol-life/shared";
import { HttpError, type Repository } from "../repository";
import type { SessionRow, SessionService } from "../sessions";
import {
  normalizeDeclarations,
  type DeclaredActionInput,
} from "./declarations";
import { applyCharacterOverrides, snapshotUnit } from "./snapshot";
import { CombatStore, type StoredCombatState } from "./store";
import {
  allAliveLocked,
  hasLivingTeam,
  isAlive,
  isUnitLocked,
  markUnitLocked,
  markUnitUnlocked,
} from "./units";

/**
 * Dominio de combate (Fase 3A + orquestador de ronda de 3C).
 *
 * Inicia/termina encuentros, guarda el snapshot, valida declaraciones, aplica
 * locks y llama al motor puro de `@protocol-life/shared` para resolver la
 * ronda. El cliente no calcula nada: todo el resultado nace del servidor.
 */

export { isAlive } from "./units";
export type { DeclaredActionInput } from "./declarations";

export interface StartEncounterOptions {
  /** Semilla fija para tests/replay; si falta se genera una aleatoria. */
  seed?: string;
  /**
   * Aplica la tirada de SPD (base + 1..4) a cada unidad al iniciar. Default
   * true en producción; los tests que comparan stats exactos usan false.
   * Es determinista con la seed del combate (corriente `${seed}:speed`).
   */
  speedRoll?: boolean;
}

/**
 * Quién declara o bloquea.
 *
 * - `player`: la unidad se deduce del token/ficha del jugador de la sesión.
 * - `dm`: el DM debe indicar `unitId` (un enemigo vivo). Si el encuentro tiene
 *   un único enemigo vivo, puede omitirse.
 */
export type CombatActor =
  | { role: "dm"; unitId?: string }
  | { role: "player"; player: SessionPlayer };

/** Costura con la capa de red; 3D la conecta a Socket.IO sin filtrar la seed. */
export interface CombatEventSink {
  onStarted?: (state: CombatState, session: SessionRow) => void;
  /** Cada evento de resolución, incluido el combatEnd final. */
  onCombatEvent?: (
    state: CombatState,
    event: CombatEvent,
    session: SessionRow,
  ) => void;
  /** Estado actualizado tras declarar, bloquear, resolver o terminar. */
  onCombatState?: (state: CombatState, session: SessionRow) => void;
  /** Fin del combate; el estado ya tiene phase "ended". */
  onCombatEnded?: (state: CombatState, session: SessionRow) => void;
}

/** Tope defensivo de unidades; el estado persistido también lo valida. */
export const MAX_COMBAT_UNITS = 100;

/**
 * Ventana durante la que un combate terminado se reenvía en `state:full`
 * (Fase 3F, riesgo 2). Pasado el TTL, el cliente ya no recibe el resultado
 * histórico al reconectar.
 */
export const RECENT_COMBAT_TTL_MS = 30 * 60 * 1000;

/** Quién consulta el último combate; el jugador debe haber participado. */
export type CombatHistoryViewer =
  | { role: "dm" }
  | { role: "player"; characterId?: string | null };

export interface RecentCombatOptions {
  /** Reloj inyectable para tests del TTL. */
  now?: Date;
  ttlMs?: number;
}

/** Detecta bando ganador por unidades activas; `undefined` = sin ganador. */
export function detectWinner(units: CombatUnit[]): Team | undefined {
  const playersAlive = units.some(
    (unit) => unit.team === "players" && isAlive(unit),
  );
  const enemiesAlive = units.some(
    (unit) => unit.team === "enemies" && isAlive(unit),
  );
  if (playersAlive && !enemiesAlive) return "players";
  if (!playersAlive && enemiesAlive) return "enemies";
  return undefined;
}

export class CombatService {
  constructor(
    private readonly repo: Repository,
    private readonly sessions: SessionService,
    private readonly store: CombatStore,
    private readonly events: CombatEventSink = {},
  ) {}

  /**
   * Crea el snapshot de la party y de los enemigos, persiste el estado y deja
   * la mesa en `combat`. Las acciones empiezan vacías; la red se añade en 3D.
   */
  startEncounter(
    campaignId: string,
    encounterId: string,
    sessionId: string,
    options: StartEncounterOptions = {},
  ): CombatState {
    const campaign = this.repo.getCampaign(campaignId);
    const encounter = campaign.content.encounters.find(
      (entry) => entry.id === encounterId,
    );
    if (!encounter) {
      throw new HttpError(404, "encounter_not_found", "Ese encuentro no existe.");
    }

    const session = this.sessions.getById(sessionId);
    if (!session) {
      throw new HttpError(404, "session_not_found", "Esa sala no existe.");
    }
    if (session.campaignId !== campaignId) {
      throw new HttpError(
        409,
        "session_campaign_mismatch",
        "La sala no pertenece a esta campaña.",
      );
    }

    // El estado persistido es la fuente de verdad. Si la sesión quedó en
    // `combat` por un cierre inesperado pero no hay estado vivo, permitimos
    // recuperar arrancando un encuentro nuevo.
    const live = this.store.findLiveByCampaign(campaignId);
    if (live) {
      throw new HttpError(
        409,
        "combat_in_progress",
        "Ya hay un combate en curso en esta campaña.",
      );
    }

    // La seed se decide antes de instanciar unidades: la tirada de SPD deriva
    // de ella (`${seed}:speed`) y debe ser reproducible por combate.
    const seed = options.seed?.trim() || randomUUID();
    const speedRng =
      (options.speedRoll ?? true) ? createRng(`${seed}:speed`) : null;
    const nextSpeedRoll = (): number | undefined =>
      speedRng ? 1 + speedRng.int(4) : undefined;

    const players = this.buildParty(campaign, session, nextSpeedRoll);

    // Solo entran jugadores presentes en la sala. Comprobamos antes de
    // instanciar enemigos para fallar rápido con un error claro.
    if (players.length === 0) {
      throw new HttpError(
        422,
        "no_players",
        "No hay jugadores conectados con ficha en la sala para iniciar el combate.",
      );
    }

    const enemies = this.buildEnemies(campaign, encounter, nextSpeedRoll);
    if (enemies.length === 0) {
      throw new HttpError(
        422,
        "no_enemies",
        "El encuentro no tiene enemigos que instanciar.",
      );
    }

    const units = [...players, ...enemies];
    if (units.length > MAX_COMBAT_UNITS) {
      throw new HttpError(
        422,
        "too_many_units",
        `El combate tendría ${units.length} unidades; el máximo es ${MAX_COMBAT_UNITS}.`,
      );
    }
    const actions: CombatState["actions"] = {};
    const specialCooldowns: CombatState["specialCooldowns"] = {};
    for (const unit of units) {
      actions[unit.id] = [];
      specialCooldowns[unit.id] = {};
    }

    const startEvent: CombatEvent = {
      id: newId("evt"),
      round: 1,
      type: "roundStart",
      message: `Comienza el combate: ${encounter.name} (ronda 1).`,
      data: {
        encounterId,
        players: players.length,
        enemies: enemies.length,
      },
    };

    const scene: CombatScene = { theme: encounter.sceneTheme ?? "paper" };
    if (encounter.background) scene.floor = encounter.background;
    if (encounter.backgroundWall) scene.wall = encounter.backgroundWall;

    const state: CombatState = {
      id: newId("cmb"),
      encounterId,
      round: 1,
      phase: "declaring",
      seed,
      units,
      actions,
      specialCooldowns,
      scene,
      log: [startEvent],
    };

    // El estado y el cambio a `combat` deben entrar juntos: si algo falla, no
    // queremos una sala en combate sin snapshot (o al revés).
    this.repo.transaction(() => {
      this.store.create(state, { campaignId, sessionId });
      this.sessions.setStatus(sessionId, "combat");
    });
    this.events.onStarted?.(state, session);
    return state;
  }

  /**
   * Reemplaza las acciones declaradas por una unidad (Fase 3C).
   *
   * Un jugador solo puede declarar su propia ficha; el DM, una unidad enemiga
   * viva. El servidor normaliza `unitId`/`locked`, valida slots, objetivos,
   * skills, utilidad, dominio y redirección, guarda y notifica el estado.
   */
  declareActions(
    actor: CombatActor,
    combatId: string,
    actions: readonly DeclaredActionInput[],
  ): CombatState {
    const record = this.requireRecord(combatId);
    const session = this.requireSession(record);
    const state = structuredClone(record.state);

    if (state.phase !== "declaring") {
      throw new HttpError(
        409,
        "invalid_phase",
        "Solo se pueden declarar acciones en la fase declaring.",
      );
    }

    const unit = this.selectUnitForActor(state, actor, session);
    if (isUnitLocked(state, unit.id)) {
      throw new HttpError(409, "unit_locked", `${unit.name} ya está bloqueada.`);
    }

    const campaign = this.repo.getCampaign(record.campaignId);
    state.actions[unit.id] = normalizeDeclarations({
      state,
      unit,
      actions,
      content: campaign.content,
    });
    markUnitUnlocked(state, unit.id);

    const saved = this.store.save(state);
    this.events.onCombatState?.(saved, session);
    return saved;
  }

  /**
   * Cambia la escena visual del combate (Fase 3F.5). Solo el DM.
   *
   * Es presentación: no toca HP, fichas ni reglas. Valida el patch con Zod,
   * lo mezcla sobre `state.scene` y persiste/emite el estado para que toda la
   * sala reciba `combat:state`. Funciona durante el combate (incluida la fase
   * de resolución); solo se rechaza si el combate ya terminó.
   */
  setScene(
    combatId: string,
    actor: CombatActor,
    patch: CombatScenePatch,
  ): CombatState {
    if (actor.role !== "dm") {
      throw new HttpError(403, "dm_only", "Solo el DM puede cambiar la escena.");
    }
    const record = this.requireRecord(combatId);
    const session = this.requireSession(record);
    if (record.state.phase === "ended") {
      throw new HttpError(409, "invalid_phase", "El combate ya terminó.");
    }

    const parsed = combatScenePatchSchema.parse(patch);
    const state = structuredClone(record.state);
    // Merge: un campo ausente conserva el valor actual; `""` limpia la capa.
    state.scene = { ...(state.scene ?? {}), ...parsed };

    const saved = this.store.save(state);
    this.events.onCombatState?.(saved, session);
    return saved;
  }

  /**
   * Bloquea la unidad del jugador o todas las unidades enemigas vivas (DM).
   * Cuando todas las unidades vivas están bloqueadas, la fase pasa a
   * `resolving`. Las derrotadas no cuentan.
   */
  lockActions(combatId: string, actor: CombatActor): CombatState {
    const record = this.requireRecord(combatId);
    const session = this.requireSession(record);

    if (record.state.phase === "ended") {
      throw new HttpError(409, "invalid_phase", "El combate ya terminó.");
    }
    // Reintento idempotente: la ronda ya está lista.
    if (record.state.phase === "resolving") return record.state;

    const state = structuredClone(record.state);
    if (actor.role === "player") {
      const unit = this.findPlayerUnit(state, actor.player, session);
      if (!unit) {
        throw new HttpError(404, "unit_not_found", "Tu unidad no está en el combate.");
      }
      // Si su unidad ya cayó no hay nada que bloquear: no cuenta para el lock.
      if (isAlive(unit)) markUnitLocked(state, unit.id);
    } else {
      for (const unit of state.units) {
        if (unit.team === "enemies" && isAlive(unit)) {
          markUnitLocked(state, unit.id);
        }
      }
    }

    if (allAliveLocked(state)) state.phase = "resolving";
    const saved = this.store.save(state);
    this.events.onCombatState?.(saved, session);
    return saved;
  }

  /**
   * Auto-lock al desconectarse un jugador durante el combate (3F.5).
   *
   * La unidad NO se elimina: se conserva en el snapshot para que el jugador
   * pueda reconectar. Para que la ronda no quede bloqueada, se bloquea con
   * las acciones que tuviera (cero si no llegó a declarar). Si con eso ya
   * están bloqueadas todas las unidades vivas, la ronda se resuelve igual
   * que si el jugador hubiera pulsado «Listo».
   *
   * Es best-effort: sin combate vivo, sin unidad o con la unidad ya
   * bloqueada no hace nada. La invoca el socket de combate en `disconnect`.
   */
  handlePlayerDisconnected(
    campaignId: string,
    characterId?: string,
  ): CombatState | null {
    if (!characterId) return null;
    const record = this.store.findLiveByCampaign(campaignId);
    if (!record || record.state.phase !== "declaring") return null;

    const state = structuredClone(record.state);
    const unit = state.units.find(
      (entry) => entry.team === "players" && entry.characterId === characterId,
    );
    if (!unit || !isAlive(unit) || isUnitLocked(state, unit.id)) return null;

    markUnitLocked(state, unit.id);
    const saved = this.store.save(state);

    // Misma salida que un lock normal: si era el último, se resuelve.
    if (allAliveLocked(saved)) return this.resolveCombatRound(saved.id);

    const session = record.sessionId
      ? this.sessions.getById(record.sessionId)
      : null;
    if (session) this.events.onCombatState?.(saved, session);
    return saved;
  }

  /**
   * Resuelve la ronda con el motor puro y persiste el resultado.
   *
   * El motor ya incrementa la ronda, limpia acciones, añade los eventos al
   * log y calcula el ganador. Aquí solo se guarda, se emiten eventos, se
   * resetea el lock de la ronda siguiente y, si el combate terminó, se llama a
   * `endEncounter` (que persiste HP y devuelve la sesión a `playing`).
   */
  resolveCombatRound(combatId: string): CombatState {
    const record = this.requireRecord(combatId);
    const current = record.state;

    // Reintento tras un combate cerrado: no se vuelve a resolver ni a emitir.
    if (current.phase === "ended") return current;

    const ready = allAliveLocked(current);
    if (!ready) {
      const emptyActions = Object.values(current.actions).every(
        (list) => list.length === 0,
      );
      const decided =
        Boolean(current.winner) ||
        !hasLivingTeam(current, "players") ||
        !hasLivingTeam(current, "enemies");
      // Recuperación: un estado ya decidido se quedó en declaring sin acciones.
      if (current.phase === "declaring" && emptyActions && decided) {
        return this.finishCombat(combatId, "recovery");
      }
      throw new HttpError(
        409,
        "round_not_ready",
        "La ronda todavía no está lista: faltan bloqueos.",
      );
    }
    if (current.phase !== "declaring" && current.phase !== "resolving") {
      throw new HttpError(
        409,
        "invalid_phase",
        "El combate no está en una fase resoluble.",
      );
    }

    const session = this.requireSession(record);
    const campaign = this.repo.getCampaign(record.campaignId);
    const draft = structuredClone(current);
    draft.phase = "resolving";

    const { state: resolved, events } = resolveRound(
      draft,
      draft.actions,
      campaign.content,
      campaign.rules,
    );
    // El lock es por ronda; el motor no conoce este campo de UI/servidor.
    resolved.lockedUnits = {};

    // Primero se persiste el resultado; endEncounter lee el estado guardado.
    this.store.save(resolved);
    for (const event of events) {
      this.events.onCombatEvent?.(resolved, event, session);
    }

    const winner = detectWinner(resolved.units);
    const noActiveBand =
      !hasLivingTeam(resolved, "players") ||
      !hasLivingTeam(resolved, "enemies");
    if (winner || noActiveBand) {
      return this.finishCombat(
        combatId,
        winner === "players"
          ? "victory"
          : winner === "enemies"
            ? "defeat"
            : "no_units",
      );
    }

    this.events.onCombatState?.(resolved, session);
    return resolved;
  }

  /**
   * Termina el combate, persiste el HP de la party y devuelve la mesa a
   * `playing`. Es idempotente: llamarlo dos veces no duplica eventos ni HP.
   */
  endEncounter(combatId: string, reason = "dm"): CombatState {
    const record = this.store.get(combatId);
    if (!record) {
      throw new HttpError(404, "combat_not_found", "Ese combate no existe.");
    }
    if (record.state.phase === "ended") {
      // Recupera el estado de la mesa si el proceso murió entre persistir el
      // fin del combate y liberar `combat`.
      if (record.sessionId) this.sessions.setStatus(record.sessionId, "playing");
      return record.state;
    }

    const campaign = this.repo.getCampaign(record.campaignId);
    const state: CombatState = structuredClone(record.state);
    const winner = detectWinner(state.units);

    state.phase = "ended";
    if (winner) state.winner = winner;
    else delete state.winner;

    // El motor incrementa `state.round` al terminar la ronda resuelta. El
    // combatEnd pertenece a la ronda que se acaba de jugar, no a la siguiente
    // (que nunca llegó a declararse), así que usamos la última ronda del log.
    const endRound = state.log.at(-1)?.round ?? state.round;
    const endEvent: CombatEvent = {
      id: newId("evt"),
      round: endRound,
      type: "combatEnd",
      message:
        winner === "players"
          ? `Victoria de la party (${reason}).`
          : winner === "enemies"
            ? `Derrota de la party (${reason}).`
            : `Combate terminado sin ganador (${reason}).`,
      data: { reason, winner: winner ?? null },
    };
    state.log.push(endEvent);

    // HP persistente y fin del combate entran juntos: o se guardan las dos
    // cosas o no se guarda ninguna.
    this.repo.transaction(() => {
      for (const unit of state.units) {
        if (unit.team !== "players") continue;
        const hp =
          campaign.rules.hpPersistence === "restore"
            ? unit.stats.hpMax
            : clamp(unit.hpCurrent, 0, unit.stats.hpMax);
        try {
          this.repo.setCharacterCurrentHp(unit.characterId, hp);
        } catch (error) {
          // La ficha pudo borrarse fuera de combate; cualquier otro fallo debe
          // abortar la transacción para no dejar HP a medias.
          if (!(error instanceof HttpError && error.code === "character_not_found")) {
            throw error;
          }
        }
      }

      this.store.save(state);
      if (record.sessionId) this.sessions.setStatus(record.sessionId, "playing");
    });

    // El fin también se notifica a la sala (3D). El combatEnd va como evento
    // de resolución; después el estado final y el cierre.
    const session = record.sessionId
      ? this.sessions.getById(record.sessionId)
      : null;
    if (session) {
      this.events.onCombatEvent?.(state, endEvent, session);
      this.events.onCombatState?.(state, session);
      this.events.onCombatEnded?.(state, session);
    }
    return state;
  }

  /** Cierra el combate tras resolver (victoria, derrota o recuperación). */
  private finishCombat(combatId: string, reason: string): CombatState {
    return this.endEncounter(combatId, reason);
  }

  private requireRecord(combatId: string): StoredCombatState {
    const record = this.store.get(combatId);
    if (!record) {
      throw new HttpError(404, "combat_not_found", "Ese combate no existe.");
    }
    return record;
  }

  private requireSession(record: StoredCombatState): SessionRow {
    if (!record.sessionId) {
      throw new HttpError(
        409,
        "session_not_found",
        "El combate no está asociado a una sala.",
      );
    }
    const session = this.sessions.getById(record.sessionId);
    if (!session) {
      throw new HttpError(409, "session_not_found", "La sala del combate ya no existe.");
    }
    return session;
  }

  /**
   * Un jugador solo declara su unidad. La identidad se resuelve contra la
   * sesión persistida (id + token), no contra el `characterId` que mande el
   * cliente, para que no pueda declarar por otro.
   */
  private findPlayerUnit(
    state: CombatState,
    player: SessionPlayer,
    session: SessionRow,
  ): CombatUnit | undefined {
    const member = session.players.find(
      (entry) => entry.id === player.id && entry.token === player.token,
    );
    if (!member) {
      throw new HttpError(
        403,
        "forbidden",
        "Tu jugador no pertenece a esta sala.",
      );
    }
    if (!member.characterId) {
      throw new HttpError(
        409,
        "player_without_character",
        "Tu jugador no tiene una ficha asignada.",
      );
    }
    return state.units.find(
      (unit) =>
        unit.team === "players" && unit.characterId === member.characterId,
    );
  }

  private selectUnitForActor(
    state: CombatState,
    actor: CombatActor,
    session: SessionRow,
  ): CombatUnit {
    if (actor.role === "player") {
      const unit = this.findPlayerUnit(state, actor.player, session);
      if (!unit) {
        throw new HttpError(404, "unit_not_found", "Tu unidad no está en el combate.");
      }
      if (!isAlive(unit)) {
        throw new HttpError(409, "unit_defeated", "Tu unidad ya está derrotada.");
      }
      return unit;
    }

    const livingEnemies = state.units.filter(
      (unit) => unit.team === "enemies" && isAlive(unit),
    );
    if (actor.unitId) {
      const unit = state.units.find((entry) => entry.id === actor.unitId);
      if (!unit) {
        throw new HttpError(404, "unit_not_found", "Esa unidad no está en el combate.");
      }
      if (unit.team !== "enemies") {
        throw new HttpError(
          403,
          "dm_only_enemies",
          "El DM solo puede declarar unidades enemigas.",
        );
      }
      if (!isAlive(unit)) {
        throw new HttpError(409, "unit_defeated", "Esa unidad ya está derrotada.");
      }
      return unit;
    }
    if (livingEnemies.length === 1) return livingEnemies[0]!;
    if (livingEnemies.length === 0) {
      throw new HttpError(404, "no_enemies", "No queda ningún enemigo vivo.");
    }
    throw new HttpError(
      422,
      "unit_required",
      "El DM debe indicar qué unidad enemiga declara.",
    );
  }

  /** Estado actual para reconexión/API (3D). */
  getState(combatId: string): CombatState {
    const state = this.store.getState(combatId);
    if (!state) {
      throw new HttpError(404, "combat_not_found", "Ese combate no existe.");
    }
    return state;
  }

  /** Combate no terminado de la campaña, si existe. */
  getLiveCombat(campaignId: string): CombatState | null {
    return this.store.findLiveByCampaign(campaignId)?.state ?? null;
  }

  /**
   * Último combate terminado dentro del TTL (Fase 3F, riesgo 2).
   *
   * - El DM ve cualquier combate terminado de su campaña.
   * - Un jugador solo lo ve si su ficha participó en él. Se comprueba contra
   *   el snapshot persistido, nunca contra un `characterId` del cliente.
   * - Pasado el TTL se devuelve `null` y el cliente vuelve a su ficha normal.
   */
  getRecentCombat(
    campaignId: string,
    viewer: CombatHistoryViewer,
    options: RecentCombatOptions = {},
  ): CombatState | null {
    const record = this.store.findLatestByCampaign(campaignId);
    if (!record) return null;

    const now = options.now ?? new Date();
    const ttlMs = options.ttlMs ?? RECENT_COMBAT_TTL_MS;
    const updatedAt = Date.parse(record.updatedAt);
    if (!Number.isFinite(updatedAt) || now.getTime() - updatedAt > ttlMs) {
      return null;
    }

    if (viewer.role === "player") {
      const characterId = viewer.characterId;
      if (!characterId) return null;
      const participated = record.state.units.some(
        (unit) => unit.team === "players" && unit.characterId === characterId,
      );
      if (!participated) return null;
    }

    return record.state;
  }

  private buildParty(
    campaign: Campaign,
    session: SessionRow,
    nextSpeedRoll: () => number | undefined,
  ): CombatUnit[] {
    const characters = new Map(
      campaign.content.characters.map((character) => [character.id, character]),
    );
    const units: CombatUnit[] = [];

    for (const player of session.players) {
      // Presencia real: un jugador que no está conectado no entra al combate.
      if (!player.characterId || !player.connected) continue;
      const character = characters.get(player.characterId);
      if (!character) {
        throw new HttpError(
          422,
          "player_character_missing",
          `La ficha de ${player.name} ya no existe en la campaña.`,
        );
      }
      units.push(
        snapshotUnit(character, {
          campaign,
          team: "players",
          speedRoll: nextSpeedRoll(),
        }),
      );
    }

    return units;
  }

  private buildEnemies(
    campaign: Campaign,
    encounter: Encounter,
    nextSpeedRoll: () => number | undefined,
  ): CombatUnit[] {
    const characters = new Map(
      campaign.content.characters.map((character) => [character.id, character]),
    );
    const units: CombatUnit[] = [];

    for (const spawn of encounter.enemies) {
      const base = characters.get(spawn.characterId);
      if (!base) {
        throw new HttpError(
          422,
          "enemy_not_found",
          "Uno de los enemigos del encuentro ya no existe en la campaña.",
        );
      }
      const count = clamp(Math.trunc(spawn.count ?? 1), 1, 20);
      for (let index = 0; index < count; index += 1) {
        const merged = applyCharacterOverrides(base, spawn.overrides);
        // Los enemigos no arrastran HP persistente de la ficha base; solo un
        // override explícito puede fijar su HP inicial.
        if (spawn.overrides?.hpCurrent === undefined) {
          delete merged.hpCurrent;
        }
        units.push(
          snapshotUnit(merged, {
            campaign,
            team: "enemies",
            speedRoll: nextSpeedRoll(),
          }),
        );
      }
    }

    return units;
  }
}
