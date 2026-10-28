import { dbPath } from "./config";
import {
  backupsDir,
  createBackup,
  listBackups,
  retentionFromEnv,
} from "./backup";

/**
 * `npm run backup` — copia manual del SQLite.
 *
 * Uso:
 *   npm run backup
 *   npm run backup -- --keep 14
 *   npm run backup -- --db ./data/protocol-life.sqlite --dir ./data/backups
 *
 * No hace falta parar el servidor: `Database#backup` toma un snapshot
 * consistente aunque la mesa esté en vivo.
 */

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Falta el valor de ${name}.`);
  }
  args.splice(index, 2);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Uso: npm run backup -- [--keep N] [--db ruta.sqlite] [--dir carpeta]",
    );
    return;
  }

  const keep = takeOption(args, "--keep");
  const db = takeOption(args, "--db") ?? dbPath();
  const dir = takeOption(args, "--dir") ?? backupsDir();
  if (args.length > 0) {
    throw new Error(`Argumentos no reconocidos: ${args.join(" ")}`);
  }

  const retention = keep ? Number(keep) : retentionFromEnv();
  if (!Number.isInteger(retention) || retention < 1) {
    throw new Error("--keep debe ser un entero mayor o igual que 1.");
  }

  const backup = await createBackup({
    dbPath: db,
    backupsDir: dir,
    retention,
  });
  const total = (await listBackups(dir)).length;
  console.log(`Copia creada: ${backup.path}`);
  console.log(
    `Tamaño: ${(backup.size / 1024).toFixed(1)} KiB · copias conservadas: ${total}/${retention}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `[backup] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
