import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import type {
  PublicSession,
  PublicSessionPlayer,
  SessionPlayersEvent,
} from "@protocol-life/shared";
import { ApiError, api } from "../lib/api";
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

  host: (
    campaignId: string,
    input?: { requirePin?: boolean; pin?: string },
  ) => Promise<PublicSession>;
  resume: (campaignId: string) => Promise<boolean>;
  close: () => Promise<void>;
  detach: () => void;
}

let socket: Socket | null = null;

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
      });
      connectSocket(stored.code, stored.token, set, get);
      return true;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401 || status === 404) {
        clearDmSession(campaignId);
        clearSessionToken();
        set({ session: null, role: null, code: null, campaignId: null });
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
    });
  },
}));

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
      });
      useAppStore.getState().notify("info", "La sala anterior ya no está abierta.");
      return;
    }
    set({ error: payload?.message ?? "La sala ya no es válida.", connected: false });
  });
}
