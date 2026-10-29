/**
 * PROTOCOL DND — Contrato de datos v0.1
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

/**
 * Cómo se dibuja una ficha en el combate side-view.
 * - `layered`: cuerpo base + capas de equipo.
 * - `portrait`: sprite único (o retrato como fallback).
 */
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

/**
 * Resumen de Soul Points de una ficha. `used` es la suma de `Item.soulCost`
 * del equipo; `max` es la capacidad base 10 más las ganancias por nivel.
 */
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

export type EffectActionTarget = "self" | "opponent";

export interface EffectActionApplyEffect {
  type: "applyEffect";
  effectId: Id;
  stacks?: number;
  /**
   * A quién se aplica: al portador del efecto (default) o al rival del
   * trigger. `opponent` solo tiene efecto en triggers con un rival asociado
   * (al golpear, al ganar/perder clash, al usar skill o al recibir daño).
   */
  target?: EffectActionTarget;
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
  /**
   * Efecto pasivo del equipo: sus `modifyStat` ya están incluidos en los
   * stats del snapshot. El motor no debe volver a aplicarlos al iniciar.
   */
  passive?: boolean;
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
  image?: string;
  icon?: string;
  stats?: Partial<Stats>;
  effects?: { effectId: Id; stacks?: number }[];
  /**
   * Efectos que se aplican al portador como **activos** al iniciar combate.
   * A diferencia de `effects` (pasivos), estos pueden consumirse o caducar.
   */
  startCombatEffects?: { effectId: Id; stacks?: number }[];
  uses?: number;
  useEffect?: EffectAction[];
  tags?: string[];
  price?: number;
  /** Coste en Soul Points al equiparlo. Ausente/0 = gratis. */
  soulCost?: number;
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
  /**
   * Capa de arma de combate para el modo `layered`. Mientras la unidad usa
   * esta skill, sustituye temporalmente la capa del objeto de mano.
   *
   * Se mantiene por compatibilidad con campañas anteriores; para capas de
   * skill nuevas usa `backImage` y `frontImage`.
   */
  weaponImage?: string;
  /**
   * Capa que se dibuja **detrás** del personaje y de su equipo mientras la
   * unidad usa esta skill. Opcional: puede convivir con `frontImage`.
   */
  backImage?: string;
  /**
   * Capa que se dibuja **delante** del personaje y de su equipo mientras la
   * unidad usa esta skill. Opcional: puede convivir con `backImage`.
   */
  frontImage?: string;

  coins: number;
  baseClash: number;
  coinClash: number;
  baseDamage: number;
  coinDamage: number;
  fullHeadsMultiplier?: number;
  /** Si es true, los jugadores pueden verla/elegirla. Default: solo DM. */
  unlocked?: boolean;

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

export type CharacterKind = "player" | "npc" | "enemy" | "boss";

/**
 * Configuración del único cambio de fase de un jefe (fase 1 = ficha base).
 *
 * El cambio es unidireccional: al bajar del umbral se aplican los overrides y
 * `bossPhaseActive` queda fijado. Curarse por encima del umbral después no
 * revierte ni el sprite ni las habilidades.
 */
export interface BossPhase {
  /** 1..99; se activa al bajar a este % de vida máxima o menos. */
  thresholdPct: number;
  /** Etiqueta para UI/log, p. ej. "Fase 2: desatado". */
  label?: string;
  /** Overrides opcionales de la ficha al entrar en fase 2. */
  name?: string;
  description?: string;
  portrait?: string;
  visualMode?: VisualMode;
  battleSprite?: string;
  bodyImage?: string;
  /** Exactamente 3 slots; si se omite, conserva las skills base. */
  skills?: (Id | null)[];
}

export interface Character {
  id: Id;
  name: string;
  kind: CharacterKind;
  /** Retrato de ficha/menús (no es el sprite de combate salvo fallback). */
  portrait?: string;
  description?: string;

  /**
   * Modo de render en combate. Ausente = según `kind`:
   * enemigos → `portrait`; el resto → `layered`.
   */
  visualMode?: VisualMode;
  /** Sprite único de combate (modo `portrait`). */
  battleSprite?: string;
  /** Cuerpo base para el modo `layered`. Sin él, cae a sprite único. */
  bodyImage?: string;
  /**
   * Cambio de fase de un jefe. Solo se evalúa si `kind === "boss"`; un jefe
   * sin configurar es un enemigo normal sin fase 2.
   */
  bossPhase?: BossPhase;

  baseStats: Stats;
  /**
   * HP actual persistente entre combates. Ausente = HP máximo derivado.
   * Solo lo modifica el motor de combate o “Rest party” fuera de combate.
   */
  hpCurrent?: number;
  /**
   * Nivel de la ficha (1 por defecto). Las ganancias por nivel salen de
   * `CampaignSettings.leveling`; no se hornean en `baseStats`.
   */
  level?: number;
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

/**
 * Overrides puntuales de una aparición de enemigo. A diferencia de
 * `Partial<Character>`, los objetos anidados también son parciales: se puede
 * subir solo `hpMax` o cambiar únicamente un slot de equipo.
 */
export type CharacterOverrides = Omit<
  Partial<Character>,
  "baseStats" | "equipment" | "special" | "inventory"
> & {
  baseStats?: Partial<Stats>;
  equipment?: Partial<Record<EquipmentSlot, Id | null>>;
  special?: Partial<NonNullable<Character["special"]>>;
  inventory?: { itemId: Id; qty: number }[];
};

/* ========================================================================== */
/* Encuentros                                                                 */
/* ========================================================================== */

export interface EncounterEnemy {
  characterId: Id;
  count?: number;
  overrides?: CharacterOverrides;
}

export interface EncounterRewards {
  itemIds?: Id[];
  currency?: number;
  notes?: string;
}

export type SceneTheme = "paper" | "night";

export interface Encounter {
  id: Id;
  name: string;
  description?: string;
  /**
   * Capa de piso de la escena de combate (Fase 3F.5). Es el `background`
   * histórico: al iniciar el combate se copia a `CombatState.scene.floor`.
   */
  background?: string;
  /** Capa de pared de la escena; se copia a `CombatState.scene.wall`. */
  backgroundWall?: string;
  /** Tema visual de la escena; ausente = `"paper"`. */
  sceneTheme?: SceneTheme;
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

/** Skill a la venta: comprarla la desbloquea para la campaña (no se equipa). */
export interface ShopSkill {
  skillId: Id;
  price: number;
  stock?: number;
}

export interface Shop {
  id: Id;
  name: string;
  description?: string;
  currency?: string;
  /**
   * Fase 4: fondo de la escena de tienda. Admite imagen o GIF subido
   * (`/uploads/...`) y URLs http(s); si apunta a un vídeo, el cliente lo
   * reproduce en bucle.
   */
  background?: string;
  items: ShopItem[];
  /** Skills a la venta (opcional: exports anteriores no la traen). */
  skills?: ShopSkill[];
}

/**
 * Escena de tienda abierta por el DM (Fase 4A-3). Es un snapshot para la UI:
 * incluye objetos bloqueados (que el jugador no ve en su biblioteca) con lo
 * necesario para pintarlos y comprarlos.
 */
export interface ShopSceneItemInfo {
  id: Id;
  name: string;
  code?: string;
  description?: string;
  icon?: string;
  image?: string;
  slot: EquipmentSlot;
  rarity?: string;
  stats?: Partial<Stats>;
}

export interface ShopSceneItem {
  item: ShopSceneItemInfo;
  price: number;
  /** Ausente = stock infinito; 0 = agotado. */
  stock?: number;
  /** Ya desbloqueado para la campaña: no se puede volver a comprar. */
  unlocked: boolean;
}

/** Skill lista para pintar en la escena de tienda. */
export interface ShopSceneSkillInfo {
  id: Id;
  name: string;
  code?: string;
  description?: string;
  image?: string;
  coins: number;
  baseClash: number;
  coinClash: number;
  baseDamage: number;
  coinDamage: number;
  fullHeadsMultiplier?: number;
  tags?: string[];
}

export interface ShopSceneSkill {
  skill: ShopSceneSkillInfo;
  price: number;
  /** Ausente = stock infinito; 0 = agotado. */
  stock?: number;
  /** Ya desbloqueada para la campaña: no se puede volver a comprar. */
  unlocked: boolean;
}

export interface ShopScene {
  shopId: Id;
  name: string;
  description?: string;
  background?: string;
  currency?: string;
  openedAt: IsoDate;
  items: ShopSceneItem[];
  /** Skills a la venta; ausente en escenas de clientes antiguos. */
  skills?: ShopSceneSkill[];
}

/** Bolsa común de la party (Fase 4). Nunca dinero real. */
export interface CampaignWallet {
  /** Clean Shards disponibles para toda la party. */
  cleanShards: number;
}

/**
 * Tipo de sala de la dungeon lineal+ (Fase 4B/4C). Ausente = `"encounter"`.
 * - `encounter`/`boss`: lanzan su encuentro (boss es solo acento visual).
 * - `rest`: el DM descansa una vez (cura a la party).
 * - `treasure`: el DM abre el cofre una vez (entrega `rewards`).
 */
export type DungeonRoomKind = "encounter" | "rest" | "treasure" | "boss";

/**
 * Recompensas de una sala de mazmorra: las de encuentro más skills. Las
 * skills de un cofre siempre se desbloquean para la campaña (no hay inventario
 * de skills); `unlockRewards` controla solo los objetos.
 */
export interface DungeonRewards extends EncounterRewards {
  skillIds?: Id[];
}

export interface DungeonRoom {
  id: Id;
  name: string;
  /** Texto público que se ve en la escena de la sala. */
  description?: string;
  /** Notas privadas del DM (nunca llegan al jugador). */
  notes?: string;
  /** Ausente = "encounter". */
  kind?: DungeonRoomKind;
  /** Encuentro vinculado (encounter/boss); ausente = sala de ambientación. */
  encounterId?: Id;
  /** Fondo de la escena de la sala: imagen/GIF subido o URL de vídeo. */
  background?: string;
  /** Solo `treasure`: recompensa del cofre (objetos, skills y moneda). */
  rewards?: DungeonRewards;
  /**
   * Solo `treasure`: además de entregar la recompensa, desbloquea sus objetos
   * para toda la campaña (como comprar en una tienda). Ausente = false.
   */
  unlockRewards?: boolean;
}

export interface Dungeon {
  id: Id;
  name: string;
  description?: string;
  /** Dónde empieza la run; ausente = primera sala. */
  entryRoomId?: Id;
  /** Salas en orden de recorrido. */
  rooms: DungeonRoom[];
}

/* ========================================================================== */
/* Run de mazmorra (Fase 4C)                                                  */
/* ========================================================================== */

export type DungeonRunStatus = "active" | "ended";

/** Sala pública de la run: nunca incluye notas privadas del DM. */
export interface PublicDungeonRoom {
  id: Id;
  name: string;
  description?: string;
  kind: DungeonRoomKind;
  background?: string;
  /** encounter/boss con encuentro vinculado. */
  hasEncounter: boolean;
  /** treasure con recompensa configurada. */
  hasRewards: boolean;
  /** treasure: el cofre también desbloquea sus objetos para la campaña. */
  unlockRewards?: boolean;
}

/** Estado persistido de la run. Se valida con Zod al guardar. */
export interface DungeonRun {
  id: Id;
  campaignId: Id;
  sessionId: Id;
  dungeonId: Id;
  status: DungeonRunStatus;
  currentRoomId: Id;
  /** Salas resueltas (encuentro ganado, descanso usado, cofre abierto). */
  clearedRoomIds: Id[];
  /** Cofres abiertos (idempotencia de recompensas). */
  openedRoomIds: Id[];
  /** Salas de descanso usadas (idempotencia del heal). */
  restedRoomIds: Id[];
  /** Combate vivo lanzado desde la sala actual, si lo hay. */
  combatId?: Id;
  startedAt: IsoDate;
  updatedAt: IsoDate;
}

/** Acción que el DM puede ejecutar en la sala actual. */
export type DungeonRoomAction = "encounter" | "rest" | "chest";

/** Snapshot que reciben DM y jugadores; nunca incluye notas privadas. */
export interface PublicDungeonRun {
  id: Id;
  dungeonId: Id;
  dungeonName: string;
  dungeonDescription?: string;
  status: DungeonRunStatus;
  currentRoomId: Id;
  rooms: PublicDungeonRoom[];
  clearedRoomIds: Id[];
  openedRoomIds: Id[];
  restedRoomIds: Id[];
  combatId?: Id;
  /** Sala actual resuelta o sin acción: el DM puede avanzar. */
  canAdvance: boolean;
  /** Acción pendiente de la sala actual; null si ya está resuelta. */
  pendingAction: DungeonRoomAction | null;
  startedAt: IsoDate;
  updatedAt: IsoDate;
}

/* ========================================================================== */
/* Reparto de botín por turnos (Fase 4A-2)                                    */
/* ========================================================================== */

export type LootDraftStatus = "active" | "done";

/** Una elección ya hecha dentro del reparto. */
export interface LootDraftPick {
  characterId: Id;
  itemId: Id;
  at: IsoDate;
}

/**
 * Reparto de los objetos de un encuentro ganado cuando
 * `settings.shareLoot === false`. Los objetos no se entregan al ganar: se
 * eligen por turnos en orden serpiente (SPD).
 */
export interface LootDraft {
  id: Id;
  campaignId: Id;
  sessionId: Id;
  combatId?: Id;
  encounterId: Id;
  status: LootDraftStatus;
  /** Objetos pendientes; una entrada por unidad (ids repetidos = copias). */
  pool: Id[];
  /** Fichas participantes en orden base (SPD descendente). */
  order: Id[];
  /** Ronda de reparto, 1-based. Las impares van hacia delante y las pares atrás. */
  round: number;
  /** Posición dentro de la ronda (0..order.length-1). */
  turnIndex: number;
  picks: LootDraftPick[];
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/* ========================================================================== */
/* Dados de mesa (Fase 4E+)                                                   */
/* ========================================================================== */

export type DiceSides = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface DiceRoller {
  role: "dm" | "player";
  /** Nombre de la mesa: «DM» o el nombre del jugador. */
  name: string;
}

/**
 * Frame grabado de una tirada física. El servidor simula el d20 y manda la
 * trayectoria completa para que todos los clientes reproduzcan la misma caída.
 */
export interface DiceTrajectoryFrame {
  /** Centro del dado [x, y, z] en unidades de mesa. */
  p: [number, number, number];
  /** Orientación [x, y, z, w]. */
  q: [number, number, number, number];
}

export interface DiceTrajectoryImpact {
  atMs: number;
  x: number;
  z: number;
  /** Fuerza normalizada 0..1 para el anillo de impacto. */
  strength: number;
}

export interface DiceTrajectory {
  frames: DiceTrajectoryFrame[];
  durationMs: number;
  /**
   * Cara que queda arriba (o vértice superior en el d4). En un d100 es la cara
   * de ese d10: el resultado combinado está en `DiceRoll.results`.
   */
  face: number;
  impacts: DiceTrajectoryImpact[];
  /**
   * Rebotes visibles contra la mesa: contactos posteriores al primero. Es la
   * restricción que pide el gesto de arrastre; como mínimo 0.
   */
  bounces: number;
}

/** Entrada opcional del lanzamiento (arrastrar y soltar) para la simulación. */
export interface DiceThrowInput {
  /** Velocidad inicial [x, y, z] en unidades de mesa. */
  velocity?: [number, number, number];
  /** Velocidad angular [x, y, z]. */
  angular?: [number, number, number];
  /** Punto de salida sobre la mesa [x, z]. */
  start?: [number, number];
  /**
   * Rebotes deseados contra la mesa (1..4). Cuanto más se arrastra, más
   * rebotes. Solo se aplica a un dado único; en un d100 se busca en los dos
   * d10. En tiradas múltiples se ignora.
   */
  bounces?: number;
}

/** Una tirada compartida. Efímera: no se persiste en SQLite. */
export interface DiceRoll {
  id: Id;
  sides: DiceSides;
  /** Cuántos dados del mismo tipo se tiraron. */
  count: number;
  /** Resultado individual de cada dado. */
  results: number[];
  /** Suma de `results`; para un solo dado coincide con su cara. */
  result: number;
  roller: DiceRoller;
  at: IsoDate;
  /**
   * Trayectoria física de un dado único normal (no d100). Se mantiene por
   * compatibilidad: equivale a la única entrada de `trajectories`.
   */
  trajectory?: DiceTrajectory;
  /**
   * Una trayectoria física por cuerpo. En d4/d6/d8/d10/d12/d20 coincide con
   * `results`; en d100 hay dos d10 por dado (decenas y unidades), en orden.
   */
  trajectories?: DiceTrajectory[];
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

/**
 * Configuración de progresión por nivel de la campaña.
 *
 * Cada opción activa una ganancia por nivel; las tres pueden estar activas a
 * la vez. Los Soul Points parten de una base fija de 10.
 */
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
  allowPlayerEdit: boolean;
  allowPlayerEditDuringCombat: boolean;
  requirePin?: boolean;
  pin?: string;
  /** Imagen base para el muñeco de equipo de los jugadores. */
  baseCharacterImage?: string;
  /**
   * Fase 4: al ganar un encuentro, ¿cada jugador recibe cada objeto del botín
   * (true, por defecto) o se reparte por turnos (false)?
   */
  shareLoot?: boolean;
  /** Progresión por nivel. Ausente = defaults de la campaña. */
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
  /** Fase 4: bolsa de party, persistida en `campaigns.extras.wallet`. */
  wallet: CampaignWallet;
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
  /** Snapshot del tipo de ficha para resolver el modo visual por defecto. */
  kind: CharacterKind;
  name: string;
  description?: string;
  portrait?: string;
  /** Campos visuales del snapshot; no se consulta la ficha viva en combate. */
  visualMode?: VisualMode;
  battleSprite?: string;
  bodyImage?: string;
  /**
   * Configuración de cambio de fase copiada de la ficha (solo jefes). El
   * motor la evalúa al final de cada ronda sin leer la ficha viva.
   */
  bossPhase?: BossPhase;
  /** true cuando el jefe ya entró en fase 2; el cambio nunca se revierte. */
  bossPhaseActive?: boolean;
  /** Stats derivados al iniciar; no cambian si la ficha se edita después. */
  stats: Stats;
  /**
   * Tirada de SPD de este combate (1..4), aplicada una sola vez al iniciar.
   * `stats.spd` ya la incluye (SPD derivada + roll) y se conserva al refrescar
   * stats entre rondas. Ausente/0 en estados antiguos o con speedRoll:false.
   */
  spdRoll?: number;
  /**
   * Stats base de la ficha antes de equipo/efectos, ya con las ganancias de
   * nivel. El motor los usa para recalcular `stats` cuando entran o salen
   * efectos. Ausente en estados antiguos: en ese caso se usa `stats` como base.
   */
  baseStats?: Stats;
  hpCurrent: number;
  /**
   * Soul Points usados por el equipo y capacidad de la ficha. Se copian del
   * cálculo derivado al iniciar el combate.
   */
  soulPoints?: SoulPointsSummary;
  /** Atajo de `soulPoints.overcharged`; con true recibe 1.5× daño. */
  overcharged?: boolean;
  equipment: Record<EquipmentSlot, Id | null>;
  skills: (Id | null)[];
  /** Dominio/hábitat equipados, copiados para el motor. */
  special?: {
    domainId?: Id | null;
    habitatId?: Id | null;
  };
  /**
   * Efectos activos. Incluye los pasivos del equipo al iniciar; sus
   * modificadores de stats ya están reflejados en `stats`.
   */
  effects: AppliedEffect[];
  /** Usos restantes de la utilidad equipada en este combate. */
  utilityUses: number;
  defeated: boolean;
}

export interface DeclaredAction {
  unitId: Id;
  slot: number;
  skillId?: Id;
  utilityId?: Id;
  special?: "domain" | "habitat";
  targetId?: Id;
  /**
   * Slot (1..6) de la ficha objetivo elegido solo para presentación. No
   * participa en el emparejamiento de clash: este sigue siendo por unidad y
   * sin importar slot.
   */
  targetSlot?: number;
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
  data?: Record<string, unknown>;
}

/**
 * Escena visual del combate (Fase 3F.5). Es solo presentación: el DM puede
 * cambiarla en vivo y el motor nunca la lee.
 */
export interface CombatScene {
  /** URL/ruta de la capa de piso. */
  floor?: string;
  /** URL/ruta de la capa de pared. */
  wall?: string;
  /** Tema visual; ausente = `"paper"`. */
  theme?: SceneTheme;
}

/** Patch parcial de escena; al menos un campo. `""` limpia una capa. */
export type CombatScenePatch = Partial<CombatScene>;

export interface CombatState {
  id: Id;
  encounterId: Id;
  round: number;
  phase: CombatPhase;
  /** Semilla del RNG del servidor. Nunca se envía al cliente. */
  seed: string;
  units: CombatUnit[];
  actions: Record<Id, DeclaredAction[]>;
  /**
   * Lock por unidad, incluido el de unidades que no declararon acciones.
   * Opcional para compatibilidad con estados antiguos; 3C lo inicializa de
   * forma lazy. Las unidades derrotadas no cuentan para el lock global.
   */
  lockedUnits?: Record<Id, boolean>;
  specialCooldowns: Record<Id, Record<Id, number>>;
  /**
   * Escena visual del combate. Copiada del encuentro al iniciar y editable
   * por el DM en vivo. Ausente en estados antiguos: el cliente usa fallback.
   */
  scene?: CombatScene;
  log: CombatEvent[];
  winner?: Team;
  /**
   * Fase 4: recompensas del encuentro ya aplicadas. Vive en el JSON del
   * estado (sin migración) y evita pagar dos veces al reabrir el cierre.
   */
  rewardsApplied?: boolean;
  /** Resumen de lo entregado al ganar, para el log y la escena de resultado. */
  rewardSummary?: CombatRewardSummary;
}

/** Lo que la party recibió al ganar un encuentro (Fase 4). */
export interface CombatRewardSummary {
  /** Clean Shards añadidos a la bolsa de party. */
  currency?: number;
  /** Objetos entregados (una entrada por unidad; repetidos = varias copias). */
  itemIds?: Id[];
  /** Fichas que recibieron objetos. */
  characterIds?: Id[];
  /** Objetos que quedan pendientes de reparto por turnos (`shareLoot` off). */
  pendingItemIds?: Id[];
  /** Reparto creado para esos objetos pendientes. */
  lootDraftId?: Id;
  /** Objetos desbloqueados para la campaña por un cofre `unlockRewards`. */
  unlockedItemIds?: Id[];
  /** Skills desbloqueadas para la campaña por el cofre. */
  unlockedSkillIds?: Id[];
}

/** Vista de combate apta para clientes: mismo estado sin la semilla. */
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
  actions: Omit<DeclaredAction, "unitId" | "locked">[];
}

export interface ApiError {
  code: string;
  message: string;
}
