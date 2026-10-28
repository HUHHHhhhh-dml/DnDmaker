import { randomInt } from "node:crypto";
import {
  newId,
  type DiceRoll,
  type DiceSides,
  type DiceThrowInput,
  type DiceTrajectory,
} from "@protocol-life/shared";
import { simulateD20Throw } from "./dicePhysics";
import { HttpError } from "./repository";
import type { SessionService } from "./sessions";

/**
 * Dados de mesa (Fase 4E+).
 *
 * El servidor decide el resultado para que la tirada sea compartida y no
 * dependa del cliente. Para un d20 único, el resultado **sale de la simulación
 * física**: el servidor construye el dado, lo lanza, lo deja caer y la cara que
 * queda arriba es el número. La trayectoria grabada viaja con la tirada para
 * que todos los clientes reproduzcan la misma caída.
 *
 * El resto de dados (u otras cantidades) siguen usando `crypto.randomInt` y el
 * pop del cliente. No se persiste: el evento `dice:rolled` es efímero.
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
    throwInput?: DiceThrowInput,
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

    const physical =
      sides === 20 && count === 1
        ? this.rollPhysicalD20(throwInput)
        : null;
    const results =
      physical?.results ??
      Array.from({ length: count }, () => randomInt(1, sides + 1));
    const trajectory = physical?.trajectory;

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
      ...(trajectory ? { trajectory } : {}),
    };
  }

  /**
   * La simulación puede fallar (el dado no se detiene o el número no queda
   * legible); en ese caso se cae al número aleatorio y el cliente usa el pop.
   */
  private rollPhysicalD20(throwInput?: DiceThrowInput): {
    results: number[];
    trajectory?: DiceTrajectory;
  } {
    const simulated = simulateD20Throw({
      seed: randomInt(0, 0x7fffffff),
      throw: throwInput,
    });
    if (!simulated) return { results: [randomInt(1, 21)] };
    return { results: [simulated.face], trajectory: simulated };
  }
}
