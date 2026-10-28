import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import type {
  Campaign,
  Character,
  CombatEvent,
  DiceRoll,
  DiceRolledEvent,
  DiceSides,
  DungeonStateEvent,
  LootDraft,
  LootUpdatedEvent,
  PublicCombatState,
  PublicDungeonRun,
  PublicSession,
  PublicSessionPlayer,
  SessionJoinInput,
  SessionPlayersEvent,
  SessionStateResponse,
  ShopScene,
  StateFullPayload,
} from "@protocol-life/shared";
import { ApiError, api } from "../lib/api";
import {
  combatHasMissingContent,
  type CombatDeclaration,
} from "../lib/combat";
import {
  isRecentCombatDismissed,
  rememberRecentCombatDismissed,
} from "../lib/recentCombat";
import {
  clearPlayerSession,
  clearSessionToken,
  readPlayerSession,
  savePlayerSession,
  setSessionToken,
} from "../lib/sessionAuth";

/**
 * Estado del jugador en una mesa en vivo.
 *
 * El socket solo empuja cambios de estado; las mutaciones siempre van por HTTP
 * con el token de sesión. El token se guarda además en localStorage para poder
 * reconectar al recargar la pestaña.
 */

interface SessionStatePayload {
  role?: "dm" | "player";
  session: PublicSession;
}

interface SessionErrorPayload {
  code?: string;
  message?: string;
}

export interface PlayerState {
  token: string | null;
  code: string | null;
  session: PublicSession | null;
  campaign: Campaign | null;
  character: Character | null;
  player: PublicSessionPlayer | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  closed: boolean;
  /** Estado público del combate vivo (o terminado pendiente de cerrar). */
  combat: PublicCombatState | null;
  /**
   * Último combate terminado dentro del TTL del servidor (riesgo 2). Se
   * muestra como resultado tras recargar y se puede descartar localmente.
   */
  recentCombat: PublicCombatState | null;
  /** Timeline de eventos; el estado ya viene resuelto del servidor. */
  combatEvents: CombatEvent[];
  combatError: string | null;
  /** Reparto de botín por turnos de la sala (`settings.shareLoot === false`). */
  lootDraft: LootDraft | null;
  /** Escena de tienda abierta por el DM (Fase 4A-3); null = hoja normal. */
  activeShop: ShopScene | null;
  /** Run de mazmorra activa de la mesa (Fase 4C); null = sin mazmorra. */
  dungeonRun: PublicDungeonRun | null;
  /** Últimas tiradas compartidas de la sala (log efímero del cliente). */
  diceRolls: DiceRoll[];

  join: (code: string, input: SessionJoinInput) => Promise<boolean>;
  restore: (code: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  saveCharacter: (patch: Partial<Character>) => Promise<boolean>;
  leave: () => Promise<void>;
  declareCombat: (actions: CombatDeclaration[]) => void;
  lockCombat: (actions: CombatDeclaration[]) => void;
  dismissCombat: () => void;
  dismissRecentCombat: () => void;
  clearCombatError: () => void;
  /** Elige un objeto del reparto (solo en tu turno). `null` si fue bien. */
  pickLoot: (itemIndex: number) => Promise<string | null>;
  /**
   * Compra en la tienda abierta: paga la bolsa y desbloquea el objeto para
   * toda la campaña. Devuelve `null` o el mensaje de error.
   */
  buyShopItem: (itemId: string) => Promise<string | null>;
  /**
   * Compra una skill de la tienda abierta: paga la bolsa y la desbloquea para
   * la campaña (no se equipa). Devuelve `null` o el mensaje de error.
   */
  buyShopSkill: (skillId: string) => Promise<string | null>;
  /** Tira un dado en el servidor y devuelve la tirada o un mensaje de error. */
  rollDice: (sides: DiceSides, count?: number) => Promise<DiceRoll | string>;
}

let socket: Socket | null = null;
let hasConnectedOnce = false;

function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

const EMPTY_STATE: Pick<
  PlayerState,
  | "token"
  | "code"
  | "session"
  | "campaign"
  | "character"
  | "player"
  | "connected"
  | "loading"
  | "error"
  | "closed"
  | "combat"
  | "recentCombat"
  | "combatEvents"
  | "combatError"
  | "lootDraft"
  | "activeShop"
  | "dungeonRun"
  | "diceRolls"
> = {
  token: null,
  code: null,
  session: null,
  campaign: null,
  character: null,
  player: null,
  connected: false,
  loading: false,
  error: null,
  closed: false,
  combat: null,
  recentCombat: null,
  combatEvents: [],
  combatError: null,
  lootDraft: null,
  activeShop: null,
  dungeonRun: null,
  diceRolls: [],
};

export function describePlayerError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.issues?.length) {
      return `${error.message} ${error.issues
        .slice(0, 2)
        .map((issue) => issue.message)
        .join(" · ")}`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Algo salió mal.";
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  ...EMPTY_STATE,

  async join(code, input) {
    const normalized = normalizeCode(code);
    set({ loading: true, error: null, closed: false });
    try {
      const joined = await api.joinSession(normalized, input);
      const token = joined.playerToken;
      setSessionToken(token);
      savePlayerSession({
        code: normalized,
        token,
        playerId: joined.player.id,
        name: joined.player.name,
      });
      set({
        token,
        code: normalized,
        session: joined.session,
        campaign: joined.campaign,
        character: joined.character,
        player: joined.player,
        closed: false,
        connected: false,
        combat: null,
        recentCombat: null,
        combatEvents: [],
        combatError: null,
        lootDraft: null,
        activeShop: null,
        dungeonRun: null,
        diceRolls: [],
      });
      connectSocket(normalized, token, set, get);
      return true;
    } catch (error) {
      set({ error: describePlayerError(error) });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async restore(code) {
    const normalized = normalizeCode(code);
    const stored = readPlayerSession(normalized);
    if (!stored) return false;

    set({ loading: true, error: null, closed: false });
    setSessionToken(stored.token);
    try {
      const state = await api.getSessionState(stored.code);
      if (state.role !== "player") {
        throw new ApiError(
          403,
          "not_player",
          "La sesión guardada no pertenece a un jugador.",
        );
      }
      set({
        combat: null,
        recentCombat: null,
        combatEvents: [],
        combatError: null,
        lootDraft: null,
        activeShop: null,
        dungeonRun: null,
        diceRolls: [],
      });
      applyState(state, stored.code, stored.token, set);
      connectSocket(stored.code, stored.token, set, get);
      return true;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401 || status === 403 || status === 404) {
        clearPlayerSession(normalized);
        clearSessionToken();
        disconnectSocket();
        set({
          token: null,
          code: null,
          session: null,
          campaign: null,
          character: null,
          player: null,
          connected: false,
          closed: false,
          combat: null,
          recentCombat: null,
          combatEvents: [],
          combatError: null,
          lootDraft: null,
          activeShop: null,
          dungeonRun: null,
          diceRolls: [],
          error: describePlayerError(error),
        });
      } else {
        set({ error: describePlayerError(error) });
      }
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async refresh() {
    const { code, token } = get();
    if (!code || !token) return;
    try {
      const state = await api.getSessionState(code);
      if (state.role !== "player") return;
      set({
        session: state.session,
        campaign: state.campaign,
        character: state.character ?? null,
        player: state.player ?? null,
        lootDraft: state.lootDraft ?? null,
        activeShop: state.activeShop ?? null,
        dungeonRun: state.dungeonRun ?? null,
        error: null,
      });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401 || status === 403 || status === 404) {
        clearPlayerSession(code);
        clearSessionToken();
        disconnectSocket();
        set({
          ...EMPTY_STATE,
          error: describePlayerError(error),
        });
      } else {
        set({ error: describePlayerError(error) });
      }
    }
  },

  async saveCharacter(patch) {
    const character = get().character;
    if (!character) return false;
    set({ loading: true, error: null });
    try {
      const saved = await api.patchContent("characters", character.id, patch);
      set({ character: saved, error: null });
      // El servidor también emite `campaign:refresh`; este refresco mantiene
      // la party y el contenido saneado al día aunque el socket tarde.
      void get().refresh();
      return true;
    } catch (error) {
      set({ error: describePlayerError(error) });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async leave() {
    const code = get().code;
    try {
      if (code) await api.leaveSession(code);
    } catch {
      // La sala pudo cerrarse mientras el jugador estaba dentro.
    } finally {
      disconnectSocket();
      if (code) clearPlayerSession(code);
      clearSessionToken();
      set({ ...EMPTY_STATE });
    }
  },

  declareCombat(actions) {
    if (!socket) {
      set({ combatError: "No estás conectado a la mesa." });
      return;
    }
    const combat = get().combat;
    if (!combat) {
      set({ combatError: "No hay un combate activo." });
      return;
    }
    socket.emit("combat:declare", {
      combatId: combat.id,
      round: combat.round,
      actions,
    });
    set({ combatError: null });
  },

  /**
   * El lock siempre manda primero la declaración actual. Socket.IO conserva
   * el orden, así el servidor valida/bloquea exactamente lo que ve el jugador.
   * La ronda/combate sellan ambos paquetes: si la mesa ya resolvió, el
   * servidor ignora el lock viejo y reenvía el estado nuevo.
   */
  lockCombat(actions) {
    if (!socket) {
      set({ combatError: "No estás conectado a la mesa." });
      return;
    }
    const combat = get().combat;
    if (!combat) {
      set({ combatError: "No hay un combate activo." });
      return;
    }
    socket.emit("combat:declare", {
      combatId: combat.id,
      round: combat.round,
      actions,
    });
    socket.emit("combat:lock", {
      combatId: combat.id,
      round: combat.round,
    });
    set({ combatError: null });
  },

  dismissCombat() {
    const session = get().session;
    const combat = get().combat;
    const code = get().code;
    // El resultado no debe volver a aparecer al recargar dentro del TTL.
    if (combat && code) rememberRecentCombatDismissed(code, combat.id);
    set({
      combat: null,
      recentCombat: null,
      combatEvents: [],
      combatError: null,
      session: session ? { ...session, status: "playing" } : session,
    });
    // Limpia de la campaña saneada las referencias de enemigos que solo se
    // incluyen durante el combate.
    void get().refresh();
  },

  dismissRecentCombat() {
    const recent = get().recentCombat;
    const code = get().code;
    if (recent && code) rememberRecentCombatDismissed(code, recent.id);
    set({ recentCombat: null, combatEvents: [] });
  },

  clearCombatError() {
    set({ combatError: null });
  },

  async pickLoot(itemIndex) {
    const code = get().code;
    if (!code) return "No estás conectado a la mesa.";
    try {
      const result = await api.pickLoot(code, itemIndex);
      set({ lootDraft: result.draft, character: result.character });
      return null;
    } catch (error) {
      return describePlayerError(error);
    }
  },

  async buyShopItem(itemId) {
    const code = get().code;
    if (!code) return "No estás conectado a la mesa.";
    try {
      const result = await api.buyShopItem(code, itemId);
      set({ activeShop: result.shop });
      // La bolsa y el desbloqueo llegan por `campaign:refresh`; el servidor es
      // la única autoridad del gasto.
      return null;
    } catch (error) {
      return describePlayerError(error);
    }
  },

  async buyShopSkill(skillId) {
    const code = get().code;
    if (!code) return "No estás conectado a la mesa.";
    try {
      const result = await api.buyShopSkill(code, skillId);
      set({ activeShop: result.shop });
      // Igual que con los objetos: la bolsa y el desbloqueo se refrescan desde
      // el servidor; aquí solo se actualiza la escena (stock/estado).
      return null;
    } catch (error) {
      return describePlayerError(error);
    }
  },

  async rollDice(sides, count = 1) {
    const code = get().code;
    if (!code) return "No estás conectado a la mesa.";
    try {
      const roll = await api.rollDice(code, sides, count);
      set({ diceRolls: appendDiceRoll(get().diceRolls, roll) });
      return roll;
    } catch (error) {
      return describePlayerError(error);
    }
  },
}));

const DICE_LOG_LIMIT = 10;

function appendDiceRoll(rolls: DiceRoll[], roll: DiceRoll): DiceRoll[] {
  if (rolls.some((entry) => entry.id === roll.id)) return rolls;
  return [...rolls, roll].slice(-DICE_LOG_LIMIT);
}

function applyState(
  state: SessionStateResponse,
  code: string,
  token: string,
  set: (partial: Partial<PlayerState>) => void,
): void {
  set({
    token,
    code,
    session: state.session,
    campaign: state.campaign,
    character: state.character ?? null,
    player: state.player ?? null,
    lootDraft: state.lootDraft ?? null,
    activeShop: state.activeShop ?? null,
    dungeonRun: state.dungeonRun ?? null,
    closed: false,
  });
}

function connectSocket(
  code: string,
  token: string,
  set: (partial: Partial<PlayerState>) => void,
  get: () => PlayerState,
): void {
  disconnectSocket();
  hasConnectedOnce = false;
  const next = io({
    auth: { code, token },
    transports: ["websocket", "polling"],
  });
  socket = next;

  next.on("connect", () => {
    set({ connected: true });
    if (hasConnectedOnce) void get().refresh();
    hasConnectedOnce = true;
  });

  next.on("disconnect", () => {
    set({ connected: false });
  });

  next.on("connect_error", () => {
    set({ connected: false });
  });

  next.on("session:state", (payload: SessionStatePayload) => {
    if (!payload?.session) return;
    set({ session: payload.session });
  });

  next.on("state:full", (payload: StateFullPayload) => {
    if (payload?.role !== "player" || !payload.session || !payload.campaign) {
      return;
    }
    const activeCode = payload.session.code || code;
    const recent =
      payload.recentCombat &&
      !isRecentCombatDismissed(activeCode, payload.recentCombat.id)
        ? payload.recentCombat
        : null;
    set({
      session: payload.session,
      campaign: payload.campaign,
      character: payload.character ?? get().character,
      player: payload.player ?? get().player,
      combat: payload.combat,
      recentCombat: recent,
      combatEvents: payload.combat?.log ?? recent?.log ?? [],
      combatError: null,
      lootDraft: payload.lootDraft ?? null,
      activeShop: payload.activeShop ?? null,
      dungeonRun: payload.dungeonRun ?? null,
      closed: false,
    });
  });

  next.on("combat:started", (payload: { combat: PublicCombatState }) => {
    if (!payload?.combat) return;
    const current = get().session;
    const campaign = get().campaign;
    set({
      combat: payload.combat,
      recentCombat: null,
      combatEvents: payload.combat.log,
      combatError: null,
      session: current ? { ...current, status: "combat" } : current,
    });
    // No depender solo del `campaign:refresh` del servidor: si el combate
    // referencia skills/objetos que la campaña saneada aún no trae, pedimos el
    // estado de sesión (que en combate incluye las referencias enemigas).
    if (
      !campaign ||
      combatHasMissingContent(payload.combat, campaign.content)
    ) {
      void get().refresh();
    }
  });

  next.on("combat:state", (payload: { combat: PublicCombatState }) => {
    if (!payload?.combat) return;
    set({
      combat: payload.combat,
      combatEvents: payload.combat.log,
    });
  });

  next.on("combat:event", (payload: { event: CombatEvent }) => {
    const event = payload?.event;
    if (!event) return;
    const current = get().combatEvents;
    if (current.some((entry) => entry.id === event.id)) return;
    set({ combatEvents: [...current, event] });
  });

  next.on(
    "combat:ended",
    (payload: { winner?: PublicCombatState["winner"]; log: CombatEvent[] }) => {
      const current = get().combat;
      const session = get().session;
      const log = Array.isArray(payload?.log) ? payload.log : current?.log ?? [];
      set({
        combat: current
          ? {
              ...current,
              phase: "ended",
              winner: payload?.winner,
              log,
            }
          : current,
        combatEvents: log,
        combatError: null,
        session: session ? { ...session, status: "playing" } : session,
      });
    },
  );

  next.on("error", (payload: SessionErrorPayload) => {
    set({
      combatError:
        payload?.message ?? "No se pudo completar la acción de combate.",
    });
  });

  next.on("session:players", (payload: SessionPlayersEvent) => {
    const current = get().session;
    if (!current) return;
    const ownPlayer = get().player;
    const nextOwn = ownPlayer
      ? (payload.players.find((entry) => entry.id === ownPlayer.id) ?? ownPlayer)
      : ownPlayer;
    set({
      session: {
        ...current,
        players: payload.players,
        status: payload.status,
        dmConnected: payload.dmConnected ?? current.dmConnected,
      },
      player: nextOwn,
    });
  });

  next.on("loot:updated", (payload: LootUpdatedEvent) => {
    set({ lootDraft: payload?.draft ?? null });
  });

  next.on("shop:state", (payload: { shop: ShopScene | null }) => {
    set({ activeShop: payload?.shop ?? null });
  });

  next.on("dungeon:state", (payload: DungeonStateEvent) => {
    set({ dungeonRun: payload?.run ?? null });
  });

  next.on("dice:rolled", (payload: DiceRolledEvent) => {
    if (!payload?.roll) return;
    set({ diceRolls: appendDiceRoll(get().diceRolls, payload.roll) });
  });

  next.on("campaign:refresh", () => {
    void get().refresh();
  });

  next.on("session:closed", () => {
    const currentCode = get().code;
    disconnectSocket();
    if (currentCode) clearPlayerSession(currentCode);
    clearSessionToken();
    set({
      closed: true,
      token: null,
      connected: false,
      combat: null,
      recentCombat: null,
      combatEvents: [],
      combatError: null,
      lootDraft: null,
      activeShop: null,
      dungeonRun: null,
      diceRolls: [],
    });
  });

  next.on("session:error", (payload: SessionErrorPayload) => {
    if (payload?.code === "invalid_session") {
      const currentCode = get().code;
      disconnectSocket();
      if (currentCode) clearPlayerSession(currentCode);
      clearSessionToken();
      set({
        error: payload.message ?? "La sala ya no es válida.",
        connected: false,
        closed: true,
        token: null,
        combat: null,
        recentCombat: null,
        combatEvents: [],
        combatError: null,
        lootDraft: null,
        activeShop: null,
        dungeonRun: null,
        diceRolls: [],
      });
      return;
    }
    set({
      error: payload?.message ?? "La sala ya no es válida.",
      connected: false,
    });
  });
}
