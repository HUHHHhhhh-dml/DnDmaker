import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type {
  CampaignSettings,
  Character,
  EffectDefinition,
  Encounter,
  Item,
  Ruleset,
  Skill,
} from "@protocol-life/shared";

/**
 * Esquema SQLite. Las entidades de contenido guardan el JSON validado en
 * `data` y espejan los campos útiles para listar/filtrar (name, slot...).
 * Las tiendas y mazmorras viven en `campaigns.extras` (modelo sin UI aún).
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
    .$type<{ shops: unknown[]; dungeons: unknown[] }>()
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

export const CONTENT_TABLES = {
  items,
  skills,
  effects,
  characters,
  encounters,
} as const;
