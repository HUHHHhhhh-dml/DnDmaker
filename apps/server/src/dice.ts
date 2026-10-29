import { randomInt } from "node:crypto";
import {
  newId,
  type DiceRoll,
  type DiceSides,
  type DiceThrowInput,
  type DiceTrajectory,
} from "@protocol-life/shared";
import { simulateD20Roll } from "./dicePhysics";
import { HttpError } from "./repository";
import type { SessionService } from "./sessions";

/**
 * Dados de mesa (Fase 4E+).
 *
 * El servidor decide el resultado para que la tirada sea compartida y no
 * dependa del cliente. Para cualquier cantidad de d20, los resultados **salen
 * de la simulación física**: el servidor construye los dados, los lanza, los
 * deja caer y la cara que queda arriba de cada uno es su número. Las
 * trayectorias grabadas viajan con la tirada para que todos los clientes
 * reproduzcan la misma caída.
 *
 * El resto de dados siguen usando `crypto.randomInt` y el pop del cliente. No
 * se persiste: el evento `dice:rolled` es efímero.
 */

/**
 * Techo de dados simulados en un mismo mundo. Con 12 la simulación sigue siendo
 * rápida y fiable; por encima el coste por tirada se dispara (y alguna cara
 * puede no quedar plana), así que esos casos usan el pop clásico.
 */
const MAX_PHYSICAL_DICE = 12;

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
      sides === 20 && count <= MAX_PHYSICAL_DICE
        ? this.rollPhysicalD20(count, throwInput)
        : null;
    const results =
      physical?.results ??
      Array.from({ length: count }, () => randomInt(1, sides + 1));
    const trajectories = physical?.trajectories;
    const trajectory = count === 1 ? trajectories?.[0] : undefined;

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
      ...(trajectories && count > 1 ? { trajectories } : {}),
    };
  }

  /**
   * La simulación puede fallar (el dado no se detiene, queda de canto o el
   * número no es legible); en ese caso se cae al número aleatorio y el cliente
   * usa el pop.
   */
  private rollPhysicalD20(
    count: number,
    throwInput?: DiceThrowInput,
  ): {
    results: number[];
    trajectories?: DiceTrajectory[];
  } {
    const simulated = simulateD20Roll({
      seed: randomInt(0, 0x7fffffff),
      count,
      throw: throwInput,
    });
    if (!simulated) {
      return {
        results: Array.from({ length: count }, () => randomInt(1, 21)),
      };
    }
    return {
      results: simulated.results,
      trajectories: simulated.trajectories,
    };
  }
}
