import { randomInt } from "node:crypto";
import {
  newId,
  type DiceRoll,
  type DiceSides,
} from "@protocol-life/shared";
import { HttpError } from "./repository";
import type { SessionService } from "./sessions";

/**
 * Dados de mesa (Fase 4E+).
 *
 * El servidor decide el resultado con `crypto.randomInt` para que la tirada sea
 * compartida y no dependa del cliente. No se persiste: el evento `dice:rolled`
 * es efímero y el log vive en cada cliente mientras dure la sesión.
 */
export class DiceService {
  private readonly lastRollAt = new Map<string, number>();

  constructor(
    private readonly sessions: SessionService,
    private readonly cooldownMs = 1000,
  ) {}

  roll(
    code: string,
    token: string | null,
    sides: DiceSides,
    count = 1,
  ): DiceRoll {
    const identity = this.sessions.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
    }

    const playerId = identity.role === "player" ? identity.player.id : "dm";
    const key = `${identity.session.id}:${identity.role}:${playerId}`;
    const now = Date.now();
    const last = this.lastRollAt.get(key);
    if (last !== undefined && now - last < this.cooldownMs) {
      throw new HttpError(
        429,
        "dice_cooldown",
        "Espera un segundo entre tiradas.",
      );
    }
    this.lastRollAt.set(key, now);

    const results = Array.from({ length: count }, () =>
      randomInt(1, sides + 1),
    );
    return {
      id: newId("dice"),
      sides,
      count,
      results,
      result: results.reduce((sum, value) => sum + value, 0),
      roller:
        identity.role === "dm"
          ? { role: "dm", name: "DM" }
          : { role: "player", name: identity.player.name },
      at: new Date(now).toISOString(),
    };
  }
}
