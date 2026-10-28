import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import {
  CURRENCY_NAME,
  type CombatEvent,
  type CombatRewardSummary,
  type CombatScenePatchInput,
  type DiceRoll,
  type DiceRolledEvent,
  type DiceSides,
  type DungeonStateEvent,
  type LootDraft,
  type LootUpdatedEvent,
  type PublicCombatState,
  type PublicDungeonRun,
  type PublicSession,
  type PublicSessionPlayer,
  type SessionPlayersEvent,
  type ShopScene,
  type StateFullPayload,
} from "@protocol-life/shared";
import { ApiError, api } from "../lib/api";
import type { CombatDeclaration } from "../lib/combat";
import {
  isRecentCombatDismissed,
  rememberRecentCombatDismissed,
} from "../lib/recentCombat";
import {
  clearDmSession,
  clearSessionToken,
  readDmSession,
  saveDmSession,
  setSessionToken,
} from "../lib/sessionAuth";
import { describeError, useAppStore } from "./useAppStore";

interface LiveState {
  role: "dm" | null;
  session: PublicSession | null;
  campaignId: string | null;
  code: string | null;
  connected: boolean;
  loading: boolean;
  error: string | null;

  /** Combate vivo (o terminado pendiente de cerrar) para la consola DM. */
  combat: PublicCombatState | null;
  /** Último combate terminado dentro del TTL (riesgo 2). */
  recentCombat: PublicCombatState | null;
  combatEvents: CombatEvent[];
  combatError: string | null;
  /** Reparto de botín por turnos de la sala (`settings.shareLoot === false`). */
  lootDraft: LootDraft | null;
  /** Escena de tienda abierta en la mesa (Fase 4A-3). */
  activeShop: ShopScene | null;
  /** Run de mazmorra activa de la mesa (Fase 4C); null = sin mazmorra. */
  dungeonRun: PublicDungeonRun | null;
  /** Hay una llamada de mazmorra en vuelo (una sola cada vez). */
  dungeonBusy: boolean;
  /** Últimas tiradas compartidas de la sala (log efímero del cliente). */
  diceRolls: DiceRoll[];

  host: (
    campaignId: string,
    input?: { requirePin?: boolean; pin?: string },
  ) => Promise<PublicSession>;
  resume: (campaignId: string) => Promise<boolean>;
  close: () => Promise<void>;
  detach: () => void;

  startCombat: (encounterId: string) => void;
  declareCombat: (unitId: string, actions: CombatDeclaration[]) => void;
  lockCombat: (unitId?: string, actions?: CombatDeclaration[]) => void;
  endCombat: () => void;
  /** Fase 3F.5: solo DM; el servidor difunde combat:state a la sala. */
  setCombatScene: (patch: CombatScenePatchInput) => void;
  dismissCombat: () => void;
  dismissRecentCombat: () => void;
  clearCombatError: () => void;
  /** DM: salta el turno actual sin entregar objeto. */
  skipLoot: () => Promise<boolean>;
  /** DM: cierra el reparto; lo no elegido se pierde. */
  closeLoot: () => Promise<boolean>;
  /** DM: abre una tienda de la campaña en la mesa. */
  openShop: (shopId: string) => Promise<boolean>;
  /** DM: cierra la tienda abierta y devuelve a los jugadores a su hoja. */
  closeShop: () => Promise<boolean>;
  /** DM: inicia (o reinicia) la run de una mazmorra de la campaña. */
  startDungeon: (dungeonId: string, entryRoomId?: string) => Promise<boolean>;
  /** DM: lanza el encuentro de la sala actual. */
  startDungeonEncounter: () => Promise<boolean>;
  /** DM: descansa una vez en la sala de descanso actual. */
  restDungeon: () => Promise<boolean>;
  /** DM: abre el cofre de la sala actual (notifica las recompensas). */
  openDungeonChest: () => Promise<boolean>;
  /** DM: avanza de sala; si era la última, la mazmorra termina. */
  advanceDungeon: () => Promise<boolean>;
  /** DM: termina la run y devuelve a los jugadores a su hoja. */
  endDungeon: () => Promise<boolean>;
  /** DM: tirada compartida; el servidor decide el resultado. */
  rollDice: (sides: DiceSides, count?: number) => Promise<DiceRoll | string>;
}

const EMPTY_COMBAT = {
  combat: null,
  recentCombat: null,
  combatEvents: [],
  combatError: null,
} satisfies Pick<
  LiveState,
  "combat" | "recentCombat" | "combatEvents" | "combatError"
>;

let socket: Socket | null = null;

/** Resumen legible de lo que salió de un cofre, para el aviso del DM. */
function describeChestRewards(rewards: CombatRewardSummary | null): string {
  if (!rewards) return "El cofre estaba vacío.";
  const parts: string[] = [];
  if (rewards.currency) {
    parts.push(`+${rewards.currency} ${CURRENCY_NAME}`);
  }
  const items = rewards.itemIds?.length ?? 0;
  if (items > 0) parts.push(`${items} objeto${items === 1 ? "" : "s"}`);
  const pending = rewards.pendingItemIds?.length ?? 0;
  if (pending > 0) parts.push(`${pending} por repartir`);
  const unlocked = rewards.unlockedItemIds?.length ?? 0;
  if (unlocked > 0) {
    // Con A el mismo objeto se entrega y se desbloquea: no lo repetimos.
    parts.push(
      items > 0 && unlocked >= items
        ? "desbloqueado para la campaña"
        : `${unlocked} objeto${unlocked === 1 ? "" : "s"} desbloqueado${
            unlocked === 1 ? "" : "s"
          } para la campaña`,
    );
  }
  // Las skills de un cofre siempre se desbloquean (no pasan por inventario).
  const unlockedSkills = rewards.unlockedSkillIds?.length ?? 0;
  if (unlockedSkills > 0) {
    parts.push(
      `${unlockedSkills} skill${
        unlockedSkills === 1 ? "" : "s"
      } desbloqueada${unlockedSkills === 1 ? "" : "s"} para la campaña`,
    );
  }
  if (parts.length === 0) return "Cofre abierto.";
  return `Cofre abierto: ${parts.join(" · ")}.`;
}

function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

export const useLiveStore = create<LiveState>((set, get) => ({
  role: null,
  session: null,
  campaignId: null,
  code: null,
  connected: false,
  loading: false,
  error: null,
  lootDraft: null,
  activeShop: null,
  dungeonRun: null,
  dungeonBusy: false,
  diceRolls: [],
  ...EMPTY_COMBAT,

  async host(campaignId, input) {
    set({ loading: true, error: null });
    try {
      const hosted = await api.hostSession(campaignId, input);
      setSessionToken(hosted.dmToken);
      saveDmSession({
        campaignId,
        code: hosted.session.code,
        token: hosted.dmToken,
      });
      set({
        role: "dm",
        session: hosted.session,
        campaignId,
        code: hosted.session.code,
        lootDraft: null,
        activeShop: null,
        dungeonRun: null,
        diceRolls: [],
        dungeonBusy: false,
        ...EMPTY_COMBAT,
      });
      connectSocket(hosted.session.code, hosted.dmToken, set, get);
      await useAppStore.getState().refreshCampaign();
      useAppStore.getState().notify("ok", `Sala ${hosted.session.code} abierta.`);
      return hosted.session;
    } catch (error) {
      const message = describeError(error);
      set({ error: message });
      useAppStore.getState().notify("error", message);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  async resume(campaignId) {
    const stored = readDmSession(campaignId);
    if (!stored) return false;
    set({ loading: true, error: null });
    setSessionToken(stored.token);
    try {
      const state = await api.getSessionState(stored.code);
      if (state.role !== "dm") {
        throw new ApiError(403, "not_dm", "Este token no es de DM.");
      }
      set({
        role: "dm",
        session: state.session,
        campaignId,
        code: stored.code,
        lootDraft: state.lootDraft ?? null,
        activeShop: state.activeShop ?? null,
        dungeonRun: state.dungeonRun ?? null,
        dungeonBusy: false,
        ...EMPTY_COMBAT,
      });
      connectSocket(stored.code, stored.token, set, get);
      return true;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401 || status === 404) {
        clearDmSession(campaignId);
        clearSessionToken();
        set({
          session: null,
          role: null,
          code: null,
          campaignId: null,
          lootDraft: null,
          activeShop: null,
          dungeonRun: null,
          diceRolls: [],
          dungeonBusy: false,
        });
        return false;
      }
      const message = describeError(error);
      set({ error: message });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async close() {
    const code = get().code;
    const campaignId = get().campaignId;
    if (!code) return;
    try {
      await api.closeSession(code);
      if (campaignId) clearDmSession(campaignId);
      await useAppStore.getState().refreshCampaign();
      useAppStore.getState().notify("ok", "Sala cerrada.");
    } catch (error) {
      useAppStore.getState().notify("error", describeError(error));
    } finally {
      disconnectSocket();
      clearSessionToken();
      set({
        role: null,
        session: null,
        campaignId: null,
        code: null,
        connected: false,
        lootDraft: null,
        activeShop: null,
        dungeonRun: null,
        diceRolls: [],
        dungeonBusy: false,
        ...EMPTY_COMBAT,
      });
    }
  },

  detach() {
    disconnectSocket();
    clearSessionToken();
    set({
      role: null,
      session: null,
      campaignId: null,
      code: null,
      connected: false,
      error: null,
      lootDraft: null,
      activeShop: null,
      dungeonRun: null,
      diceRolls: [],
      dungeonBusy: false,
      ...EMPTY_COMBAT,
    });
  },

  startCombat(encounterId) {
    if (!socket) {
      set({ combatError: "No estás conectado a la mesa." });
      return;
    }
    socket.emit("combat:start", { encounterId });
    set({ combatError: null });
  },

  /**
   * El DM declara una unidad enemiga. `combatId`/`round` sellan el paquete:
   * si la ronda ya cambió, el servidor lo ignora y reenvía el estado actual.
   */
  declareCombat(unitId, actions) {
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
      unitId,
      actions,
    });
    set({ combatError: null });
  },

  /**
   * Lock del DM: bloquea a todas las unidades enemigas vivas. Si se pasan
   * acciones, primero se declaran para que el lock refleje lo que ve el DM.
   */
  lockCombat(unitId, actions) {
    if (!socket) {
      set({ combatError: "No estás conectado a la mesa." });
      return;
    }
    const combat = get().combat;
    if (!combat) {
      set({ combatError: "No hay un combate activo." });
      return;
    }
    if (unitId && actions) {
      socket.emit("combat:declare", {
        combatId: combat.id,
        round: combat.round,
        unitId,
        actions,
      });
    }
    socket.emit("combat:lock", {
      combatId: combat.id,
      round: combat.round,
    });
    set({ combatError: null });
  },

  endCombat() {
    if (!socket) {
      set({ combatError: "No estás conectado a la mesa." });
      return;
    }
    socket.emit("combat:end", {});
    set({ combatError: null });
  },

  setCombatScene(patch) {
    if (!socket) {
      set({ combatError: "No estás conectado a la mesa." });
      return;
    }
    socket.emit("combat:scene", patch);
    set({ combatError: null });
  },

  dismissCombat() {
    const combat = get().combat;
    const code = get().code;
    if (combat && code) rememberRecentCombatDismissed(code, combat.id);
    set({ ...EMPTY_COMBAT });
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

  async skipLoot() {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    try {
      const draft = await api.skipLoot(code);
      set({ lootDraft: draft });
      return true;
    } catch (error) {
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async closeLoot() {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    try {
      const draft = await api.closeLoot(code);
      set({ lootDraft: draft });
      return true;
    } catch (error) {
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async openShop(shopId) {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    try {
      const shop = await api.openShop(code, shopId);
      // El servidor cierra la run al abrir la tienda; lo reflejamos ya para
      // que la escena de mazmorra no tape la tienda mientras llega el evento.
      set({ activeShop: shop, dungeonRun: null });
      return true;
    } catch (error) {
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async closeShop() {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    try {
      await api.closeShop(code);
      set({ activeShop: null });
      return true;
    } catch (error) {
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async startDungeon(dungeonId, entryRoomId) {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    set({ dungeonBusy: true });
    try {
      const run = await api.startDungeon(code, dungeonId, entryRoomId);
      // El servidor cierra la tienda al iniciar la run; el socket también lo
      // avisa, pero no dependemos de él para no pintar dos escenas a la vez.
      set({ dungeonRun: run, activeShop: null, dungeonBusy: false });
      useAppStore.getState().notify("ok", `«${run.dungeonName}» en marcha.`);
      void useAppStore.getState().refreshCampaign();
      return true;
    } catch (error) {
      set({ dungeonBusy: false });
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async startDungeonEncounter() {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    set({ dungeonBusy: true });
    try {
      const run = await api.startDungeonEncounter(code);
      const room = run.rooms.find((entry) => entry.id === run.currentRoomId);
      set({ dungeonRun: run, dungeonBusy: false });
      useAppStore
        .getState()
        .notify(
          "ok",
          room
            ? `Encuentro de «${room.name}» iniciado.`
            : "Encuentro de la sala iniciado.",
        );
      return true;
    } catch (error) {
      set({ dungeonBusy: false });
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async restDungeon() {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    set({ dungeonBusy: true });
    try {
      const run = await api.restDungeon(code);
      set({ dungeonRun: run, dungeonBusy: false });
      useAppStore.getState().notify("ok", "La party descansa y recupera HP.");
      void useAppStore.getState().refreshCampaign();
      return true;
    } catch (error) {
      set({ dungeonBusy: false });
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async openDungeonChest() {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    set({ dungeonBusy: true });
    try {
      const { run, rewards } = await api.openDungeonChest(code);
      set({ dungeonRun: run, dungeonBusy: false });
      useAppStore.getState().notify("ok", describeChestRewards(rewards));
      void useAppStore.getState().refreshCampaign();
      return true;
    } catch (error) {
      set({ dungeonBusy: false });
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async advanceDungeon() {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    set({ dungeonBusy: true });
    try {
      const run = await api.advanceDungeon(code);
      set({ dungeonRun: run, dungeonBusy: false });
      const roomName = run
        ? (run.rooms.find((room) => room.id === run.currentRoomId)?.name ??
          "la siguiente sala")
        : null;
      useAppStore
        .getState()
        .notify(
          "ok",
          roomName
            ? `Avanzas a «${roomName}».`
            : "Mazmorra completada: era la última sala.",
        );
      void useAppStore.getState().refreshCampaign();
      return true;
    } catch (error) {
      set({ dungeonBusy: false });
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },

  async rollDice(sides, count = 1) {
    const code = get().code;
    if (!code) return "No hay una sala abierta.";
    try {
      const roll = await api.rollDice(code, sides, count);
      set({ diceRolls: appendDiceRoll(get().diceRolls, roll) });
      return roll;
    } catch (error) {
      return describeError(error);
    }
  },

  async endDungeon() {
    const code = get().code;
    if (!code) {
      useAppStore.getState().notify("error", "No hay una sala abierta.");
      return false;
    }
    set({ dungeonBusy: true });
    try {
      await api.endDungeon(code);
      set({ dungeonRun: null, dungeonBusy: false });
      useAppStore
        .getState()
        .notify("ok", "Mazmorra cerrada; los jugadores vuelven a su hoja.");
      return true;
    } catch (error) {
      set({ dungeonBusy: false });
      useAppStore.getState().notify("error", describeError(error));
      return false;
    }
  },
}));

const DICE_LOG_LIMIT = 10;

function appendDiceRoll(rolls: DiceRoll[], roll: DiceRoll): DiceRoll[] {
  if (rolls.some((entry) => entry.id === roll.id)) return rolls;
  return [...rolls, roll].slice(-DICE_LOG_LIMIT);
}

function connectSocket(
  code: string,
  token: string,
  set: (partial: Partial<LiveState>) => void,
  get: () => LiveState,
): void {
  disconnectSocket();
  const next = io({
    auth: { code, token },
    transports: ["websocket", "polling"],
  });
  socket = next;

  next.on("connect", () => {
    set({ connected: true, error: null });
    void useAppStore.getState().refreshCampaign();
  });

  next.on("disconnect", () => {
    set({ connected: false });
  });

  next.on("connect_error", (error: Error) => {
    set({ connected: false, error: error.message });
  });

  next.on("session:state", (payload: { session: PublicSession }) => {
    if (!payload?.session) return;
    set({ session: payload.session, code: payload.session.code });
  });

  next.on("state:full", (payload: StateFullPayload) => {
    if (payload?.role !== "dm" || !payload.session) return;
    const activeCode = payload.session.code || code;
    const recent =
      payload.recentCombat &&
      !isRecentCombatDismissed(activeCode, payload.recentCombat.id)
        ? payload.recentCombat
        : null;
    set({
      session: payload.session,
      code: activeCode,
      combat: payload.combat,
      recentCombat: recent,
      combatEvents: payload.combat?.log ?? recent?.log ?? [],
      combatError: null,
      lootDraft: payload.lootDraft ?? null,
      activeShop: payload.activeShop ?? null,
      dungeonRun: payload.dungeonRun ?? null,
    });
  });

  next.on("combat:started", (payload: { combat: PublicCombatState }) => {
    if (!payload?.combat) return;
    const current = get().session;
    set({
      combat: payload.combat,
      recentCombat: null,
      combatEvents: payload.combat.log,
      combatError: null,
      session: current ? { ...current, status: "combat" } : current,
    });
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

  next.on("error", (payload: { code?: string; message?: string }) => {
    set({
      combatError:
        payload?.message ?? "No se pudo completar la acción de combate.",
    });
  });

  next.on("session:players", (payload: SessionPlayersEvent) => {
    const current = get().session;
    if (!current) return;
    set({
      session: {
        ...current,
        players: payload.players satisfies PublicSessionPlayer[],
        status: payload.status,
        dmConnected: payload.dmConnected ?? current.dmConnected,
      },
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
    void useAppStore.getState().refreshCampaign();
  });

  next.on("session:closed", () => {
    const campaignId = get().campaignId;
    if (campaignId) clearDmSession(campaignId);
    disconnectSocket();
    clearSessionToken();
    set({
      role: null,
      session: null,
      campaignId: null,
      code: null,
      connected: false,
      lootDraft: null,
      activeShop: null,
      dungeonRun: null,
      diceRolls: [],
      dungeonBusy: false,
      ...EMPTY_COMBAT,
    });
    useAppStore.getState().notify("info", "La sala se cerró.");
  });

  next.on("session:error", (payload: { code?: string; message?: string }) => {
    if (payload?.code === "invalid_session") {
      const campaignId = get().campaignId;
      disconnectSocket();
      if (campaignId) clearDmSession(campaignId);
      clearSessionToken();
      set({
        role: null,
        session: null,
        campaignId: null,
        code: null,
        connected: false,
        error: payload.message ?? "La sala ya no es válida.",
        lootDraft: null,
        activeShop: null,
        dungeonRun: null,
        diceRolls: [],
        dungeonBusy: false,
        ...EMPTY_COMBAT,
      });
      useAppStore.getState().notify("info", "La sala anterior ya no está abierta.");
      return;
    }
    set({ error: payload?.message ?? "La sala ya no es válida.", connected: false });
  });
}
