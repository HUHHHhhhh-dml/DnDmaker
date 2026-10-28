import type { DiceThrowInput } from "@protocol-life/shared";

/**
 * Traduce el gesto de arrastre sobre el dado de la bandeja en una condición
 * inicial para la simulación del servidor.
 *
 * La dirección del arrastre es la dirección del lanzamiento; el dado sale
 * desde el lado opuesto y cruza la mesa. La distancia marca la fuerza. El
 * servidor añade su propia entropía, así que el resultado sigue siendo
 * impredecible: el gesto orienta la tirada, no la cara.
 */

export const DRAG_THRESHOLD_PX = 10;
const MAX_DRAG_PX = 140;
const MAX_SPEED = 3.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function throwFromDrag(dx: number, dy: number): DiceThrowInput | null {
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < DRAG_THRESHOLD_PX) return null;

  const nx = dx / distance;
  const ny = dy / distance;
  const force = clamp(distance / MAX_DRAG_PX, 0, 1);
  const speed = MAX_SPEED * force;

  return {
    velocity: [
      nx * speed,
      -2.2 - force * 0.8,
      ny * speed,
    ],
    angular: [
      ny * 7 * force,
      nx * 5 * force,
      (nx - ny) * 4 * force,
    ],
    // El dado arranca al lado contrario para cruzar la mesa en la dirección
    // del gesto.
    start: [
      clamp(-nx * 1.35, -2, 2),
      clamp(-ny * 0.9, -1.2, 1.2),
    ],
  };
}
