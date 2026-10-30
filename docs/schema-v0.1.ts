/**
 * PROTOCOL DND — Contrato de datos v0.1
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

/** Modo de render del side-view híbrido (activo en Fase 3). */
export type VisualMode = "portrait" | "layered";

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

/** Soul Points usados por el equipo, capacidad y sobrecarga. */
export interface SoulPointsSummary {
  used: number;
  max: number;
  /** true si `used > max`: recibe 1.5× daño y se marca OVERCHARGED. */
  overcharged: boolean;
}

/* ========================================================================== */
/* Efectos de estado                                                          */
/* ========================================================================== */

export type EffectTrigger =
  | "roundStart"
  | "roundEnd"
  | "onUseSkill"
  | "onDealDamage"
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
  /** `allOthers` daña a todas las demás unidades vivas, aliadas y enemigas. */
  target?: "self" | "opponent" | "allOthers";
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
  /** `self` (default) o `opponent`, si el trigger tiene un rival. */
  target?: "self" | "opponent";
}

export interface EffectActionConsumeStacks {
  type: "consumeStacks";
  amount: number;
}

export interface EffectActionAddStacks {
  type: "addStacks";
  amount: number;
}

export type EffectAction =
  | EffectActionDamage
  | EffectActionHeal
  | EffectActionModifyStat
  | EffectActionApplyEffect
  | EffectActionConsumeStacks
  | EffectActionAddStacks;

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
  /**
   * Pasivo del equipo ya incluido en los stats del snapshot. El motor no
   * debe reaplicar sus `modifyStat` al iniciar el combate.
   */
  passive?: boolean;
  /** Variante por bando de un dominio/hábitat aplicado. */
  variant?: "ally" | "enemy";
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
  /** Si es true, los jugadores pueden verlo/elegirlo. Default: solo DM. */
  unlocked?: boolean;
  /** URL o /uploads/... */
  image?: string;
  icon?: string;
  /** Suma a los stats base al equipar. */
  stats?: Partial<Stats>;
  /** Efectos pasivos mientras está equipado. */
  effects?: { effectId: Id; stacks?: number }[];
  /** Efectos activos que se aplican al iniciar combate (pueden consumirse). */
  startCombatEffects?: { effectId: Id; stacks?: number }[];
  /** Solo utilidad: usos por combate/descanso. */
  uses?: number;
  /** Solo utilidad: qué hace al usarse. */
  useEffect?: EffectAction[];
  tags?: string[];
  price?: number;
  /** Coste en Soul Points al equipar; ausente/0 = gratis. */
  soulCost?: number;
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
  /** Capa de arma mientras se usa esta skill (modo `layered`). */
  weaponImage?: string;
  /** Capa que se dibuja detrás del personaje mientras usa la skill. */
  backImage?: string;
  /** Capa que se dibuja delante del personaje mientras usa la skill. */
  frontImage?: string;

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
  /** Si es true, los jugadores pueden verla/elegirla. Default: solo DM. */
  unlocked?: boolean;

  /** v0.1: un solo objetivo. */
  target: "single";
  /**
   * Efectos que se aplican al portador al usar la skill, antes del clash.
   * Independientes de `effects`, que van al rival impactado.
   */
  selfEffects?: SkillEffectRef[];
  effects?: SkillEffectRef[];
  tags?: string[];
  animation?: string;
}

/* ========================================================================== */
/* Habilidades especiales (dominios / hábitats)                               */
/* ========================================================================== */

export type SpecialKind = "domain" | "habitat";

/** Escena visual reutilizable por encuentros, la mesa y los dominios. */
export interface CombatScene {
  floor?: string;
  wall?: string;
  theme?: "paper" | "night";
}

export interface SpecialAbility {
  id: Id;
  code?: string;
  name: string;
  description?: string;
  image?: string;
  /** Dominio o hábitat; ausente = dominio (compatibilidad). */
  kind?: SpecialKind;
  /** Turnos que dura el efecto. */
  duration: number;
  /** Rondas de espera tras terminar la duración. Solo aplica si oncePerCombat = false. */
  cooldown?: number;
  /** Si es true, solo se puede usar una vez por combate. Default true en v0.1. */
  oncePerCombat?: boolean;
  /** Legacy: acciones con `target`. Ignorado si hay listas por bando. */
  effects: EffectAction[];
  /** Legacy: bando de `effects`. */
  target: "self" | "team" | "field";
  /** Efectos para el equipo del lanzador (incluido él). */
  allyEffects?: EffectAction[];
  /** Efectos para el equipo contrario. */
  enemyEffects?: EffectAction[];
  /** Escena temporal mientras dura; se restaura al expirar. */
  scene?: CombatScene;
}

/* ========================================================================== */
/* Personajes                                                                 */
/* ========================================================================== */

export type CharacterKind = "player" | "npc" | "enemy" | "boss";

/** Cambio de fase único de un jefe (fase 1 = ficha base). */
export interface BossPhase {
  /** 1..99; se activa al bajar a este % de vida máxima o menos. */
  thresholdPct: number;
  label?: string;
  name?: string;
  description?: string;
  portrait?: string;
  visualMode?: VisualMode;
  battleSprite?: string;
  bodyImage?: string;
  /** Exactamente 3 slots; ausente = conserva las skills base. */
  skills?: (Id | null)[];
}

export interface Character {
  id: Id;
  name: string;
  kind: CharacterKind;
  /** Retrato de ficha/menús; no es el sprite de combate salvo fallback. */
  portrait?: string;
  description?: string;

  /** Modo de render en combate. Ausente = enemigos `portrait`, resto `layered`. */
  visualMode?: VisualMode;
  /** Sprite único de combate. */
  battleSprite?: string;
  /** Cuerpo base para el modo capas. Sin él, se cae a sprite único. */
  bodyImage?: string;
  /** Configuración de fase 2; solo se evalúa si `kind === "boss"`. */
  bossPhase?: BossPhase;

  /** Stats base antes de equipo/efectos. */
  baseStats: Stats;
  /**
   * HP actual persistente entre combates. Ausente = HP máximo derivado.
   * Lo escribe el motor al terminar el combate o “Rest party” fuera de él.
   */
  hpCurrent?: number;

  /** Nivel de la ficha; ausente = 1. Las ganancias salen de los settings. */
  level?: number;

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

/** Overrides de aparición; los objetos anidados también son parciales. */
export type CharacterOverrides = Omit<
  Partial<Character>,
  "baseStats" | "equipment" | "special" | "inventory"
> & {
  baseStats?: Partial<Stats>;
  equipment?: Partial<Record<EquipmentSlot, Id | null>>;
  special?: Partial<NonNullable<Character["special"]>>;
  inventory?: { itemId: Id; qty: number }[];
};

export interface EncounterEnemy {
  characterId: Id;
  /** Cuántas copias del enemigo (default 1). */
  count?: number;
  /** Overrides puntuales para esta aparición. */
  overrides?: CharacterOverrides;
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

export interface LevelingSettings {
  /** El nivel aumenta el HP máximo. */
  hp: boolean;
  /** El nivel aumenta la DEF. */
  def: boolean;
  /** El nivel aumenta la capacidad de Soul Points. */
  soulPoints: boolean;
  hpPerLevel: number;
  defPerLevel: number;
  soulPointsPerLevel: number;
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
  /** Imagen base para el muñeco de equipo de los jugadores. */
  baseCharacterImage?: string;
  /** Progresión por nivel; ausente = defaults para campañas antiguas. */
  leveling?: LevelingSettings;
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
  /** Tipo de ficha copiado para resolver el modo visual por defecto. */
  kind: CharacterKind;
  name: string;
  description?: string;
  portrait?: string;
  visualMode?: VisualMode;
  battleSprite?: string;
  bodyImage?: string;
  /** Configuración de fase 2 copiada de la ficha (solo jefes). */
  bossPhase?: BossPhase;
  /** true cuando ya se activó la fase 2; nunca se revierte. */
  bossPhaseActive?: boolean;
  /** Stats ya calculados con equipo/efectos al iniciar (snapshot). */
  stats: Stats;
  /** Stats base (con nivel) para recalcular con efectos durante el combate. */
  baseStats?: Stats;
  hpCurrent: number;
  /** Soul Points usados/máximo y sobrecarga al iniciar el combate. */
  soulPoints?: SoulPointsSummary;
  /** Atajo de `soulPoints.overcharged`; con true recibe 1.5× daño. */
  overcharged?: boolean;
  equipment: Record<EquipmentSlot, Id | null>;
  skills: (Id | null)[];
  special?: {
    domainId?: Id | null;
    habitatId?: Id | null;
  };
  /** Efectos activos; incluye pasivos del equipo ya reflejados en `stats`. */
  effects: AppliedEffect[];
  /** Usos restantes de la utilidad durante este combate. */
  utilityUses: number;
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
  | "bossPhase"
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
  /**
   * Lock por unidad. Necesario para bloquear unidades que no declararon
   * acciones (0 acciones) y para no contar a las derrotadas. Opcional para
   * estados antiguos; 3C lo inicializa de forma lazy.
   */
  lockedUnits?: Record<Id, boolean>;
  /** Cooldowns de habilidades especiales por unidad. */
  specialCooldowns: Record<Id, Record<Id, number>>;
  /** Escena temporal de dominios/hábitats activos. */
  sceneOverrides?: {
    specialId: Id;
    casterId: Id;
    scene: CombatScene;
    previous: CombatScene;
  }[];
  log: CombatEvent[];
  winner?: Team;
}

/** Estado apto para clientes: mismo combate sin la semilla del RNG. */
export type PublicCombatState = Omit<CombatState, "seed">;

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

/** Fase 3D — payloads de Socket.IO del combate. */
export interface CombatStartPayload {
  encounterId: Id;
}

/** Acción de red: el servidor ignora/valida unitId y locked. */
export interface CombatDeclareAction
  extends Omit<DeclaredAction, "unitId" | "locked"> {
  unitId?: Id;
  locked?: boolean;
}

export interface CombatDeclarePayload {
  /** Ronda/combate esperados; el servidor rechaza paquetes viejos. */
  round?: number;
  combatId?: Id;
  /** Selector de unidad enemiga para el DM; el jugador lo ignora. */
  unitId?: Id;
  actions: CombatDeclareAction[];
}

/** `combat:lock` puede sellar la ronda; `combat:end` no lleva datos. */
export interface CombatLockPayload {
  round?: number;
  combatId?: Id;
}
export type CombatEndPayload = Record<string, never>;

export interface ApiError {
  code: string;
  message: string;
}

/* ========================================================================== */
/* FASE 3 — Side-view (activo desde 3A)                                       */
/* ========================================================================== */

/**
 * Decisión del 2026-10-27: side-view híbrido por ficha.
 *
 * - Party/NPCs importantes: capas (cuerpo base + equipo).
 * - Enemigos normales: sprite único (`battleSprite` o `portrait`).
 * - Jefes: sprite único por defecto; pueden activar capas.
 * - Fallback: capas → battleSprite → portrait → placeholder.
 *
 * `portrait` sigue siendo la imagen de ficha/menús. En Fase 3 se activaron
 * `Character.visualMode`, `Character.battleSprite`, `Character.bodyImage` y
 * `Skill.weaponImage`; después se añadieron `Skill.backImage` y
 * `Skill.frontImage` para capas de skill detrás/delante del personaje. El
 * snapshot de combate (`CombatUnit`) copia los campos de ficha para no depender
 * de la ficha viva durante la resolución.
 *
 * Defaults: enemigos → "portrait"; resto → "layered". Sin `bodyImage`, el modo
 * capas cae a sprite único. La utilidad no se dibuja en el cuerpo.
 *
 * Documento completo: docs/DECISION-SIDE-VIEW.md
 */
