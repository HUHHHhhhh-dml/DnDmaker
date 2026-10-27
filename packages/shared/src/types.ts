/**
 * PROTOCOL LIFE — Contrato de datos v0.1
 *
 * Tipos compartidos por servidor y cliente. Se mantienen alineados con
 * `docs/schema-v0.1.ts`; los IDs internos son inmutables y `code` es solo
 * un código visible/editable.
 */

export type Id = string;
export type IsoDate = string;

/* ========================================================================== */
/* Stats y daño                                                               */
/* ========================================================================== */

export type DamageType = "physical" | "mystic" | "pure";

export interface Stats {
  /** HP máximo base, antes de equipo/efectos. */
  hpMax: number;
  /** Defensa: reduce daño recibido. */
  def: number;
  /** Ataque: suma al daño. */
  atk: number;
  /** Velocidad: ordena las acciones en combate. */
  spd: number;
  /** Suerte en puntos porcentuales (10 = +10% de cara). */
  luck: number;
  /** Cupo de acciones por ronda (base 2). */
  skillSlots: number;
}

export type StatKey = keyof Stats;

/* ========================================================================== */
/* Efectos de estado                                                          */
/* ========================================================================== */

export type EffectTrigger =
  | "roundStart"
  | "roundEnd"
  | "onUseSkill"
  | "onTakeDamage"
  | "onClashWin"
  | "onClashLose"
  | "onDefeat";

export interface EffectActionDamage {
  type: "damage";
  base?: number;
  perStack?: number;
  damageType?: DamageType;
}

export interface EffectActionHeal {
  type: "heal";
  base?: number;
  perStack?: number;
}

export interface EffectActionModifyStat {
  type: "modifyStat";
  stat: StatKey;
  mode: "flat" | "percent";
  amount: number;
  /** Modificador extra por stack (se suma al `amount`). */
  perStack?: number;
}

export interface EffectActionApplyEffect {
  type: "applyEffect";
  effectId: Id;
  stacks?: number;
}

export interface EffectActionConsumeStacks {
  type: "consumeStacks";
  amount: number;
}

export type EffectAction =
  | EffectActionDamage
  | EffectActionHeal
  | EffectActionModifyStat
  | EffectActionApplyEffect
  | EffectActionConsumeStacks;

export interface EffectTriggerSpec {
  when: EffectTrigger;
  actions: EffectAction[];
}

export interface EffectDefinition {
  id: Id;
  code?: string;
  name: string;
  description?: string;
  icon?: string;
  maxStacks?: number;
  stackMode?: "add" | "refresh" | "replace";
  duration?: { type: "turns"; default: number } | { type: "permanent" };
  triggers: EffectTriggerSpec[];
  tags?: string[];
}

/** Efecto aplicado a una unidad concreta. */
export interface AppliedEffect {
  effectId: Id;
  stacks: number;
  potency?: number;
  /** Turnos restantes; undefined = permanente. */
  remainingTurns?: number;
  sourceId?: Id;
}

/* ========================================================================== */
/* Items                                                                      */
/* ========================================================================== */

export type EquipmentSlot = "horns" | "hand" | "armor" | "leg" | "utility";

export interface Item {
  id: Id;
  code?: string;
  name: string;
  description?: string;
  slot: EquipmentSlot;
  rarity?: string;
  image?: string;
  icon?: string;
  stats?: Partial<Stats>;
  effects?: { effectId: Id; stacks?: number }[];
  uses?: number;
  useEffect?: EffectAction[];
  tags?: string[];
  price?: number;
}

/* ========================================================================== */
/* Skills                                                                     */
/* ========================================================================== */

export interface SkillEffectRef {
  effectId: Id;
  chance?: number;
  stacks?: number;
}

export interface Skill {
  id: Id;
  code?: string;
  name: string;
  description?: string;
  image?: string;

  coins: number;
  baseClash: number;
  coinClash: number;
  baseDamage: number;
  coinDamage: number;
  fullHeadsMultiplier?: number;

  target: "single";
  effects?: SkillEffectRef[];
  tags?: string[];
  animation?: string;
}

/* ========================================================================== */
/* Habilidades especiales (dominios / hábitats)                               */
/* ========================================================================== */

export interface SpecialAbility {
  id: Id;
  code?: string;
  name: string;
  description?: string;
  image?: string;
  duration: number;
  cooldown?: number;
  oncePerCombat?: boolean;
  effects: EffectAction[];
  target: "self" | "team" | "field";
}

/* ========================================================================== */
/* Personajes                                                                 */
/* ========================================================================== */

export type CharacterKind = "player" | "npc" | "enemy";

export interface Character {
  id: Id;
  name: string;
  kind: CharacterKind;
  portrait?: string;
  description?: string;

  baseStats: Stats;
  equipment: Record<EquipmentSlot, Id | null>;
  /** Exactamente 3 slots en v0.1. */
  skills: (Id | null)[];
  special?: {
    domainId?: Id | null;
    habitatId?: Id | null;
  };
  inventory: { itemId: Id; qty: number }[];
  notes?: string;
  ownerId?: Id;
  tags?: string[];
}

/* ========================================================================== */
/* Encuentros                                                                 */
/* ========================================================================== */

export interface EncounterEnemy {
  characterId: Id;
  count?: number;
  overrides?: Partial<Character>;
}

export interface EncounterRewards {
  itemIds?: Id[];
  currency?: number;
  notes?: string;
}

export interface Encounter {
  id: Id;
  name: string;
  description?: string;
  background?: string;
  enemies: EncounterEnemy[];
  rewards?: EncounterRewards;
  victory?: string;
  defeat?: string;
}

/* ========================================================================== */
/* Tiendas y mazmorras (modelo para después)                                  */
/* ========================================================================== */

export interface ShopItem {
  itemId: Id;
  price: number;
  stock?: number;
}

export interface Shop {
  id: Id;
  name: string;
  description?: string;
  currency?: string;
  items: ShopItem[];
}

export interface DungeonRoom {
  id: Id;
  name: string;
  encounterId?: Id;
  notes?: string;
}

export interface Dungeon {
  id: Id;
  name: string;
  description?: string;
  entryRoomId?: Id;
  rooms: DungeonRoom[];
}

/* ========================================================================== */
/* Reglas y campaña                                                           */
/* ========================================================================== */

export interface Ruleset {
  defenseConstant: number;
  minDamage: number;
  maxSkillSlots: number;
  tieRule: "cancel_both" | "defender_wins" | "both_half";
  fullHeadsMultiplier: number;
  luckCap: number;
  luckFloor: number;
  hpPersistence: "persist" | "restore";
}

export interface CampaignSettings {
  maxPlayers: number;
  allowPlayerEdit: boolean;
  allowPlayerEditDuringCombat: boolean;
  requirePin?: boolean;
  pin?: string;
}

export interface CampaignContent {
  items: Item[];
  skills: Skill[];
  effects: EffectDefinition[];
  characters: Character[];
  encounters: Encounter[];
  specials: SpecialAbility[];
  shops: Shop[];
  dungeons: Dungeon[];
}

export interface Campaign {
  id: Id;
  name: string;
  description?: string;
  schemaVersion: 1;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  rules: Ruleset;
  settings: CampaignSettings;
  content: CampaignContent;
}

/* ========================================================================== */
/* Sala / sesión                                                              */
/* ========================================================================== */

export interface SessionPlayer {
  id: Id;
  name: string;
  token: string;
  characterId?: Id;
  connected: boolean;
}

export interface Session {
  id: Id;
  code: string;
  campaignId: Id;
  dmToken: string;
  players: SessionPlayer[];
  status: "lobby" | "playing" | "combat";
}

/* ========================================================================== */
/* Combate                                                                    */
/* ========================================================================== */

export type Team = "players" | "enemies";
export type CombatPhase = "declaring" | "resolving" | "ended";

export interface CombatUnit {
  id: Id;
  characterId: Id;
  team: Team;
  name: string;
  stats: Stats;
  hpCurrent: number;
  equipment: Record<EquipmentSlot, Id | null>;
  skills: (Id | null)[];
  effects: AppliedEffect[];
  defeated: boolean;
}

export interface DeclaredAction {
  unitId: Id;
  slot: number;
  skillId?: Id;
  utilityId?: Id;
  special?: "domain" | "habitat";
  targetId?: Id;
  redirectFor?: Id;
  locked: boolean;
}

export type CombatEventType =
  | "roundStart"
  | "actionDeclared"
  | "clash"
  | "redirect"
  | "special"
  | "damage"
  | "heal"
  | "effectApplied"
  | "effectTick"
  | "cooldown"
  | "defeated"
  | "roundEnd"
  | "combatEnd";

export interface CombatEvent {
  id: Id;
  round: number;
  type: CombatEventType;
  actorId?: Id;
  targetId?: Id;
  message: string;
  data?: Record<string, unknown>;
}

export interface CombatState {
  id: Id;
  encounterId: Id;
  round: number;
  phase: CombatPhase;
  seed: string;
  units: CombatUnit[];
  actions: Record<Id, DeclaredAction[]>;
  specialCooldowns: Record<Id, Record<Id, number>>;
  log: CombatEvent[];
  winner?: Team;
}

/* ========================================================================== */
/* Eventos de red (v0.1)                                                      */
/* ========================================================================== */

export interface JoinPayload {
  code: string;
  pin?: string;
  name: string;
}

export interface DeclareActionPayload {
  actions: Omit<DeclaredAction, "unitId" | "locked">[];
}

export interface ApiError {
  code: string;
  message: string;
}
