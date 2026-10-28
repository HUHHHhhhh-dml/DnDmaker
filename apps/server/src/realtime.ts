import type { FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
import type {
  CombatEvent,
  LootDraft,
  PublicCombatState,
  PublicDungeonRun,
  ShopScene,
  Team,
} from "@protocol-life/shared";
import type { SessionService } from "./sessions";

/**
 * Eventos en vivo de la mesa (Fase 2).
 *
 * El cliente no muta por socket: las mutaciones siguen siendo HTTP y el
 * servidor emite un refresco a la sala después de validarlas. Así las reglas
 * de negocio y los tokens viven en un único sitio.
 */

export type RealtimeService = {
  io: Server;
  emitPlayers: (code: string) => void;
  emitRefresh: (campaignId: string) => void;
  emitClosed: (code: string) => void;
  /** Fase 3: la sala recibe el snapshot inicial del combate (sin seed). */
  emitCombatStarted: (code: string, combat: PublicCombatState) => void;
  /** Fase 3C: cada paso de la resolución (evento ya calculado, sin seed). */
  emitCombatEvent: (code: string, event: CombatEvent) => void;
  /** Fase 3C: estado actualizado tras declarar, bloquear o resolver. */
  emitCombatState: (code: string, combat: PublicCombatState) => void;
  /** Fase 3C: cierre del combate con ganador y log completo. */
  emitCombatEnded: (
    code: string,
    payload: { winner?: Team; log: CombatEvent[] },
  ) => void;
  /** Fase 4A-2: reparto de botín activo (null cuando se cierra). */
  emitLoot: (code: string, draft: LootDraft | null) => void;
  /** Fase 4A-3: escena de tienda activa (null al cerrarse). */
  emitShop: (code: string, shop: ShopScene | null) => void;
  /** Fase 4C: run de mazmorra activa (null al terminar o cerrarse). */
  emitDungeon: (code: string, run: PublicDungeonRun | null) => void;
  close: () => void;
};

const sessionRoom = (code: string): string => `session:${code}`;
const campaignRoom = (campaignId: string): string => `campaign:${campaignId}`;

interface SocketAuth {
  code?: unknown;
  token?: unknown;
}

export function createRealtime(
  app: FastifyInstance,
  sessions: SessionService,
): RealtimeService {
  const io = new Server(app.server, {
    cors: { origin: true, methods: ["GET", "POST"] },
    path: "/socket.io",
  });

  io.on("connection", (socket: Socket) => {
    const auth = (socket.handshake.auth ?? {}) as SocketAuth;
    const code = typeof auth.code === "string" ? auth.code : "";
    const token = typeof auth.token === "string" ? auth.token : "";
    const identity = sessions.authenticate(code, token);

    if (!identity) {
      socket.emit("session:error", {
        code: "invalid_session",
        message: "La sala o tu token ya no son válidos. Vuelve a entrar.",
      });
      socket.disconnect(true);
      return;
    }

    const row = identity.session;
    const room = sessionRoom(row.code);
    socket.data.role = identity.role;
    socket.data.code = row.code;
    if (identity.role === "player") socket.data.playerId = identity.player.id;

    socket.join(room);
    socket.join(campaignRoom(row.campaignId));

    if (identity.role === "player") {
      sessions.markPlayerConnected(row.code, identity.player.id, true);
      emitPlayers(row.code);
    } else {
      sessions.markDmConnected(row.code, true);
      emitPlayers(row.code);
    }

    const fresh = sessions.getByCode(row.code) ?? row;
    socket.emit("session:state", {
      role: identity.role,
      session: sessions.publicSession(fresh),
    });

    socket.on("disconnect", () => {
      const current = sessions.getByCode(row.code);
      if (!current) return;
      if (identity.role === "player") {
        sessions.markPlayerConnected(row.code, identity.player.id, false);
        emitPlayers(row.code);
      } else {
        sessions.markDmConnected(row.code, false);
        emitPlayers(row.code);
      }
    });
  });

  function emitPlayers(code: string): void {
    const session = sessions.getPublicSession(code);
    if (!session) return;
    io.to(sessionRoom(session.code)).emit("session:players", {
      players: session.players,
      status: session.status,
      dmConnected: session.dmConnected,
    });
  }

  function emitRefresh(campaignId: string): void {
    io.to(campaignRoom(campaignId)).emit("campaign:refresh", {});
  }

  function emitClosed(code: string): void {
    const session = sessions.getPublicSession(code);
    const normalized = session?.code ?? code.trim().toUpperCase();
    io.to(sessionRoom(normalized)).emit("session:closed", {});
    io.in(sessionRoom(normalized)).disconnectSockets(true);
  }

  function emitCombatStarted(code: string, combat: PublicCombatState): void {
    io.to(sessionRoom(code.trim().toUpperCase())).emit("combat:started", {
      combat,
    });
  }

  function emitCombatEvent(code: string, event: CombatEvent): void {
    io.to(sessionRoom(code.trim().toUpperCase())).emit("combat:event", {
      event,
    });
  }

  function emitCombatState(code: string, combat: PublicCombatState): void {
    io.to(sessionRoom(code.trim().toUpperCase())).emit("combat:state", {
      combat,
    });
  }

  function emitCombatEnded(
    code: string,
    payload: { winner?: Team; log: CombatEvent[] },
  ): void {
    io.to(sessionRoom(code.trim().toUpperCase())).emit("combat:ended", payload);
  }

  function emitLoot(code: string, draft: LootDraft | null): void {
    io.to(sessionRoom(code.trim().toUpperCase())).emit("loot:updated", {
      draft,
    });
  }

  function emitShop(code: string, shop: ShopScene | null): void {
    io.to(sessionRoom(code.trim().toUpperCase())).emit("shop:state", { shop });
  }

  function emitDungeon(code: string, run: PublicDungeonRun | null): void {
    io.to(sessionRoom(code.trim().toUpperCase())).emit("dungeon:state", {
      run,
    });
  }

  function close(): void {
    io.close();
  }

  return {
    io,
    emitPlayers,
    emitRefresh,
    emitClosed,
    emitCombatStarted,
    emitCombatEvent,
    emitCombatState,
    emitCombatEnded,
    emitLoot,
    emitShop,
    emitDungeon,
    close,
  };
}
