import {
  combineD100,
  isPhysicalDieSides,
  type DiceRoll,
  type DiceSides,
  type DiceTrajectory,
} from "@protocol-life/shared";

/**
 * Trayectorias físicas de una tirada. El servidor manda `trajectory` para un
 * dado único normal (compatibilidad) y `trajectories` para varios dados o para
 * un d100 (que son dos d10).
 */
export function rollTrajectories(
  roll: Pick<DiceRoll, "count" | "trajectory" | "trajectories">,
): DiceTrajectory[] {
  const trajectories = roll.trajectories;
  if (Array.isArray(trajectories) && trajectories.length > 0) {
    return trajectories;
  }
  if (roll.count === 1 && roll.trajectory) return [roll.trajectory];
  return [];
}

type RollKey = Pick<
  DiceRoll,
  "sides" | "count" | "results" | "trajectory" | "trajectories"
>;

/** Cuerpos que debe traer una tirada física (el d100 son dos d10 por dado). */
export function expectedTrajectoryCount(
  sides: DiceSides,
  count: number,
): number {
  return sides === 100 ? count * 2 : count;
}

function faceCount(sides: DiceSides): number {
  return sides === 100 ? 10 : sides;
}

function validFrames(trajectory: DiceTrajectory): boolean {
  return trajectory.frames.length > 1 && trajectory.durationMs > 0;
}

function validFace(face: number, sides: DiceSides): boolean {
  return (
    Number.isInteger(face) &&
    face >= 1 &&
    face <= faceCount(sides)
  );
}

function validResult(value: number, sides: DiceSides): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= sides
  );
}

/**
 * ¿La escena 3D puede reproducir esta tirada? Debe ser un dado con física,
 * haber un resultado por dado y las trayectorias esperadas (dos por d100).
 */
export function isPhysicalDiceRoll(roll: RollKey): boolean {
  if (!isPhysicalDieSides(roll.sides)) return false;
  if (roll.count < 1) return false;
  if (roll.results.length !== roll.count) return false;
  if (!roll.results.every((value) => validResult(value, roll.sides))) {
    return false;
  }

  const trajectories = rollTrajectories(roll);
  if (trajectories.length !== expectedTrajectoryCount(roll.sides, roll.count)) {
    return false;
  }
  if (!trajectories.every(validFrames)) return false;
  if (!trajectories.every((trajectory) => validFace(trajectory.face, roll.sides))) {
    return false;
  }

  if (roll.sides === 100) {
    for (let index = 0; index < roll.count; index += 1) {
      const tens = trajectories[index * 2];
      const units = trajectories[index * 2 + 1];
      if (!tens || !units) return false;
      if (combineD100(tens.face, units.face) !== roll.results[index]) {
        return false;
      }
    }
    return true;
  }

  return trajectories.every(
    (trajectory, index) => trajectory.face === roll.results[index],
  );
}

/** Compatibilidad con el nombre anterior, ya solo para d20. */
export function isPhysicalD20Roll(roll: RollKey): boolean {
  return roll.sides === 20 && isPhysicalDiceRoll(roll);
}

/** La misma tirada, pero solo el caso de un dado único. */
export function isSingleD20(roll: RollKey): boolean {
  return roll.count === 1 && isPhysicalD20Roll(roll);
}

/** La tirada tiene un solo cuerpo físico (no un d100 de dos d10). */
export function isSingleBodyRoll(roll: RollKey): boolean {
  return roll.count === 1 && roll.sides !== 100;
}

/**
 * Rebotes visibles de una tirada de un solo dado, si todos sus cuerpos
 * coinciden (en d100 son dos d10). `null` si no hay dato uniforme.
 */
export function uniformBounces(roll: RollKey): number | null {
  if (roll.count !== 1) return null;
  const trajectories = rollTrajectories(roll);
  if (trajectories.length === 0) return null;
  const first = trajectories[0]!.bounces;
  if (!trajectories.every((trajectory) => trajectory.bounces === first)) {
    return null;
  }
  return first;
}
