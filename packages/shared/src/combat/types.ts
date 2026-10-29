import type {
  AppliedEffect,
  CampaignContent,
  CombatEvent,
  CombatEventType,
  CombatState,
  CombatUnit,
  DeclaredAction,
  EffectDefinition,
  EffectTriggerSpec,
  Id,
  Ruleset,
  Skill,
} from "../types";

/** Evento interno antes de recibir id/ronda del estado. */
export interface EngineEvent {
  type: CombatEventType;
  actorId?: Id;
  targetId?: Id;
  message: string;
  data?: Record<string, unknown>;
}

export interface CoinRoll {
  /** Número de monedas tiradas. */
  coins: number;
  /** Cuántas salieron caras. */
  heads: number;
  /** Resultado individual: true = cara. */
  faces: boolean[];
  /** Probabilidad de cara usada (LUCK + reglas). */
  probability: number;
  clashPower: number;
  /** Daño bruto, con full heads ya aplicado. */
  rawDamage: number;
  fullHeads: boolean;
}

export type ClashWinner = "attacker" | "defender" | "tie";

export interface ClashParticipant {
  unit: CombatUnit;
  skill: Skill;
  action: DeclaredAction;
}

export interface ClashResult {
  winner: ClashWinner;
  tie: boolean;
  /** true si las dos acciones se cancelan (tieRule cancel_both). */
  cancelled: boolean;
  attackerRoll: CoinRoll;
  defenderRoll: CoinRoll;
  /** Daño final que recibiría cada lado (0 si no procede). */
  damageToAttacker: number;
  damageToDefender: number;
  /** Atajo: daño del ganador al perdedor. */
  damage: number;
}

export interface EffectContext {
  content: Pick<
    CampaignContent,
    "items" | "skills" | "effects" | "specials"
  >;
  rules: Ruleset;
}

/** Origen de una acción/trigger para logs y sourceId de efectos. */
export interface ActionSource {
  actorId?: Id;
  effectId?: Id;
  skillId?: Id;
  specialId?: Id;
  itemId?: Id;
}

export interface EffectResult {
  unit: CombatUnit;
  /**
   * Unidades secundarias modificadas por acciones dirigidas al rival o a
   * todos los demás. No incluye a `unit`.
   */
  targets?: CombatUnit[];
  /** IDs de unidades que recibieron daño en esta ejecución. */
  damagedIds?: Id[];
  events: EngineEvent[];
  /** true si la ejecución hizo daño a alguna unidad. */
  damageApplied: boolean;
}

export interface TriggerGroup {
  effect: AppliedEffect;
  definition: EffectDefinition;
  trigger: EffectTriggerSpec;
}

export interface RoundResult {
  state: CombatState;
  /**
   * Eventos nuevos de esta ronda. Ya están añadidos a `state.log`; 3C no debe
   * volver a insertarlos en el estado (sí puede persistirlos/emitirlos).
   *
   * `state.round` ya es la ronda siguiente, `phase` es `declaring` y
   * `state.winner` puede venir definido. 3C debe consultar el ganador y llamar
   * a `endEncounter` si el combate terminó; el motor no persiste HP.
   */
  events: CombatEvent[];
}

