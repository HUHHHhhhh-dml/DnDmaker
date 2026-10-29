import type { DiceRoll, DiceTrajectory } from "@protocol-life/shared";

/**
 * Trayectorias físicas de una tirada. El servidor manda `trajectory` para un
 * d20 único (compatibilidad) y `trajectories` para varios dados.
 */
export function rollTrajectories(
  roll: Pick<DiceRoll, "count" | "trajectory" | "trajectories">,
): DiceTrajectory[] {
  const trajectories = roll.trajectories;
  if (Array.isArray(trajectories) && trajectories.length === roll.count) {
    return trajectories;
  }
  if (roll.count === 1 && roll.trajectory) return [roll.trajectory];
  return [];
}

type RollKey = Pick<
  DiceRoll,
  "sides" | "count" | "results" | "trajectory" | "trajectories"
>;

/**
 * ¿La escena 3D puede reproducir esta tirada? Debe ser d20, haber un
 * resultado por dado y una trayectoria válida cuyo último frame sea esa cara.
 */
export function isPhysicalD20Roll(roll: RollKey): boolean {
  if (roll.sides !== 20) return false;
  if (roll.count < 1 || roll.count > 20) return false;
  if (roll.results.length !== roll.count) return false;
  const trajectories = rollTrajectories(roll);
  if (trajectories.length !== roll.count) return false;
  return trajectories.every((trajectory, index) => {
    const value = roll.results[index];
    return (
      trajectory.frames.length > 1 &&
      trajectory.durationMs > 0 &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 20 &&
      trajectory.face === value
    );
  });
}

/** La misma tirada, pero solo el caso de un d20 (para el primer plano). */
export function isSingleD20(roll: RollKey): boolean {
  return roll.count === 1 && isPhysicalD20Roll(roll);
}
