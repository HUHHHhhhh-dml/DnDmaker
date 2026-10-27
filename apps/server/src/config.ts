import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = fileURLToPath(new URL("..", import.meta.url));

/** Raíz del repo: apps/server/src -> ../../.. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function dataDir(): string {
  return process.env.PROTOCOL_DATA_DIR ?? join(REPO_ROOT, "data");
}

export function dbPath(): string {
  return process.env.PROTOCOL_DB ?? join(dataDir(), "protocol-life.sqlite");
}

export function uploadsDir(): string {
  const dir = process.env.PROTOCOL_UPLOADS_DIR ?? join(dataDir(), "uploads");
  ensureDir(dir);
  return dir;
}

export function webDistDir(): string {
  return process.env.PROTOCOL_WEB_DIST ?? join(REPO_ROOT, "apps", "web", "dist");
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function ensureParent(file: string): void {
  ensureDir(dirname(file));
}

export function serverSourceDir(): string {
  return serverDir;
}
