import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureParent } from "./config";

export type AppDatabase = ReturnType<typeof openDatabase>["db"];

const DDL = `
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  rules TEXT NOT NULL,
  settings TEXT NOT NULL,
  extras TEXT NOT NULL DEFAULT '{"shops":[],"dungeons":[]}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  slot TEXT NOT NULL,
  rarity TEXT,
  image TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  image TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS effects (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS encounters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS specials (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  dm_token TEXT NOT NULL,
  status TEXT NOT NULL,
  players TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS combat_states (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  encounter_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  round INTEGER NOT NULL,
  seed TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS combat_events (
  id TEXT PRIMARY KEY,
  combat_id TEXT NOT NULL REFERENCES combat_states(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  round INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  message TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_campaign ON items(campaign_id);
CREATE INDEX IF NOT EXISTS idx_skills_campaign ON skills(campaign_id);
CREATE INDEX IF NOT EXISTS idx_effects_campaign ON effects(campaign_id);
CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_encounters_campaign ON encounters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_specials_campaign ON specials(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
CREATE INDEX IF NOT EXISTS idx_combat_states_campaign ON combat_states(campaign_id);
CREATE INDEX IF NOT EXISTS idx_combat_states_session ON combat_states(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_combat_events_combat_seq ON combat_events(combat_id, seq);
CREATE INDEX IF NOT EXISTS idx_combat_events_combat ON combat_events(combat_id);
`;

export interface OpenDatabaseOptions {
  dbPath: string;
  verbose?: boolean;
}

/**
 * Abre (o crea) la base SQLite, activa WAL + FKs y aplica el DDL idempotente.
 * No usamos drizzle-kit en Fase 1 para que `npm run dev` no necesite pasos
 * manuales; las migraciones reales llegarán cuando el esquema cambie.
 */
export function openDatabase(options: OpenDatabaseOptions) {
  const file = options.dbPath;
  if (file !== ":memory:") ensureParent(file);

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (options.verbose) sqlite.pragma("verbose = 1");
  sqlite.exec(DDL);

  const db = drizzle(sqlite);
  return { sqlite, db };
}

export type DbHandle = ReturnType<typeof openDatabase>;
