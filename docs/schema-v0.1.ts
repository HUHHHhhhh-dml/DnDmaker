/**
 * PROTOCOL LIFE — Contrato de datos v0.1
 *
 * Estos tipos son la base del proyecto. La idea es que puedas modificarlos
 * después sin romper el resto: los IDs internos son estables y el contenido
 * (objetos, skills, efectos...) vive en datos, no en código.
 *
 * Convenciones:
 * - `id`: identificador interno inmutable (UUID/ULID).
 * - `code`: código visible/editable (ej. "AASS-164"); nunca es clave primaria.
 * - Todo lo opcional está marcado con `?`.
 * - Las fechas son ISO 8601 en string.
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
  /** Daño fijo, independiente de stacks. */
  base?: number;
  /** Daño por stack. */
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
  /** Tope de stacks; si no se indica, sin tope. */
  maxStacks?: number;
  stackMode?: "add" | "refresh" | "replace";
  duration?:
    | { type: "turns"; default: number }
    | { type: "permanent" };
  triggers: EffectTriggerSpec[];
  tags?: string[];
}

/** Efecto aplicado a una unidad concreta. */
export interface AppliedEffect {
  effectId: Id;
  stacks: number;
  /** Potencia opcional para fórmulas que la usen. */
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
  /** URL o /uploads/... */
  image?: string;
  icon?: string;
  /** Suma a los stats base al equipar. */
  stats?: Partial<Stats>;
  /** Efectos pasivos mientras está equipado. */
  effects?: { effectId: Id; stacks?: number }[];
  /** Solo utilidad: usos por combate/descanso. */
  uses?: number;
  /** Solo utilidad: qué hace al usarse. */
  useEffect?: EffectAction[];
  tags?: string[];
  price?: number;
}

/* ========================================================================== */
/* Skills                                                                     */
/* ========================================================================== */

export interface SkillEffectRef {
  effectId: Id;
  /** 0..1; default 1. */
  chance?: number;
  stacks?: number;
}

export interface Skill {
  id: Id;
  code?: string;
  name: string;
  description?: string;
  image?: string;

  /** Número de monedas (>= 1). */
  coins: number;
  /** Poder de clash base. */
  baseClash: number;
  /** Poder de clash por cara. */
  coinClash: number;
  /** Daño base. */
  baseDamage: number;
  /** Daño por cara. */
  coinDamage: number;
  /** Multiplicador si todas las monedas salen caras (default 2). */
  fullHeadsMultiplier?: number;

  /** v0.1: un solo objetivo. */
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
  /** Turnos que dura el efecto. */
  duration: number;
  /** Rondas de espera tras terminar la duración. Solo aplica si oncePerCombat = false. */
  cooldown?: number;
  /** Si es true, solo se puede usar una vez por combate. Default true en v0.1. */
  oncePerCombat?: boolean;
  /** Acciones que aplica (buff de stats, efectos, etc.). */
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

  /** Stats base antes de equipo/efectos. */
  baseStats: Stats;

  /** Slots de equipo; `utility` es el ítem de utilidad. */
  equipment: Record<EquipmentSlot, Id | null>;

  /** Exactamente 3 slots en v0.1. */
  skills: (Id | null)[];

  special?: {
    domainId?: Id | null;
    habitatId?: Id | null;
  };

  inventory: { itemId: Id; qty: number }[];
  notes?: string;
  /** Jugador dueño, si es un personaje de jugador. */
  ownerId?: Id;
  tags?: string[];
}

/* ========================================================================== */
/* Encuentros                                                                 */
/* ========================================================================== */

export interface EncounterEnemy {
  characterId: Id;
  /** Cuántas copias del enemigo (default 1). */
  count?: number;
  /** Overrides puntuales para esta aparición. */
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
  /** Constante de mitigación: DEF / (DEF + defenseConstant). */
  defenseConstant: number;
  /** Daño mínimo de un golpe. */
  minDamage: number;
  /** Tope de Skill Slots por unidad. */
  maxSkillSlots: number;
  /** Qué pasa si el clash empata. */
  tieRule: "cancel_both" | "defender_wins" | "both_half";
  /** Multiplicador de daño si todas las monedas son caras. */
  fullHeadsMultiplier: number;
  /** Tope de probabilidad de cara. */
  luckCap: number;
  /** Piso de probabilidad de cara. */
  luckFloor: number;
  /** HP entre combates. */
  hpPersistence: "persist" | "restore";
}

export interface CampaignSettings {
  maxPlayers: number;
  /** ¿El jugador puede editar su ficha fuera de combate? */
  allowPlayerEdit: boolean;
  /** ¿El jugador puede editar su ficha durante combate? */
  allowPlayerEditDuringCombat: boolean;
  /** PIN opcional para unirse. */
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
  /** Token secreto del jugador (no se muestra a otros). */
  token: string;
  characterId?: Id;
  connected: boolean;
}

export interface Session {
  id: Id;
  code: string;
  campaignId: Id;
  /** Token secreto del DM. */
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
  /** Stats ya calculados con equipo/efectos. */
  stats: Stats;
  hpCurrent: number;
  equipment: Record<EquipmentSlot, Id | null>;
  skills: (Id | null)[];
  effects: AppliedEffect[];
  defeated: boolean;
}

export interface DeclaredAction {
  unitId: Id;
  /** Slot 1..skillSlots; cada acción ocupa un slot distinto. */
  slot: number;
  skillId?: Id;
  utilityId?: Id;
  special?: "domain" | "habitat";
  targetId?: Id;
  /** Si está presente, esta acción redirige un ataque contra este aliado. */
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
  /** Datos específicos del evento (tiradas, totales, etc.). */
  data?: Record<string, unknown>;
}

export interface CombatState {
  id: Id;
  encounterId: Id;
  round: number;
  phase: CombatPhase;
  /** Semilla del RNG del servidor. */
  seed: string;
  units: CombatUnit[];
  /** Acciones declaradas por unidad; hasta skillSlots por unidad. */
  actions: Record<Id, DeclaredAction[]>;
  /** Cooldowns de habilidades especiales por unidad. */
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
  /** El servidor rellena unitId/locked a partir del token. */
  actions: Omit<DeclaredAction, "unitId" | "locked">[];
}

export interface ApiError {
  code: string;
  message: string;
}
