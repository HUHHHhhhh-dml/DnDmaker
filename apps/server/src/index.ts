import { buildApp } from "./app";
import {
  acquireServerLock,
  releaseServerLock,
  startAutoBackup,
} from "./backup";
import { dbPath } from "./config";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const dbFile = dbPath();

/** Espera breve si otro proceso está cerrando (p. ej. `tsx watch` reinicia). */
async function acquireLockWithRetry(): Promise<void> {
  const attempts = 10;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      acquireServerLock(dbFile);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
    }
  }
}

let built: Awaited<ReturnType<typeof buildApp>> | null = null;
let autoBackup: { stop: () => void } | null = null;
let shuttingDown = false;

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  autoBackup?.stop();
  try {
    await built?.app.close();
  } finally {
    releaseServerLock(dbFile);
    process.exit(code);
  }
}

try {
  await acquireLockWithRetry();
  built = await buildApp({ logger: true });
  await built.app.listen({ port, host });
  built.app.log.info(`PROTOCOL DND server listo en http://${host}:${port}`);
  // Copia diaria en `data/backups/`; no bloquea el arranque ni la mesa.
  autoBackup = startAutoBackup({ dbPath: dbFile });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  built?.app.log.error(error);
  console.error(`[server] No se pudo arrancar: ${message}`);
  await shutdown(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(0);
  });
}
