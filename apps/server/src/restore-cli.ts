import { dbPath } from "./config";
import { backupsDir, listBackups, restoreDatabase } from "./backup";

/**
 * `npm run restore -- <archivo>` — restaura una copia del SQLite.
 *
 * Exige el servidor parado (lock file del servidor). Antes de sustituir la
 * base actual guarda una copia `pre-restore-*` en la carpeta de backups.
 *
 * Uso:
 *   npm run restore -- ./data/backups/protocol-life-20260102-030405.sqlite
 *   npm run restore -- <archivo> --db ./data/protocol-life.sqlite --dir ./data/backups
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
      "Uso: npm run restore -- <archivo.sqlite> [--db ruta.sqlite] [--dir carpeta]",
    );
    return;
  }

  const db = takeOption(args, "--db") ?? dbPath();
  const dir = takeOption(args, "--dir") ?? backupsDir();
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) {
    throw new Error(
      "Indica la copia a restaurar: npm run restore -- <archivo.sqlite>",
    );
  }

  const result = await restoreDatabase({
    backupPath: file,
    dbPath: db,
    backupsDir: dir,
  });

  console.log(`Copia restaurada: ${result.backupPath}`);
  console.log(`Base de datos: ${result.targetPath}`);
  if (result.safetyBackup) {
    console.log(`Copia de seguridad previa: ${result.safetyBackup.path}`);
  } else {
    console.log("No había base de datos previa: se ha restaurado como nueva.");
  }
  const total = (await listBackups(dir)).length;
  console.log(`Copias en ${dir}: ${total}`);
  console.log("Arranca el servidor para comprobar la campaña restaurada.");
}

main().catch((error: unknown) => {
  console.error(
    `[restore] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
