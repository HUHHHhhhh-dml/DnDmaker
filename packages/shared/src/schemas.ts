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
      value.startsWith("/uploads/") ||
      /^https?:\/\//i.test(value) ||
      value.startsWith("data:image/"),
    "Usa una URL http(s), un archivo subido (/uploads/...) o déjalo vacío",
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

export const characterKindSchema = z.enum(["player", "npc", "enemy"]);

export const effectTriggerSchema = z.enum([
  "roundStart",
  "roundEnd",
  "onUseSkill",
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
  image: imageSchema.optional(),
  icon: imageSchema.optional(),
  stats: partialStatsSchema.optional(),
  effects: z.array(itemEffectRefSchema).max(10).optional(),
  uses: integer(0, 99).optional(),
  useEffect: z.array(effectActionSchema).max(20).optional(),
  tags: tagsSchema.optional(),
  price: integer(0, 9_999_999).optional(),
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
  coins: integer(1, 20),
  baseClash: integer(-9999, 9999),
  coinClash: integer(-9999, 9999),
  baseDamage: integer(-9999, 9999),
  coinDamage: integer(-9999, 9999),
  fullHeadsMultiplier: z.number().min(1).max(10).optional(),
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
  baseStats: characterStatsSchema,
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

const encounterEnemySchema = z.object({
  characterId: idSchema,
  count: integer(1, 20).optional(),
  overrides: characterInputSchema.partial().optional(),
});

const encounterRewardsSchema = z.object({
  itemIds: z.array(idSchema).max(100).optional(),
  currency: integer(0, 9_999_999).optional(),
  notes: z.string().max(2000).optional(),
});

const encounterFields = {
  name: nameSchema,
  description: descriptionSchema.optional(),
  background: imageSchema.optional(),
  enemies: z.array(encounterEnemySchema).max(50),
  rewards: encounterRewardsSchema.optional(),
  victory: z.string().max(2000).optional(),
  defeat: z.string().max(2000).optional(),
};

export const encounterInputSchema = z.object(encounterFields);
export const encounterSchema = encounterInputSchema.extend({ id: idSchema });
export const encounterPatchSchema = encounterInputSchema.partial();

/* -------------------------------------------------------------------------- */
/* Tiendas y mazmorras (modelo, sin UI en Fase 1)                             */
/* -------------------------------------------------------------------------- */

export const shopSchema = z.object({
  id: idSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  currency: z.string().max(40).optional(),
  items: z.array(
    z.object({
      itemId: idSchema,
      price: integer(0, 9_999_999),
      stock: integer(0, 9999).optional(),
    }),
  ),
});

export const dungeonSchema = z.object({
  id: idSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  entryRoomId: idSchema.optional(),
  rooms: z.array(
    z.object({
      id: idSchema,
      name: nameSchema,
      encounterId: idSchema.optional(),
      notes: z.string().max(2000).optional(),
    }),
  ),
});

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

export const campaignSettingsSchema = z.object({
  maxPlayers: integer(1, 6),
  allowPlayerEdit: z.boolean(),
  allowPlayerEditDuringCombat: z.boolean(),
  requirePin: z.boolean().optional(),
  pin: z.string().max(12).optional(),
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
