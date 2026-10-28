import type { Server, Socket } from "socket.io";
import { ZodError } from "zod";
import {
  combatDeclarePayloadSchema,
  combatEndPayloadSchema,
  combatLockPayloadSchema,
  combatScenePatchSchema,
  combatStartPayloadSchema,
  type CombatDeclareAction,
  type CombatDeclarePayload,
  type CombatState,
} from "@protocol-life/shared";
import { HttpError } from "../repository";
import type { SessionIdentity, SessionService } from "../sessions";
import type { DeclaredActionInput } from "./declarations";
import { toPublicCombatState } from "./public";
import type { CombatActor, CombatService } from "./service";

/**
 * Puente Socket.IO del combate (Fase 3D).
 *
 * El cliente solo manda intenciones. La sesión (code + token) decide quién es
 * DM/jugador; el combate vivo se busca por la campaña de esa sesión, nunca por
 * un `combatId` del cliente. Los payloads pasan por Zod y los errores vuelven
 * como `error { code, message }` sin tumbar el socket.
 *
 * Se registra después de `createRealtime` para que el socket ya esté
 * autenticado, en su room y con `session:state` enviado.
 */

export interface CombatSocketDeps {
  io: Server;
  sessions: SessionService;
  combat: CombatService;
}

interface SocketAuth {
  code?: unknown;
  token?: unknown;
}

function readAuth(socket: Socket): { code: string; token: string } {
  const auth = (socket.handshake.auth ?? {}) as SocketAuth;
  const storedCode = typeof socket.data.code === "string" ? socket.data.code : "";
  const code = storedCode || (typeof auth.code === "string" ? auth.code : "");
  const token = typeof auth.token === "string" ? auth.token : "";
  return { code, token };
}

function emitError(socket: Socket, error: unknown): void {
  if (error instanceof HttpError) {
    socket.emit("error", { code: error.code, message: error.message });
    return;
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    socket.emit("error", {
      code: "invalid_payload",
      message: first
        ? `Datos inválidos (${first.path.join(".") || "payload"}): ${first.message}`
        : "Datos inválidos.",
    });
    return;
  }
  socket.emit("error", {
    code: "internal_error",
    message: "Algo se rompió en el servidor.",
  });
}

function liveCombat(
  deps: CombatSocketDeps,
  identity: SessionIdentity,
): CombatState {
  const live = deps.combat.getLiveCombat(identity.session.campaignId);
  if (!live) {
    throw new HttpError(
      409,
      "no_live_combat",
      "No hay un combate en curso en esta campaña.",
    );
  }
  return live;
}

function liveCombatId(
  deps: CombatSocketDeps,
  identity: SessionIdentity,
): string {
  return liveCombat(deps, identity).id;
}

/** Reenvía el estado actual; útil si una intención llegó con la ronda vieja. */
function emitCurrentState(socket: Socket, state: CombatState): void {
  socket.emit("combat:state", { combat: toPublicCombatState(state) });
}

function isStaleIntent(
  parsed: { round?: number; combatId?: string },
  live: CombatState,
): boolean {
  return (
    (parsed.round !== undefined && parsed.round !== live.round) ||
    (parsed.combatId !== undefined && parsed.combatId !== live.id)
  );
}

function staleIntentError(): HttpError {
  return new HttpError(
    409,
    "stale_round",
    "La ronda o el combate ya cambiaron. Se actualizó el estado.",
  );
}

function actorFor(identity: SessionIdentity, unitId?: string): CombatActor {
  return identity.role === "dm"
    ? { role: "dm", unitId }
    : { role: "player", player: identity.player };
}

/** Quita los campos que el servidor decide (unitId/locked). */
function toActionInput(action: CombatDeclareAction): DeclaredActionInput {
  const { unitId: _unitId, locked: _locked, ...input } = action;
  return input;
}

/**
 * El DM puede mandar un `unitId` de nivel superior (una unidad) o acciones con
 * `unitId` por unidad (varias). Sin selector, el servicio solo puede inferir la
 * unidad si queda exactamente un enemigo vivo.
 */
function declareForDm(
  deps: CombatSocketDeps,
  combatId: string,
  payload: CombatDeclarePayload,
): void {
  if (payload.unitId) {
    deps.combat.declareActions(
      { role: "dm", unitId: payload.unitId },
      combatId,
      payload.actions.map(toActionInput),
    );
    return;
  }

  const withUnit = payload.actions.filter((action) => action.unitId);
  const withoutUnit = payload.actions.filter((action) => !action.unitId);

  if (withUnit.length > 0 && withoutUnit.length > 0) {
    throw new HttpError(
      422,
      "unit_required",
      "Indica la unidad de todas las acciones enemigas.",
    );
  }

  if (withUnit.length === 0) {
    deps.combat.declareActions(
      { role: "dm" },
      combatId,
      payload.actions.map(toActionInput),
    );
    return;
  }

  const groups = new Map<string, CombatDeclareAction[]>();
  for (const action of withUnit) {
    const unitId = action.unitId!;
    const list = groups.get(unitId) ?? [];
    list.push(action);
    groups.set(unitId, list);
  }

  for (const [unitId, actions] of groups) {
    deps.combat.declareActions(
      { role: "dm", unitId },
      combatId,
      actions.map(toActionInput),
    );
  }
}

export function registerCombatSocket(deps: CombatSocketDeps): void {
  deps.io.on("connection", (socket: Socket) => {
    // `createRealtime` corre antes y ya autenticó/unió a la room. Si el auth
    // falló, el socket está desconectado y no registramos nada.
    if (!socket.connected || !socket.data.role) return;

    const { code, token } = readAuth(socket);
    const identity = deps.sessions.authenticate(code, token);
    if (!identity) {
      socket.emit("error", {
        code: "invalid_session",
        message: "La sala o tu token ya no son válidos. Vuelve a entrar.",
      });
      return;
    }

    // Reconexión / primer connect: estado completo con el combate vivo y, si
    // no hay uno, el último terminado dentro del TTL. El jugador solo recibe
    // el resultado si su ficha participó en ese combate.
    try {
      const state = deps.sessions.getState(code, token);
      const campaignId = identity.session.campaignId;
      const live = deps.combat.getLiveCombat(campaignId);
      const recent = live
        ? null
        : deps.combat.getRecentCombat(
            campaignId,
            identity.role === "dm"
              ? { role: "dm" }
              : {
                  role: "player",
                  characterId: identity.player.characterId,
                },
          );
      socket.emit("state:full", {
        ...state,
        combat: live ? toPublicCombatState(live) : null,
        recentCombat: recent ? toPublicCombatState(recent) : null,
      });
    } catch (error) {
      emitError(socket, error);
    }

    // Auto-lock al desconectarse un jugador (3F.5). `createRealtime` corre
    // antes y ya actualizó la presencia; aquí solo se bloquea su unidad para
    // que la ronda no quede atascada. Es best-effort: una desconexión nunca
    // debe tumbar el proceso ni otros sockets.
    if (identity.role === "player") {
      socket.on("disconnect", () => {
        try {
          deps.combat.handlePlayerDisconnected(
            identity.session.campaignId,
            identity.player.characterId,
          );
        } catch {
          // La sala ya perdió al jugador; el DM siempre puede terminar.
        }
      });
    }

    socket.on("combat:start", (payload: unknown) => {
      try {
        if (identity.role !== "dm") {
          throw new HttpError(
            403,
            "dm_only",
            "Solo el DM puede iniciar el combate.",
          );
        }
        const parsed = combatStartPayloadSchema.parse(payload);
        deps.combat.startEncounter(
          identity.session.campaignId,
          parsed.encounterId,
          identity.session.id,
        );
        // El sink de CombatService emite combat:started a la room.
      } catch (error) {
        emitError(socket, error);
      }
    });

    // Escena visual (3F.5): SOLO DM y permitido durante el combate. El evento
    // es de presentación; no pasa por assertNotInCombat (eso es HTTP de
    // contenido) ni toca HP/reglas. El servicio emite combat:state a la sala.
    socket.on("combat:scene", (payload: unknown) => {
      try {
        if (identity.role !== "dm") {
          throw new HttpError(
            403,
            "dm_only",
            "Solo el DM puede cambiar la escena del combate.",
          );
        }
        const parsed = combatScenePatchSchema.parse(payload ?? {});
        const live = liveCombat(deps, identity);
        deps.combat.setScene(live.id, { role: "dm" }, parsed);
      } catch (error) {
        emitError(socket, error);
      }
    });

    socket.on("combat:declare", (payload: unknown) => {
      try {
        const parsed = combatDeclarePayloadSchema.parse(payload);
        const live = liveCombat(deps, identity);
        if (isStaleIntent(parsed, live)) {
          // Un paquete tardío no debe cambiar las acciones de la ronda nueva.
          emitCurrentState(socket, live);
          throw staleIntentError();
        }
        if (identity.role === "dm") {
          declareForDm(deps, live.id, parsed);
        } else {
          deps.combat.declareActions(
            { role: "player", player: identity.player },
            live.id,
            parsed.actions.map(toActionInput),
          );
        }
      } catch (error) {
        emitError(socket, error);
      }
    });

    socket.on("combat:lock", (payload: unknown) => {
      try {
        const parsed = combatLockPayloadSchema.parse(payload ?? {});
        const live = liveCombat(deps, identity);
        if (isStaleIntent(parsed, live)) {
          // Lock duplicado de una ronda ya resuelta: se ignora y se reenvía
          // el estado actual. Nunca debe bloquear la ronda nueva.
          emitCurrentState(socket, live);
          return;
        }
        const next = deps.combat.lockActions(
          live.id,
          actorFor(identity),
        );
        // Cuando el último lock deja la ronda lista, el servidor resuelve.
        if (next.phase === "resolving") {
          deps.combat.resolveCombatRound(live.id);
        }
      } catch (error) {
        emitError(socket, error);
      }
    });

    socket.on("combat:end", (payload: unknown) => {
      try {
        if (identity.role !== "dm") {
          throw new HttpError(
            403,
            "dm_only",
            "Solo el DM puede terminar el combate.",
          );
        }
        combatEndPayloadSchema.parse(payload ?? {});
        const combatId = liveCombatId(deps, identity);
        deps.combat.endEncounter(combatId, "dm");
      } catch (error) {
        emitError(socket, error);
      }
    });
  });
}
