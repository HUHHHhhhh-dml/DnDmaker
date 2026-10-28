import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Character, Encounter, Item } from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";
import {
  acquireServerLock,
  applyRetention,
  backupStamp,
  createBackup,
  ensureDailyBackup,
  listBackups,
  releaseServerLock,
  restoreDatabase,
  retentionFromEnv,
  serverLockPath,
  validateBackupFile,
} from "./backup";

/**
 * Fase 4D — backup y restore sobre SQLite temporal.
 *
 * Nunca se toca `data/protocol-life.sqlite`: cada test usa `mkdtemp` y pasa
 * rutas explícitas al módulo.
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-backup-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface SeededDb {
  dbFile: string;
  backups: string;
  campaignId: string;
  campaignName: string;
  combatId: string;
}

async function makeSeededDb(label: string): Promise<SeededDb> {
  const base = join(dir, label);
  const dbFile = join(base, "app.sqlite");
  const backups = join(base, "backups");
  const built: BuiltApp = await buildApp({
    dbPath: dbFile,
    uploadsDir: join(base, "uploads"),
    webDistDir: join(base, "no-web-dist"),
    seed: false,
  });
  const app = built.app;

  try {
    const campaign = built.repository.createCampaign({
      name: `Campaña ${label}`,
      seed: false,
    });
    const campaignId = campaign.id;

    const item = built.repository.createContent("items", campaignId, {
      name: "Objeto de backup",
      slot: "utility",
      unlocked: true,
    }) as Item;

    const player = built.repository.createContent("characters", campaignId, {
      name: "Jugadora de backup",
      kind: "player",
      baseStats: { hpMax: 50, def: 0, atk: 10, spd: 10, luck: 0, skillSlots: 2 },
      equipment: {
        horns: null,
        hand: null,
        armor: null,
        leg: null,
        utility: null,
      },
      skills: [null, null, null],
      inventory: [{ itemId: item.id, qty: 1 }],
    }) as Character;
    const enemy = built.repository.createContent("characters", campaignId, {
      name: "Enemigo de backup",
      kind: "enemy",
      baseStats: { hpMax: 10, def: 0, atk: 1, spd: 1, luck: 0, skillSlots: 2 },
      equipment: {
        horns: null,
        hand: null,
        armor: null,
        leg: null,
        utility: null,
      },
      skills: [null, null, null],
      inventory: [],
    }) as Character;
    const encounter = built.repository.createContent(
      "encounters",
      campaignId,
      {
        name: "Encuentro de backup",
        enemies: [{ characterId: enemy.id }],
      },
    ) as Encounter;

    const hosted = built.sessions.host(campaignId);
    const joined = built.sessions.join(hosted.session.code, {
      name: "Ana",
      characterId: player.id,
    });
    built.sessions.markPlayerConnected(
      hosted.session.code,
      joined.player.id,
      true,
    );
    const combat = built.combat.startEncounter(
      campaignId,
      encounter.id,
      hosted.session.id,
      { seed: "seed-backup", speedRoll: false },
    );

    return {
      dbFile,
      backups,
      campaignId,
      campaignName: campaign.name,
      combatId: combat.id,
    };
  } finally {
    await app.close();
  }
}

function dayDate(day: number, hour = 10): Date {
  return new Date(2026, 0, day, hour, 0, 0);
}

describe("Fase 4D — creación y retención de copias", () => {
  it("crea una copia consistente y la lista", async () => {
    const seeded = await makeSeededDb("create");
    const backup = await createBackup({
      dbPath: seeded.dbFile,
      backupsDir: seeded.backups,
      now: new Date(2026, 0, 2, 3, 4, 5),
    });

    expect(existsSync(backup.path)).toBe(true);
    expect(backup.filename).toBe("protocol-life-20260102-030405.sqlite");
    expect(backup.size).toBeGreaterThan(0);
    expect(backupStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");

    const list = await listBackups(seeded.backups);
    expect(list.map((entry) => entry.filename)).toEqual([backup.filename]);

    // La copia abre y conserva campaña, contenido y combate.
    validateBackupFile(backup.path);
    const copied = new Database(backup.path, { readonly: true });
    try {
      const campaign = copied
        .prepare("SELECT name FROM campaigns WHERE id = ?")
        .get(seeded.campaignId) as { name: string } | undefined;
      expect(campaign?.name).toBe(seeded.campaignName);
      const combat = copied
        .prepare("SELECT id FROM combat_states WHERE id = ?")
        .get(seeded.combatId) as { id: string } | undefined;
      expect(combat?.id).toBe(seeded.combatId);
    } finally {
      copied.close();
    }
  });

  it("copia con el servidor abierto y WAL activo", async () => {
    const base = join(dir, "online");
    const dbFile = join(base, "app.sqlite");
    const backups = join(base, "backups");
    const built = await buildApp({
      dbPath: dbFile,
      uploadsDir: join(base, "uploads"),
      webDistDir: join(base, "no-web-dist"),
      seed: false,
    });
    try {
      const campaign = built.repository.createCampaign({
        name: "Campaña online",
        seed: false,
      });
      const backup = await createBackup({
        dbPath: dbFile,
        backupsDir: backups,
        now: dayDate(5),
      });
      validateBackupFile(backup.path);
      const copied = new Database(backup.path, { readonly: true });
      try {
        const row = copied
          .prepare("SELECT name FROM campaigns WHERE id = ?")
          .get(campaign.id) as { name: string } | undefined;
        expect(row?.name).toBe("Campaña online");
      } finally {
        copied.close();
      }
    } finally {
      await built.app.close();
    }
  });

  it("aplica la retención dejando las copias más nuevas", async () => {
    const seeded = await makeSeededDb("retention");
    for (let index = 1; index <= 5; index += 1) {
      await createBackup({
        dbPath: seeded.dbFile,
        backupsDir: seeded.backups,
        now: dayDate(index),
        retention: 2,
      });
    }
    const list = await listBackups(seeded.backups);
    expect(list).toHaveLength(2);
    expect(list[0]?.filename).toContain("20260105");
    expect(list[1]?.filename).toContain("20260104");

    // La poda manual es idempotente.
    const removed = await applyRetention(seeded.backups, 2);
    expect(removed).toEqual([]);
  });

  it("la copia diaria no se duplica el mismo día y sí al siguiente", async () => {
    const seeded = await makeSeededDb("daily");
    const first = await ensureDailyBackup({
      dbPath: seeded.dbFile,
      backupsDir: seeded.backups,
      now: dayDate(10),
      retention: 10,
    });
    expect(first.created).toBe(true);
    expect(first.backup).not.toBeNull();

    const sameDay = await ensureDailyBackup({
      dbPath: seeded.dbFile,
      backupsDir: seeded.backups,
      now: dayDate(10, 22),
      retention: 10,
    });
    expect(sameDay.created).toBe(false);
    expect(await listBackups(seeded.backups)).toHaveLength(1);

    const nextDay = await ensureDailyBackup({
      dbPath: seeded.dbFile,
      backupsDir: seeded.backups,
      now: dayDate(11),
      retention: 10,
    });
    expect(nextDay.created).toBe(true);
    expect(await listBackups(seeded.backups)).toHaveLength(2);
  });

  it("lee la retención del entorno con default seguro", () => {
    const previous = process.env.PROTOCOL_BACKUP_RETENTION;
    try {
      delete process.env.PROTOCOL_BACKUP_RETENTION;
      expect(retentionFromEnv()).toBe(7);
      process.env.PROTOCOL_BACKUP_RETENTION = "3";
      expect(retentionFromEnv()).toBe(3);
      process.env.PROTOCOL_BACKUP_RETENTION = "0";
      expect(retentionFromEnv()).toBe(7);
      process.env.PROTOCOL_BACKUP_RETENTION = "no";
      expect(retentionFromEnv()).toBe(7);
    } finally {
      if (previous === undefined) delete process.env.PROTOCOL_BACKUP_RETENTION;
      else process.env.PROTOCOL_BACKUP_RETENTION = previous;
    }
  });
});

describe("Fase 4D — restauración segura", () => {
  it("restaura en una base nueva y conserva campaña y combate", async () => {
    const seeded = await makeSeededDb("restore-new");
    const backup = await createBackup({
      dbPath: seeded.dbFile,
      backupsDir: seeded.backups,
      now: dayDate(20),
    });
    const target = join(dir, "restore-new", "restored.sqlite");

    const result = await restoreDatabase({
      backupPath: backup.path,
      dbPath: target,
      backupsDir: seeded.backups,
      now: dayDate(21),
    });
    expect(result.targetPath).toBe(target);
    expect(result.safetyBackup).toBeNull();

    const restored = await buildApp({
      dbPath: target,
      uploadsDir: join(dir, "restore-new", "uploads"),
      webDistDir: join(dir, "restore-new", "no-web-dist"),
      seed: false,
    });
    try {
      const campaign = restored.repository.getCampaign(seeded.campaignId);
      expect(campaign.name).toBe(seeded.campaignName);
      expect(campaign.content.items).toHaveLength(1);
      const combat = restored.combatStore.get(seeded.combatId);
      expect(combat?.state.id).toBe(seeded.combatId);
    } finally {
      await restored.app.close();
    }
  });

  it("hace una copia de seguridad de la base actual antes de restaurar", async () => {
    const seeded = await makeSeededDb("restore-safety");
    const backup = await createBackup({
      dbPath: seeded.dbFile,
      backupsDir: seeded.backups,
      now: dayDate(22),
    });
    const target = join(dir, "restore-safety", "target.sqlite");
    await copyFile(seeded.dbFile, target);

    const result = await restoreDatabase({
      backupPath: backup.path,
      dbPath: target,
      backupsDir: seeded.backups,
      now: dayDate(23),
    });
    expect(result.safetyBackup).not.toBeNull();
    expect(result.safetyBackup?.filename).toContain("pre-restore-");
    expect(existsSync(result.safetyBackup?.path ?? "")).toBe(true);
  });

  it("un archivo inválido o ausente no destruye la base actual", async () => {
    const seeded = await makeSeededDb("restore-invalid");
    const target = join(dir, "restore-invalid", "target.sqlite");
    await copyFile(seeded.dbFile, target);
    const before = await readFile(target);

    const invalid = join(dir, "restore-invalid", "no-es-sqlite.sqlite");
    await writeFile(invalid, "esto no es una base de datos", "utf8");

    await expect(
      restoreDatabase({
        backupPath: invalid,
        dbPath: target,
        backupsDir: seeded.backups,
      }),
    ).rejects.toThrow(/SQLite válido|integridad|campaigns/i);

    await expect(
      restoreDatabase({
        backupPath: join(dir, "restore-invalid", "no-existe.sqlite"),
        dbPath: target,
        backupsDir: seeded.backups,
      }),
    ).rejects.toThrow(/No existe la copia/);

    expect(await readFile(target)).toEqual(before);
    validateBackupFile(target);
  });

  it("exige el servidor parado y retira un lock obsoleto", async () => {
    const seeded = await makeSeededDb("restore-lock");
    const backup = await createBackup({
      dbPath: seeded.dbFile,
      backupsDir: seeded.backups,
      now: dayDate(24),
    });
    const target = join(dir, "restore-lock", "target.sqlite");
    await copyFile(seeded.dbFile, target);

    acquireServerLock(target, process.pid);
    try {
      await expect(
        restoreDatabase({
          backupPath: backup.path,
          dbPath: target,
          backupsDir: seeded.backups,
        }),
      ).rejects.toThrow(/servidor sigue en marcha/i);
    } finally {
      releaseServerLock(target, process.pid);
    }
    expect(existsSync(serverLockPath(target))).toBe(false);

    // Un lock de un PID muerto se considera obsoleto y no bloquea el restore.
    acquireServerLock(target, 999_999);
    const result = await restoreDatabase({
      backupPath: backup.path,
      dbPath: target,
      backupsDir: seeded.backups,
      now: dayDate(25),
    });
    expect(result.targetPath).toBe(target);
    expect(existsSync(serverLockPath(target))).toBe(false);
  });
});
