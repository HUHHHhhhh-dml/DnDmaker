import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  CampaignSettings,
  CampaignWallet,
  Character,
  CombatEvent,
  CombatState,
  Dungeon,
  EffectDefinition,
  Encounter,
  Item,
  LootDraft,
  Ruleset,
  Session,
  Shop,
  Skill,
} from "@protocol-life/shared";

/**
 * Esquema SQLite. Las entidades de contenido guardan el JSON validado en
 * `data` y espejan los campos útiles para listar/filtrar (name, slot...).
 * Las tiendas, mazmorras y la bolsa de party viven en `campaigns.extras`
 * para no migrar columnas (Fase 4).
 */

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  schemaVersion: integer("schema_version").notNull().default(1),
  rules: text("rules", { mode: "json" }).$type<Ruleset>().notNull(),
  settings: text("settings", { mode: "json" })
    .$type<CampaignSettings>()
    .notNull(),
  extras: text("extras", { mode: "json" })
    .$type<{
      shops: Shop[];
      dungeons: Dungeon[];
      /** Ausente en campañas anteriores a Fase 4. */
      wallet?: CampaignWallet;
    }>()
    .notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  slot: text("slot").notNull(),
  rarity: text("rarity"),
  image: text("image"),
  data: text("data", { mode: "json" }).$type<Item>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  image: text("image"),
  data: text("data", { mode: "json" }).$type<Skill>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const effects = sqliteTable("effects", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  data: text("data", { mode: "json" }).$type<EffectDefinition>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  data: text("data", { mode: "json" }).$type<Character>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const encounters = sqliteTable("encounters", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  data: text("data", { mode: "json" }).$type<Encounter>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Habilidades especiales (dominios y hábitats). */
export const specials = sqliteTable("specials", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Sala en vivo (Fase 2). Una sesión activa por campaña. */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .unique()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  dmToken: text("dm_token").notNull(),
  status: text("status")
    .$type<Session["status"]>()
    .notNull()
    .default("lobby"),
  players: text("players", { mode: "json" })
    .$type<Session["players"]>()
    .notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Estado de combate persistido como JSON validado (Fase 3). El estado es la
 * fuente de verdad del motor; las columnas espejo permiten listar/filtrar.
 */
export const combatStates = sqliteTable(
  "combat_states",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    encounterId: text("encounter_id").notNull(),
    phase: text("phase").$type<CombatState["phase"]>().notNull(),
    round: integer("round").notNull(),
    seed: text("seed").notNull(),
    state: text("state", { mode: "json" }).$type<CombatState>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_combat_states_campaign").on(table.campaignId),
    index("idx_combat_states_session").on(table.sessionId),
  ],
);

/** Log append-only del combate. Cada fila es un evento ya aplicado. */
export const combatEvents = sqliteTable(
  "combat_events",
  {
    id: text("id").primaryKey(),
    combatId: text("combat_id")
      .notNull()
      .references(() => combatStates.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    round: integer("round").notNull(),
    type: text("type").$type<CombatEvent["type"]>().notNull(),
    actorId: text("actor_id"),
    targetId: text("target_id"),
    message: text("message").notNull(),
    data: text("data", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_combat_events_combat_seq").on(table.combatId, table.seq),
    index("idx_combat_events_combat").on(table.combatId),
  ],
);

/**
 * Tienda abierta en una sesión (Fase 4A-3). Una fila por sesión: el DM la
 * abre y la cierra; la escena se reconstruye desde el contenido de campaña.
 */
export const activeShops = sqliteTable("active_shops", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  shopId: text("shop_id").notNull(),
  openedAt: text("opened_at").notNull(),
});

/**
 * Reparto de botín por turnos (Fase 4A-2). Una fila por reparto; el índice
 * único parcial de la DDL garantiza un solo reparto activo por sesión.
 */
export const lootDrafts = sqliteTable(
  "loot_drafts",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    combatId: text("combat_id"),
    encounterId: text("encounter_id").notNull(),
    status: text("status").$type<LootDraft["status"]>().notNull(),
    state: text("state", { mode: "json" }).$type<LootDraft>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_loot_drafts_session").on(table.sessionId),
  ],
);

export const CONTENT_TABLES = {
  items,
  skills,
  effects,
  characters,
  encounters,
} as const;
