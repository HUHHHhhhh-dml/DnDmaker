import { z } from "zod";


/**
 * Esquemas Zod del contrato v0.1.
 *
 * Todo lo que entra por API o por import pasa por aquí. Las reglas de negocio
 * que dependen del contenido (referencias, slots, etc.) viven en
 * `validation.ts` y se ejecutan después del parseo.
 */

const idSchema = z.string().trim().min(1).max(160);
const codeSchema = z.string().trim().max(40);
export const nameSchema = z.string().trim().min(1, "El nombre es obligatorio").max(80);
export const descriptionSchema = z.string().max(2000);
const imageSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) =>
      value === "" ||
      (value.startsWith("/") && !value.startsWith("//")) ||
      /^https?:\/\//i.test(value) ||
      value.startsWith("data:image/"),
    "Usa una URL http(s), un archivo subido (/uploads/...), una ruta local (/assets/...) o déjalo vacío",
  );
const tagSchema = z.string().trim().max(40);
const tagsSchema = z.array(tagSchema).max(20);

const integer = (min: number, max: number) =>
  z.number().int().min(min).max(max);

export const statKeySchema = z.enum([
  "hpMax",
  "def",
  "atk",
  "spd",
  "luck",
  "skillSlots",
]);

export const damageTypeSchema = z.enum(["physical", "mystic", "pure"]);

export const equipmentSlotSchema = z.enum([
  "horns",
  "hand",
  "armor",
  "leg",
  "utility",
]);

export const characterKindSchema = z.enum([
  "player",
  "npc",
  "enemy",
  "boss",
]);

/** Modo de render del side-view híbrido. */
export const visualModeSchema = z.enum(["portrait", "layered"]);

/** Tema visual de la escena de combate (Fase 3F.5). */
export const sceneThemeSchema = z.enum(["paper", "night"]);

export const effectTriggerSchema = z.enum([
  "roundStart",
  "roundEnd",
  "onUseSkill",
  "onDealDamage",
  "onTakeDamage",
  "onClashWin",
  "onClashLose",
  "onDefeat",
]);

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

/** Stats de un objeto: cada clave es opcional y suma al equipar. */
export const partialStatsSchema = z.object({
  hpMax: integer(-999, 999).optional(),
  def: integer(-999, 999).optional(),
  atk: integer(-999, 999).optional(),
  spd: integer(-999, 999).optional(),
  luck: integer(-999, 999).optional(),
  skillSlots: integer(-6, 6).optional(),
});

/** Stats base de un personaje. */
export const characterStatsSchema = z.object({
  hpMax: integer(1, 999),
  def: integer(-999, 999),
  atk: integer(-999, 999),
  spd: integer(-999, 999),
  luck: integer(-999, 999),
  skillSlots: integer(1, 6),
});

export const statPatchSchema = partialStatsSchema;

/* -------------------------------------------------------------------------- */
/* Efectos                                                                    */
/* -------------------------------------------------------------------------- */

export const effectActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("damage"),
    base: integer(-9999, 9999).optional(),
    perStack: integer(-9999, 9999).optional(),
    damageType: damageTypeSchema.optional(),
  }),
  z.object({
    type: z.literal("heal"),
    base: integer(-9999, 9999).optional(),
    perStack: integer(-9999, 9999).optional(),
  }),
  z.object({
    type: z.literal("modifyStat"),
    stat: statKeySchema,
    mode: z.enum(["flat", "percent"]),
    amount: integer(-9999, 9999),
    perStack: integer(-9999, 9999).optional(),
  }),
  z.object({
    type: z.literal("applyEffect"),
    effectId: idSchema,
    stacks: integer(1, 99).optional(),
    /** `opponent` aplica al rival del trigger; ausente = portador. */
    target: z.enum(["self", "opponent"]).optional(),
  }),
  z.object({
    type: z.literal("consumeStacks"),
    amount: integer(1, 99),
  }),
]);

export const effectTriggerSpecSchema = z.object({
  when: effectTriggerSchema,
  actions: z.array(effectActionSchema).min(1, "Añade al menos una acción").max(20),
});

const effectFields = {
  code: codeSchema.optional(),
  name: nameSchema,
  description: descriptionSchema.optional(),
  icon: imageSchema.optional(),
  maxStacks: integer(1, 99).optional(),
  stackMode: z.enum(["add", "refresh", "replace"]).optional(),
  duration: z
    .union([
      z.object({ type: z.literal("turns"), default: integer(1, 99) }),
      z.object({ type: z.literal("permanent") }),
    ])
    .optional(),
  triggers: z.array(effectTriggerSpecSchema).max(20),
  tags: tagsSchema.optional(),
};

export const effectInputSchema = z.object(effectFields);
export const effectSchema = effectInputSchema.extend({ id: idSchema });
export const effectPatchSchema = effectInputSchema.partial();

/* -------------------------------------------------------------------------- */
/* Items                                                                      */
/* -------------------------------------------------------------------------- */

const itemEffectRefSchema = z.object({
  effectId: idSchema,
  stacks: integer(1, 99).optional(),
});

const itemFields = {
  code: codeSchema.optional(),
  name: nameSchema,
  description: descriptionSchema.optional(),
  slot: equipmentSlotSchema,
  rarity: z.string().trim().max(40).optional(),
  /** Visibilidad para jugadores; ausente = bloqueado. */
  unlocked: z.boolean().optional(),
  image: imageSchema.optional(),
  icon: imageSchema.optional(),
  stats: partialStatsSchema.optional(),
  effects: z.array(itemEffectRefSchema).max(10).optional(),
  uses: integer(0, 99).optional(),
  useEffect: z.array(effectActionSchema).max(20).optional(),
  tags: tagsSchema.optional(),
  price: integer(0, 9_999_999).optional(),
  /** Coste de Soul Points al equipar; ausente = 0. */
  soulCost: integer(0, 999).optional(),
};

export const itemInputSchema = z.object(itemFields);
export const itemSchema = itemInputSchema.extend({ id: idSchema });
export const itemPatchSchema = itemInputSchema.partial();

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

const skillEffectRefSchema = z.object({
  effectId: idSchema,
  chance: z.number().min(0).max(1).optional(),
  stacks: integer(1, 99).optional(),
});

const skillFields = {
  code: codeSchema.optional(),
  name: nameSchema,
  description: descriptionSchema.optional(),
  image: imageSchema.optional(),
  /** Capa de arma que sustituye a la mano mientras se usa esta skill. */
  weaponImage: imageSchema.optional(),
  /** Capa de combate detrás del personaje mientras se usa la skill. */
  backImage: imageSchema.optional(),
  /** Capa de combate delante del personaje mientras se usa la skill. */
  frontImage: imageSchema.optional(),
  coins: integer(1, 20),
  baseClash: integer(-9999, 9999),
  coinClash: integer(-9999, 9999),
  baseDamage: integer(-9999, 9999),
  coinDamage: integer(-9999, 9999),
  fullHeadsMultiplier: z.number().min(1).max(10).optional(),
  /** Visibilidad para jugadores; ausente = bloqueada. */
  unlocked: z.boolean().optional(),
  target: z.literal("single").default("single"),
  effects: z.array(skillEffectRefSchema).max(10).optional(),
  tags: tagsSchema.optional(),
  animation: z.string().trim().max(80).optional(),
};

export const skillInputSchema = z.object(skillFields);
export const skillSchema = skillInputSchema.extend({ id: idSchema });
export const skillPatchSchema = skillInputSchema.partial();

/* -------------------------------------------------------------------------- */
/* Specials (dominios / hábitats)                                             */
/* -------------------------------------------------------------------------- */

const specialFields = {
  code: codeSchema.optional(),
  name: nameSchema,
  description: descriptionSchema.optional(),
  image: imageSchema.optional(),
  duration: integer(1, 99),
  cooldown: integer(0, 99).optional(),
  oncePerCombat: z.boolean().optional(),
  effects: z.array(effectActionSchema).max(20),
  target: z.enum(["self", "team", "field"]).default("team"),
};

export const specialInputSchema = z.object(specialFields);
export const specialSchema = specialInputSchema.extend({ id: idSchema });
export const specialPatchSchema = specialInputSchema.partial();

/* -------------------------------------------------------------------------- */
/* Personajes                                                                 */
/* -------------------------------------------------------------------------- */

const nullableId = idSchema.nullable();

export const equipmentSchema = z.object({
  horns: nullableId,
  hand: nullableId,
  armor: nullableId,
  leg: nullableId,
  utility: nullableId,
});

export const characterSkillsSchema = z.tuple([
  nullableId,
  nullableId,
  nullableId,
]);

/**
 * Cambio de fase de un jefe. Todos los overrides son opcionales; `skills`
 * ausente conserva las skills base de la ficha.
 */
export const bossPhaseSchema = z.object({
  thresholdPct: integer(1, 99),
  label: z.string().trim().max(120).optional(),
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  portrait: imageSchema.optional(),
  visualMode: visualModeSchema.optional(),
  battleSprite: imageSchema.optional(),
  bodyImage: imageSchema.optional(),
  skills: characterSkillsSchema.optional(),
});

const inventoryEntrySchema = z.object({
  itemId: idSchema,
  qty: integer(1, 9999),
});

const characterSpecialSchema = z.object({
  domainId: nullableId.optional(),
  habitatId: nullableId.optional(),
});

const characterFields = {
  name: nameSchema,
  kind: characterKindSchema,
  portrait: imageSchema.optional(),
  description: descriptionSchema.optional(),
  visualMode: visualModeSchema.optional(),
  battleSprite: imageSchema.optional(),
  bodyImage: imageSchema.optional(),
  /** Solo se evalúa en fichas de tipo jefe. */
  bossPhase: bossPhaseSchema.optional(),
  baseStats: characterStatsSchema,
  /** HP actual; ausente = HP máximo derivado. */
  hpCurrent: integer(0, 99_999).optional(),
  /** Nivel de la ficha; ausente = 1. */
  level: integer(1, 9999).optional(),
  equipment: equipmentSchema,
  skills: characterSkillsSchema,
  special: characterSpecialSchema.optional(),
  inventory: z.array(inventoryEntrySchema).max(200),
  notes: z.string().max(4000).optional(),
  ownerId: idSchema.optional(),
  tags: tagsSchema.optional(),
};

export const characterInputSchema = z.object(characterFields);
export const characterSchema = characterInputSchema.extend({ id: idSchema });
export const characterPatchSchema = characterInputSchema.partial();

/* -------------------------------------------------------------------------- */
/* Encuentros                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Overrides de una aparición: todos los campos son opcionales y los objetos
 * anidados también, para poder pisar solo `hpMax` o un slot de equipo.
 */
const characterOverridesSchema = z.object({
  name: nameSchema.optional(),
  kind: characterKindSchema.optional(),
  portrait: imageSchema.optional(),
  description: descriptionSchema.optional(),
  visualMode: visualModeSchema.optional(),
  battleSprite: imageSchema.optional(),
  bodyImage: imageSchema.optional(),
  bossPhase: bossPhaseSchema.optional(),
  baseStats: characterStatsSchema.partial().optional(),
  hpCurrent: integer(0, 99_999).optional(),
  level: integer(1, 9999).optional(),
  equipment: equipmentSchema.partial().optional(),
  skills: characterSkillsSchema.optional(),
  special: characterSpecialSchema.partial().optional(),
  inventory: z.array(inventoryEntrySchema).max(200).optional(),
  notes: z.string().max(4000).optional(),
  ownerId: idSchema.optional(),
  tags: tagsSchema.optional(),
});

const encounterEnemySchema = z.object({
  characterId: idSchema,
  count: integer(1, 20).optional(),
  overrides: characterOverridesSchema.optional(),
});

const encounterRewardsSchema = z.object({
  itemIds: z.array(idSchema).max(100).optional(),
  currency: integer(0, 9_999_999).optional(),
  notes: z.string().max(2000).optional(),
});

const encounterFields = {
  name: nameSchema,
  description: descriptionSchema.optional(),
  /** Capa de piso (nombre histórico `background`). */
  background: imageSchema.optional(),
  /** Capa de pared de la escena de combate. */
  backgroundWall: imageSchema.optional(),
  /** Tema visual; ausente = "paper". */
  sceneTheme: sceneThemeSchema.optional(),
  enemies: z.array(encounterEnemySchema).max(50),
  rewards: encounterRewardsSchema.optional(),
  victory: z.string().max(2000).optional(),
  defeat: z.string().max(2000).optional(),
};

export const encounterInputSchema = z.object(encounterFields);
export const encounterSchema = encounterInputSchema.extend({ id: idSchema });
export const encounterPatchSchema = encounterInputSchema.partial();

/* -------------------------------------------------------------------------- */
/* Tiendas y bolsa de la party (Fase 4)                                       */
/* -------------------------------------------------------------------------- */

export const walletSchema = z.object({
  cleanShards: integer(0, 9_999_999),
});

export const shopItemSchema = z.object({
  itemId: idSchema,
  price: integer(0, 9_999_999),
  /** Ausente = stock infinito; 0 = agotado. */
  stock: integer(0, 9999).optional(),
});

/** Skill a la venta: la compra la desbloquea para la campaña. */
export const shopSkillSchema = z.object({
  skillId: idSchema,
  price: integer(0, 9_999_999),
  /** Ausente = stock infinito; 0 = agotado. */
  stock: integer(0, 9999).optional(),
});

const shopFields = {
  name: nameSchema,
  description: descriptionSchema.optional(),
  currency: z.string().max(40).optional(),
  /** Fondo de la escena: imagen/GIF subido o URL (admite vídeo http). */
  background: imageSchema.optional(),
  items: z.array(shopItemSchema).max(200),
  /** Opcional para no romper exports anteriores. */
  skills: z.array(shopSkillSchema).max(200).optional(),
};

export const shopInputSchema = z.object(shopFields);
export const shopSchema = shopInputSchema.extend({ id: idSchema });
export const shopPatchSchema = shopInputSchema.partial();

/**
 * Compra en la escena de tienda (Fase 4A-3): paga el precio y desbloquea el
 * objeto para toda la campaña. No entra en el inventario.
 */
export const shopBuyInputSchema = z.union([
  z.object({ itemId: idSchema }),
  z.object({ skillId: idSchema }),
]);

/** Abrir una tienda en la mesa: solo el DM y solo una a la vez. */
export const shopOpenInputSchema = z.object({
  shopId: idSchema,
});

/** Ajuste de la bolsa por el DM. `delta` puede ser negativo; nunca deja < 0. */
export const walletAdjustInputSchema = z.object({
  delta: integer(-9_999_999, 9_999_999),
});

export type ShopInput = z.infer<typeof shopInputSchema>;
export type ShopPatchInput = z.infer<typeof shopPatchSchema>;
export type ShopBuyInput = z.infer<typeof shopBuyInputSchema>;
export type ShopOpenInput = z.infer<typeof shopOpenInputSchema>;
export type WalletAdjustInput = z.infer<typeof walletAdjustInputSchema>;

/* -------------------------------------------------------------------------- */
/* Mazmorras lineales+ (Fase 4B)                                              */
/* -------------------------------------------------------------------------- */

export const dungeonRoomKindSchema = z.enum([
  "encounter",
  "rest",
  "treasure",
  "boss",
]);

const dungeonRewardsSchema = encounterRewardsSchema.extend({
  /** Skills que el cofre desbloquea para la campaña. */
  skillIds: z.array(idSchema).max(100).optional(),
});

const dungeonRoomFields = {
  name: nameSchema,
  /** Texto público de la escena de la sala. */
  description: descriptionSchema.optional(),
  /** Notas privadas del DM: nunca llegan al jugador. */
  notes: z.string().max(4000).optional(),
  /** Ausente = "encounter". */
  kind: dungeonRoomKindSchema.optional(),
  /** Encuentro vinculado; ausente = sala de ambientación. */
  encounterId: idSchema.optional(),
  /** Fondo de la escena: imagen/GIF subido o URL (admite vídeo http). */
  background: imageSchema.optional(),
  /** Solo `treasure`: objetos, skills y moneda del cofre. */
  rewards: dungeonRewardsSchema.optional(),
  /** Solo `treasure`: desbloquea los objetos para la campaña al abrirlo. */
  unlockRewards: z.boolean().optional(),
};

/** Sala tal y como la manda el editor; el servidor asigna `id` si falta. */
export const dungeonRoomInputSchema = z.object({
  id: idSchema.optional(),
  ...dungeonRoomFields,
});

/** Sala persistida: siempre con `id`. */
export const dungeonRoomSchema = z.object({
  id: idSchema,
  ...dungeonRoomFields,
});

const dungeonFields = {
  name: nameSchema,
  description: descriptionSchema.optional(),
  /** Dónde empieza la run; ausente = primera sala. */
  entryRoomId: idSchema.optional(),
  rooms: z.array(dungeonRoomInputSchema).min(1).max(100),
};

export const dungeonInputSchema = z.object(dungeonFields);
export const dungeonSchema = dungeonInputSchema.extend({
  id: idSchema,
  rooms: z.array(dungeonRoomSchema).min(1).max(100),
});
export const dungeonPatchSchema = z.object({
  ...dungeonFields,
  name: nameSchema.optional(),
  rooms: z.array(dungeonRoomInputSchema).min(1).max(100).optional(),
});

export type DungeonRoomInput = z.infer<typeof dungeonRoomInputSchema>;
export type DungeonInput = z.infer<typeof dungeonInputSchema>;
export type DungeonPatchInput = z.infer<typeof dungeonPatchSchema>;

/** Tirada de dado (Fase 4E+). El servidor decide el resultado. */
export const diceSidesSchema = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
  z.literal(20),
  z.literal(100),
]);

export const diceRollInputSchema = z.object({
  sides: diceSidesSchema,
  /** Dados del mismo tipo que se tiran y se suman; 1 por defecto. */
  count: z.number().int().min(1).max(20).optional(),
  /**
   * Lanzamiento opcional para la simulación física (arrastrar y soltar).
   * El servidor lo usa como condición inicial y añade su propia entropía.
   */
  throw: z
    .object({
      velocity: z
        .tuple([
          z.number().min(-10).max(10),
          z.number().min(-10).max(10),
          z.number().min(-10).max(10),
        ])
        .optional(),
      angular: z
        .tuple([
          z.number().min(-40).max(40),
          z.number().min(-40).max(40),
          z.number().min(-40).max(40),
        ])
        .optional(),
      start: z
        .tuple([z.number().min(-3).max(3), z.number().min(-3).max(3)])
        .optional(),
      /** Rebotes contra la mesa que pide el gesto (1..4). */
      bounces: z.number().int().min(1).max(4).optional(),
    })
    .optional(),
});

export type DiceRollInput = z.infer<typeof diceRollInputSchema>;

/** Empezar una run desde la mesa (Fase 4C). */
export const dungeonStartInputSchema = z.object({
  dungeonId: idSchema,
  entryRoomId: idSchema.optional(),
});

export type DungeonStartInput = z.infer<typeof dungeonStartInputSchema>;

/** Estado persistido de la run; se valida antes de guardarlo en `dungeon_runs`. */
export const dungeonRunSchema = z.object({
  id: idSchema,
  campaignId: idSchema,
  sessionId: idSchema,
  dungeonId: idSchema,
  status: z.enum(["active", "ended"]),
  currentRoomId: idSchema,
  clearedRoomIds: z.array(idSchema).max(100),
  openedRoomIds: z.array(idSchema).max(100),
  restedRoomIds: z.array(idSchema).max(100),
  combatId: idSchema.optional(),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type DungeonRunState = z.infer<typeof dungeonRunSchema>;

/* -------------------------------------------------------------------------- */
/* Reparto de botín (Fase 4A-2)                                               */
/* -------------------------------------------------------------------------- */

export const lootDraftPickSchema = z.object({
  characterId: idSchema,
  itemId: idSchema,
  at: z.string().min(1),
});

/** Estado persistido de un reparto por turnos. Se valida al guardar. */
export const lootDraftSchema = z.object({
  id: idSchema,
  campaignId: idSchema,
  sessionId: idSchema,
  combatId: idSchema.optional(),
  encounterId: idSchema,
  status: z.enum(["active", "done"]),
  /** Objetos pendientes; ids repetidos = copias distintas. */
  pool: z.array(idSchema).max(500),
  /** Participantes en orden base (SPD descendente), máximo 6 jugadores. */
  order: z.array(idSchema).min(1).max(6),
  round: integer(1, 999),
  turnIndex: integer(0, 5),
  picks: z.array(lootDraftPickSchema).max(500),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type LootDraftState = z.infer<typeof lootDraftSchema>;

/* -------------------------------------------------------------------------- */
/* Reglas, settings y campaña                                                  */
/* -------------------------------------------------------------------------- */

export const rulesetSchema = z.object({
  defenseConstant: integer(1, 9999),
  minDamage: integer(1, 9999),
  maxSkillSlots: integer(1, 6),
  tieRule: z.enum(["cancel_both", "defender_wins", "both_half"]),
  fullHeadsMultiplier: z.number().min(1).max(20),
  luckCap: z.number().min(0).max(1),
  luckFloor: z.number().min(0).max(1),
  hpPersistence: z.enum(["persist", "restore"]),
});

/** Configuración de ganancias por nivel. Las tres opciones son independientes. */
export const levelingSchema = z.object({
  hp: z.boolean(),
  def: z.boolean(),
  soulPoints: z.boolean(),
  hpPerLevel: integer(0, 9999),
  defPerLevel: integer(0, 999),
  soulPointsPerLevel: integer(0, 999),
});

export const campaignSettingsSchema = z.object({
  maxPlayers: integer(1, 6),
  allowPlayerEdit: z.boolean(),
  allowPlayerEditDuringCombat: z.boolean(),
  requirePin: z.boolean().optional(),
  pin: z.string().max(12).optional(),
  baseCharacterImage: imageSchema.optional(),
  /** Fase 4A-2: reparto de objetos; ausente = todos reciben cada objeto. */
  shareLoot: z.boolean().optional(),
  /** Progresión por nivel; ausente = defaults para campañas antiguas. */
  leveling: levelingSchema.optional(),
});

export const campaignContentSchema = z.object({
  items: z.array(itemSchema).max(2000),
  skills: z.array(skillSchema).max(2000),
  effects: z.array(effectSchema).max(2000),
  characters: z.array(characterSchema).max(2000),
  encounters: z.array(encounterSchema).max(2000),
  specials: z.array(specialSchema).max(500),
  shops: z.array(shopSchema).max(500),
  dungeons: z.array(dungeonSchema).max(500),
});

/** Campaña completa: formato de export/import y de lectura desde la API. */
export const campaignSchema = z.object({
  id: idSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  schemaVersion: z.literal(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  rules: rulesetSchema,
  settings: campaignSettingsSchema,
  /** Opcional al importar: los exports de Fase 3 no traen bolsa. */
  wallet: walletSchema.default({ cleanShards: 0 }),
  content: campaignContentSchema,
});

export const campaignCreateSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  rules: rulesetSchema.partial().optional(),
  settings: campaignSettingsSchema.partial().optional(),
  /** Copia el contenido de la campaña semilla. */
  seed: z.boolean().optional(),
});

export const campaignPatchSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  rules: rulesetSchema.partial().optional(),
  settings: campaignSettingsSchema.partial().optional(),
});

export const campaignImportSchema = z.object({
  campaign: campaignSchema,
});

/* -------------------------------------------------------------------------- */
/* Sesiones (Fase 2)                                                          */
/* -------------------------------------------------------------------------- */

export const sessionJoinSchema = z.object({
  name: z.string().trim().min(1, "Escribe tu nombre").max(40),
  pin: z.string().max(12).optional(),
  characterId: idSchema.optional(),
});

/** Ajustes de PIN que el DM puede fijar al abrir/reabrir una sala. */
export const hostSessionSchema = z.object({
  requirePin: z.boolean().optional(),
  pin: z.string().max(12).optional(),
});

export type SessionJoinInput = z.infer<typeof sessionJoinSchema>;
export type HostSessionInput = z.infer<typeof hostSessionSchema>;

/* -------------------------------------------------------------------------- */
/* Combate (Fase 3)                                                          */
/* -------------------------------------------------------------------------- */

/** Stats ya derivados: pueden superar los límites de una ficha base. */
export const combatStatsSchema = z.object({
  hpMax: integer(1, 99_999),
  def: integer(-99_999, 99_999),
  atk: integer(-99_999, 99_999),
  spd: integer(-99_999, 99_999),
  luck: integer(-99_999, 99_999),
  skillSlots: integer(1, 6),
});

/** Resumen de Soul Points copiado al snapshot de combate. */
export const soulPointsSchema = z.object({
  used: integer(0, 99_999),
  max: integer(0, 99_999),
  overcharged: z.boolean(),
});

export const appliedEffectSchema = z.object({
  effectId: idSchema,
  stacks: integer(1, 99),
  potency: z.number().optional(),
  /** undefined = permanente mientras dure el combate/equipo. */
  remainingTurns: integer(0, 99_999).optional(),
  sourceId: idSchema.optional(),
  /** Pasivo del equipo ya incluido en los stats del snapshot. */
  passive: z.boolean().optional(),
});

export const teamSchema = z.enum(["players", "enemies"]);
export const combatPhaseSchema = z.enum(["declaring", "resolving", "ended"]);

/**
 * Escena visual del combate. `floor`/`wall` usan el validador de imágenes y
 * `""` sirve para limpiar una capa. `theme` ausente = "paper".
 */
export const combatSceneSchema = z.object({
  floor: imageSchema.optional(),
  wall: imageSchema.optional(),
  theme: sceneThemeSchema.optional(),
});

/**
 * Patch de escena que puede emitir el DM. Reutilizable por el servicio y por
 * el socket; exige al menos un campo para evitar diffs vacíos.
 */
export const combatScenePatchSchema = combatSceneSchema
  .refine(
    (patch) =>
      patch.theme !== undefined ||
      patch.floor !== undefined ||
      patch.wall !== undefined,
    "Indica al menos un cambio de escena (theme, floor o wall).",
  );

export const combatUnitSchema = z.object({
  id: idSchema,
  characterId: idSchema,
  team: teamSchema,
  kind: characterKindSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  portrait: imageSchema.optional(),
  visualMode: visualModeSchema.optional(),
  battleSprite: imageSchema.optional(),
  bodyImage: imageSchema.optional(),
  /** Configuración de fase 2 copiada de la ficha (solo jefes). */
  bossPhase: bossPhaseSchema.optional(),
  /** true cuando ya se activó la fase 2; nunca se revierte. */
  bossPhaseActive: z.boolean().optional(),
  stats: combatStatsSchema,
  /**
   * Roll de SPD de este combate (1..4). 0/ausente en estados antiguos o si
   * el combate se inició con speedRoll:false.
   */
  spdRoll: integer(0, 4).optional(),
  /** Base para recalcular stats con efectos; opcional en estados antiguos. */
  baseStats: combatStatsSchema.optional(),
  hpCurrent: integer(0, 99_999),
  /** Soul Points usados/máximo; ausente en estados antiguos. */
  soulPoints: soulPointsSchema.optional(),
  /** Atajo de `soulPoints.overcharged` para el motor. */
  overcharged: z.boolean().optional(),
  equipment: equipmentSchema,
  skills: characterSkillsSchema,
  special: characterSpecialSchema.optional(),
  effects: z.array(appliedEffectSchema).max(100),
  utilityUses: integer(0, 99),
  defeated: z.boolean(),
});

export const declaredActionSchema = z
  .object({
    unitId: idSchema,
    /** Slot 1..skillSlots; cada acción ocupa un slot distinto. */
    slot: integer(1, 6),
    skillId: idSchema.optional(),
    utilityId: idSchema.optional(),
    special: z.enum(["domain", "habitat"]).optional(),
    targetId: idSchema.optional(),
    /** Slot visual del objetivo (1..6); no interviene en el clash. */
    targetSlot: integer(1, 6).optional(),
    redirectFor: idSchema.optional(),
    locked: z.boolean(),
  })
  .refine(
    (action) => Boolean(action.skillId || action.utilityId || action.special),
    "La acción necesita una skill, una utilidad o un especial.",
  );

export const combatEventTypeSchema = z.enum([
  "roundStart",
  "actionDeclared",
  "clash",
  "redirect",
  "special",
  "damage",
  "heal",
  "effectApplied",
  "effectTick",
  "cooldown",
  "defeated",
  "roundEnd",
  "bossPhase",
  "combatEnd",
]);

export const combatEventSchema = z.object({
  id: idSchema,
  round: integer(1, 99_999),
  type: combatEventTypeSchema,
  actorId: idSchema.optional(),
  targetId: idSchema.optional(),
  message: z.string().max(4000),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** Estado completo del combate; se persiste como JSON validado. */
export const combatStateSchema = z.object({
  id: idSchema,
  encounterId: idSchema,
  round: integer(1, 99_999),
  phase: combatPhaseSchema,
  seed: z.string().trim().min(1).max(200),
  units: z.array(combatUnitSchema).max(100),
  actions: z.record(z.string(), z.array(declaredActionSchema).max(6)),
  /** Lock por unidad, incluidas las que no declararon acciones. */
  lockedUnits: z.record(z.string(), z.boolean()).optional(),
  specialCooldowns: z.record(
    z.string(),
    z.record(z.string(), integer(0, 99_999)),
  ),
  /** Escena visual; opcional para estados antiguos sin capas/tema. */
  scene: combatSceneSchema.optional(),
  log: z.array(combatEventSchema).max(50_000),
  winner: teamSchema.optional(),
  /** Fase 4: el botín ya se pagó; evita duplicarlo al reabrir el cierre. */
  rewardsApplied: z.boolean().optional(),
  /** Fase 4: resumen de lo entregado al ganar el encuentro. */
  rewardSummary: z
    .object({
      currency: integer(0, 9_999_999).optional(),
      itemIds: z.array(idSchema).max(500).optional(),
      characterIds: z.array(idSchema).max(100).optional(),
      pendingItemIds: z.array(idSchema).max(500).optional(),
      lootDraftId: idSchema.optional(),
      unlockedItemIds: z.array(idSchema).max(500).optional(),
      unlockedSkillIds: z.array(idSchema).max(500).optional(),
    })
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* Payloads de red del combate (Fase 3D)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Acción que llega por Socket.IO. Acepta `unitId`/`locked` por compatibilidad
 * con `DeclaredAction`, pero el servidor los normaliza: un jugador solo puede
 * declarar su unidad y el lock nunca lo decide el cliente.
 */
export const combatDeclareActionSchema = z
  .object({
    unitId: idSchema.optional(),
    slot: integer(1, 6),
    skillId: idSchema.optional(),
    utilityId: idSchema.optional(),
    special: z.enum(["domain", "habitat"]).optional(),
    targetId: idSchema.optional(),
    /** Slot visual del objetivo (1..6); el servidor valida contra la ficha. */
    targetSlot: integer(1, 6).optional(),
    redirectFor: idSchema.optional(),
    locked: z.boolean().optional(),
  })
  .refine(
    (action) => Boolean(action.skillId || action.utilityId || action.special),
    "La acción necesita una skill, una utilidad o un especial.",
  );

export const combatStartPayloadSchema = z.object({
  encounterId: idSchema,
});

export const combatDeclarePayloadSchema = z.object({
  /**
   * Ronda/combate que el cliente cree que está jugando. El servidor rechaza
   * una declaración vieja para que un paquete tardío no contamine la ronda
   * nueva. `combatId` no se usa para permisos ni para localizar el combate.
   */
  round: integer(1, 99_999).optional(),
  combatId: idSchema.optional(),
  /** Selector de unidad enemiga para el DM. El jugador lo ignora. */
  unitId: idSchema.optional(),
  actions: z.array(combatDeclareActionSchema).max(6),
});

export const combatLockPayloadSchema = z.object({
  /** Ronda/combate esperados; un lock viejo se ignora. */
  round: integer(1, 99_999).optional(),
  combatId: idSchema.optional(),
});
export const combatEndPayloadSchema = z.object({});

export type CombatUnitInput = z.infer<typeof combatUnitSchema>;
export type DeclaredActionInput = z.infer<typeof declaredActionSchema>;
export type CombatEventInput = z.infer<typeof combatEventSchema>;
export type CombatStateInput = z.infer<typeof combatStateSchema>;
export type CombatSceneInput = z.infer<typeof combatSceneSchema>;
export type CombatScenePatchInput = z.infer<typeof combatScenePatchSchema>;
export type CombatDeclareAction = z.infer<typeof combatDeclareActionSchema>;
export type CombatDeclarePayload = z.infer<typeof combatDeclarePayloadSchema>;
export type CombatLockPayload = z.infer<typeof combatLockPayloadSchema>;
export type CombatStartPayload = z.infer<typeof combatStartPayloadSchema>;

/* -------------------------------------------------------------------------- */
/* Tipos inferidos (útiles en la API)                                         */
/* -------------------------------------------------------------------------- */

export type RulesetInput = z.infer<typeof rulesetSchema>;
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type CampaignPatchInput = z.infer<typeof campaignPatchSchema>;
export type ItemInput = z.infer<typeof itemInputSchema>;
export type SkillInput = z.infer<typeof skillInputSchema>;
export type EffectInput = z.infer<typeof effectInputSchema>;
export type CharacterInput = z.infer<typeof characterInputSchema>;
export type EncounterInput = z.infer<typeof encounterInputSchema>;
export type SpecialInput = z.infer<typeof specialInputSchema>;

export const CONTENT_TYPES = [
  "items",
  "skills",
  "effects",
  "characters",
  "encounters",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  items: "objeto",
  skills: "skill",
  effects: "efecto",
  characters: "personaje",
  encounters: "encuentro",
};

export const CONTENT_SCHEMAS = {
  items: {
    input: itemInputSchema,
    patch: itemPatchSchema,
    entity: itemSchema,
  },
  skills: {
    input: skillInputSchema,
    patch: skillPatchSchema,
    entity: skillSchema,
  },
  effects: {
    input: effectInputSchema,
    patch: effectPatchSchema,
    entity: effectSchema,
  },
  characters: {
    input: characterInputSchema,
    patch: characterPatchSchema,
    entity: characterSchema,
  },
  encounters: {
    input: encounterInputSchema,
    patch: encounterPatchSchema,
    entity: encounterSchema,
  },
} as const;

export { idSchema, imageSchema, tagsSchema };
