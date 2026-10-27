import type { CombatState, PublicCombatState } from "@protocol-life/shared";

/**
 * Quita la semilla del RNG antes de enviar el combate a cualquier cliente.
 * La semilla vive solo en el servidor; los clientes reciben eventos con las
 * tiradas ya resueltas y no pueden predecir las siguientes.
 */
export function toPublicCombatState(state: CombatState): PublicCombatState {
  const { seed: _seed, ...publicState } = state;
  return publicState;
}
