import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import type {
  Campaign,
  Character,
  PublicSession,
  PublicSessionPlayer,
  SessionJoinInput,
  SessionPlayersEvent,
  SessionStateResponse,
} from "@protocol-life/shared";
import { ApiError, api } from "../lib/api";
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

  join: (code: string, input: SessionJoinInput) => Promise<boolean>;
  restore: (code: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  saveCharacter: (patch: Partial<Character>) => Promise<boolean>;
  leave: () => Promise<void>;
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
}));

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
      });
      return;
    }
    set({
      error: payload?.message ?? "La sala ya no es válida.",
      connected: false,
    });
  });
}
