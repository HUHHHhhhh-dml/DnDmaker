import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  copyFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { dataDir, dbPath as defaultDbPath, ensureDir } from "./config";

/**
 * Copias de seguridad y restauración del SQLite (Fase 4D).
 *
 * - Las copias se hacen con `Database#backup`, que produce un snapshot
 *   consistente incluso con el servidor en marcha y WAL activo.
 * - La restauración exige el servidor parado (lock file con PID), valida la
 *   copia y guarda antes una copia de seguridad de la base actual.
 * - Nunca se restaura desde HTTP: solo por CLI.
 *
 * Las imágenes de `data/uploads/` no viven en el SQLite: hay que copiarlas
 * aparte (se documenta en el README).
 */

export const DEFAULT_RETENTION = 7;
export const DEFAULT_PREFIX = "protocol-life-";
export const PRE_RESTORE_PREFIX = "pre-restore-";

export interface BackupInfo {
  path: string;
  filename: string;
  size: number;
  createdAt: string;
}

export interface ServerLockInfo {
  pid: number;
  startedAt: string;
}

export interface RestoreResult {
  backupPath: string;
  targetPath: string;
  safetyBackup: BackupInfo | null;
}

export interface CreateBackupOptions {
  dbPath?: string;
  backupsDir?: string;
  now?: Date;
  /** Copias diarias a conservar. Default: env o 7. */
  retention?: number;
  /** `false` para copias de seguridad puntuales que no aplican retención. */
  prune?: boolean;
  prefix?: string;
}

export interface RestoreOptions {
  backupPath: string;
  dbPath?: string;
  backupsDir?: string;
  now?: Date;
}

const nowIso = (): string => new Date().toISOString();

/** Carpeta de copias: `PROTOCOL_BACKUPS_DIR` o `data/backups`. */
export function backupsDir(): string {
  return process.env.PROTOCOL_BACKUPS_DIR ?? join(dataDir(), "backups");
}

/** Retención configurable por entorno, con default 7 y mínimo 1. */
export function retentionFromEnv(): number {
  const raw = Number(process.env.PROTOCOL_BACKUP_RETENTION ?? "");
  if (!Number.isFinite(raw)) return DEFAULT_RETENTION;
  const value = Math.floor(raw);
  return value >= 1 ? value : DEFAULT_RETENTION;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Marca local `YYYYMMDD-HHmmss`, pensada para ordenar por nombre. */
export function backupStamp(now: Date): string {
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("") + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function dayStamp(now: Date): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

async function uniquePath(
  dir: string,
  prefix: string,
  now: Date,
): Promise<string> {
  const base = `${prefix}${backupStamp(now)}`;
  let candidate = join(dir, `${base}.sqlite`);
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}-${suffix}.sqlite`);
    suffix += 1;
  }
  return candidate;
}

async function describeBackup(path: string): Promise<BackupInfo> {
  const info = await stat(path);
  return {
    path,
    filename: basename(path),
    size: info.size,
    createdAt: info.mtime.toISOString(),
  };
}

/** Lista las copias `.sqlite` de la carpeta, de más nueva a más antigua. */
export async function listBackups(dir = backupsDir()): Promise<BackupInfo[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const files: BackupInfo[] = [];
  for (const name of entries) {
    if (!name.endsWith(".sqlite")) continue;
    const path = join(dir, name);
    try {
      const info = await describeBackup(path);
      files.push(info);
    } catch {
      // Un archivo borrado entre readdir y stat no debe romper el listado.
    }
  }
  return files.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) ||
    b.filename.localeCompare(a.filename),
  );
}

/** Borra las copias más antiguas dejando `retention` (mínimo 1). */
export async function applyRetention(
  dir = backupsDir(),
  retention = retentionFromEnv(),
): Promise<BackupInfo[]> {
  const keep = Math.max(1, Math.floor(retention));
  const backups = await listBackups(dir);
  const removed = backups.slice(keep);
  for (const entry of removed) {
    await rm(entry.path, { force: true });
  }
  return removed;
}

/**
 * Crea una copia consistente. `Database#backup` funciona con el servidor
 * abierto y con WAL, así que no hace falta parar la mesa para el backup.
 */
export async function createBackup(
  options: CreateBackupOptions = {},
): Promise<BackupInfo> {
  const source = resolve(options.dbPath ?? defaultDbPath());
  if (!existsSync(source)) {
    throw new Error(`No existe la base de datos que quieres copiar: ${source}`);
  }

  const dir = resolve(options.backupsDir ?? backupsDir());
  ensureDir(dir);
  const now = options.now ?? new Date();
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const destination = await uniquePath(dir, prefix, now);

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }

  const info = await describeBackup(destination);
  if (options.prune !== false) {
    await applyRetention(dir, options.retention ?? retentionFromEnv());
  }
  return info;
}

/** Copia diaria: no duplica si ya hay una del mismo día local. */
export async function ensureDailyBackup(
  options: CreateBackupOptions = {},
): Promise<{ created: boolean; backup: BackupInfo | null }> {
  const dir = resolve(options.backupsDir ?? backupsDir());
  const now = options.now ?? new Date();
  const day = dayStamp(now);
  const existing = (await listBackups(dir)).some((entry) =>
    entry.filename.startsWith(`${DEFAULT_PREFIX}${day}-`),
  );
  if (existing) return { created: false, backup: null };
  return {
    created: true,
    backup: await createBackup({ ...options, now }),
  };
}

/**
 * Arranca el chequeo periódico de copia diaria. Se llama desde `index.ts`
 * (nunca en `buildApp`, para que los tests no escriban backups).
 */
export function startAutoBackup(
  options: CreateBackupOptions & { intervalMs?: number } = {},
): { stop: () => void } {
  const interval = options.intervalMs ?? 6 * 60 * 60 * 1000;
  let stopped = false;
  let running = false;

  const run = (): void => {
    if (stopped || running) return;
    running = true;
    void ensureDailyBackup(options)
      .then((result) => {
        if (result.backup) {
          // eslint-disable-next-line no-console
          console.log(`[backup] Copia diaria creada: ${result.backup.path}`);
        }
      })
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[backup] No se pudo crear la copia diaria: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      })
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, interval);
  timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Restore                                                                    */
/* -------------------------------------------------------------------------- */

export function serverLockPath(dbFile = defaultDbPath()): string {
  return `${resolve(dbFile)}.lock`;
}

export function readServerLock(
  dbFile = defaultDbPath(),
): ServerLockInfo | null {
  const path = serverLockPath(dbFile);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ServerLockInfo>;
    if (typeof parsed.pid !== "number") return null;
    return {
      pid: parsed.pid,
      startedAt:
        typeof parsed.startedAt === "string" ? parsed.startedAt : nowIso(),
    };
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Crea (o reclama) el lock del servidor. Si otro proceso vivo lo tiene,
 * lanza un error para no arrancar dos servidores sobre la misma base.
 */
export function acquireServerLock(
  dbFile = defaultDbPath(),
  pid = process.pid,
): ServerLockInfo {
  const existing = readServerLock(dbFile);
  if (existing && existing.pid !== pid && isProcessAlive(existing.pid)) {
    throw new Error(
      `Ya hay un servidor usando ${dbFile} (PID ${existing.pid}). ` +
        "Páralo antes de arrancar otro.",
    );
  }
  const info: ServerLockInfo = { pid, startedAt: nowIso() };
  ensureDir(dirname(resolve(dbFile)));
  writeFileSync(serverLockPath(dbFile), JSON.stringify(info), "utf8");
  return info;
}

/** Libera el lock solo si pertenece a este PID (o si no hay lock). */
export function releaseServerLock(
  dbFile = defaultDbPath(),
  pid = process.pid,
): void {
  const existing = readServerLock(dbFile);
  if (existing && existing.pid !== pid) return;
  rmSync(serverLockPath(dbFile), { force: true });
}

/**
 * Comprueba que no haya un servidor vivo sobre la base. Un lock de un PID
 * muerto se considera obsoleto y se retira.
 */
export function assertServerStopped(dbFile = defaultDbPath()): void {
  const existing = readServerLock(dbFile);
  if (!existing) return;
  if (existing.pid === process.pid || isProcessAlive(existing.pid)) {
    throw new Error(
      `El servidor sigue en marcha (PID ${existing.pid}). ` +
        "Páralo antes de restaurar una copia.",
    );
  }
  rmSync(serverLockPath(dbFile), { force: true });
}

/** Valida que el archivo sea un SQLite íntegro con la tabla `campaigns`. */
export function validateBackupFile(path: string): void {
  const file = resolve(path);
  if (!existsSync(file)) {
    throw new Error(`No existe la copia que quieres restaurar: ${file}`);
  }

  let db: Database.Database;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    throw new Error(`La copia no es un SQLite válido: ${file}`);
  }
  try {
    let integrity: unknown;
    try {
      integrity = db.pragma("integrity_check", { simple: true });
    } catch {
      throw new Error(`La copia no es un SQLite válido: ${file}`);
    }
    if (integrity !== "ok") {
      throw new Error("La copia no pasa la comprobación de integridad de SQLite.");
    }
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const tables = new Set(rows.map((row) => row.name));
    if (!tables.has("campaigns")) {
      throw new Error(
        "La copia no parece una base de PROTOCOL DND (falta la tabla campaigns).",
      );
    }
  } finally {
    db.close();
  }
}

/**
 * Restaura una copia sobre `dbPath`. Valida antes de tocar nada y guarda una
 * copia `pre-restore-*` de la base actual. Exige que el servidor esté parado.
 */
export async function restoreDatabase(
  options: RestoreOptions,
): Promise<RestoreResult> {
  const backupPath = resolve(options.backupPath);
  const target = resolve(options.dbPath ?? defaultDbPath());
  if (backupPath === target) {
    throw new Error("La copia y la base de datos son el mismo archivo.");
  }

  assertServerStopped(target);
  validateBackupFile(backupPath);

  const dir = resolve(options.backupsDir ?? backupsDir());
  let safetyBackup: BackupInfo | null = null;
  if (existsSync(target)) {
    safetyBackup = await createBackup({
      dbPath: target,
      backupsDir: dir,
      now: options.now,
      prefix: PRE_RESTORE_PREFIX,
      prune: false,
    });
  }

  // El servidor está parado: los WAL/SHM viejos no deben acompañar a la copia
  // nueva (SQLite podría intentar aplicarlos contra otro archivo).
  ensureDir(dirname(target));
  await rm(`${target}-wal`, { force: true });
  await rm(`${target}-shm`, { force: true });
  await rm(`${target}-journal`, { force: true });

  const temp = `${target}.restore-${process.pid}-${Date.now()}.tmp`;
  try {
    await copyFile(backupPath, temp);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }

  return {
    backupPath,
    targetPath: target,
    safetyBackup,
  };
}
