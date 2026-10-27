import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Campaign } from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";
import type { CharacterSheet } from "./repository";

/**
 * Test de integración de la Fase 1: CRUD, ficha con stats derivados,
 * persistencia real en SQLite y export/import con remapeo de IDs.
 */

let dir: string;
let dbFile: string;
let built: BuiltApp;
let app: FastifyInstance;
let campaignId: string;

async function openApp(): Promise<FastifyInstance> {
  built = await buildApp({
    dbPath: dbFile,
    uploadsDir: join(dir, "uploads"),
    webDistDir: join(dir, "no-web-dist"),
    seed: false,
  });
  return built.app;
}

async function createCampaign(): Promise<Campaign> {
  const response = await app.inject({
    method: "POST",
    url: "/api/campaigns",
    payload: { name: "Mesa de pruebas", seed: false },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Campaign;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-"));
  dbFile = join(dir, "test.sqlite");
  app = await openApp();
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Fase 1 — API", () => {
  it("responde health", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, app: "PROTOCOL LIFE" });
  });

  it("crea una campaña vacía", async () => {
    const campaign = await createCampaign();
    campaignId = campaign.id;
    expect(campaign.schemaVersion).toBe(1);
    expect(campaign.content.items).toEqual([]);
    expect(campaign.rules.defenseConstant).toBe(100);
    expect(campaign.settings.maxPlayers).toBe(6);
    expect(campaign.settings.baseCharacterImage).toBe("/assets/base-character.png");

    const customImage = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${campaign.id}`,
      payload: { settings: { baseCharacterImage: "/assets/base-character.png" } },
    });
    expect(customImage.statusCode).toBe(200);
    expect(
      (customImage.json() as Campaign).settings.baseCharacterImage,
    ).toBe("/assets/base-character.png");

    const clearedImage = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${campaign.id}`,
      payload: { settings: { baseCharacterImage: "" } },
    });
    expect(clearedImage.statusCode).toBe(200);
    expect((clearedImage.json() as Campaign).settings.baseCharacterImage).toBe("");

    await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${campaign.id}`,
      payload: { settings: { baseCharacterImage: "/assets/base-character.png" } },
    });
  });

  it("crea efecto, objeto, skill y personaje; equipa y deriva stats", async () => {
    const effectResponse = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/effects`,
      payload: {
        name: "Fury",
        maxStacks: 2,
        duration: { type: "turns", default: 2 },
        triggers: [
          {
            when: "roundStart",
            actions: [
              { type: "modifyStat", stat: "atk", mode: "flat", amount: 5, perStack: 2 },
            ],
          },
        ],
        tags: ["buff"],
      },
    });
    expect(effectResponse.statusCode).toBe(201);
    const effect = effectResponse.json() as { id: string };

    const itemResponse = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/items`,
      payload: {
        name: "Filo de prueba",
        code: "TEST-001",
        slot: "hand",
        stats: { hpMax: 5, def: 5, atk: 10 },
        effects: [{ effectId: effect.id, stacks: 2 }],
      },
    });
    expect(itemResponse.statusCode).toBe(201);
    const item = itemResponse.json() as { id: string };

    const skillResponse = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/skills`,
      payload: {
        name: "Corte",
        coins: 2,
        baseClash: 5,
        coinClash: 5,
        baseDamage: 10,
        coinDamage: 5,
      },
    });
    expect(skillResponse.statusCode).toBe(201);
    const skill = skillResponse.json() as { id: string; target: string };
    expect(skill.target).toBe("single");

    const characterResponse = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/characters`,
      payload: {
        name: "Tester",
        kind: "player",
        baseStats: { hpMax: 50, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2 },
        equipment: { horns: null, hand: item.id, armor: null, leg: null, utility: null },
        skills: [skill.id, null, null],
        inventory: [{ itemId: item.id, qty: 1 }],
      },
    });
    expect(characterResponse.statusCode).toBe(201);
    const character = characterResponse.json() as { id: string; skills: string[] };

    const sheetResponse = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/characters/${character.id}/sheet`,
    });
    expect(sheetResponse.statusCode).toBe(200);
    const sheet = sheetResponse.json() as CharacterSheet;
    expect(sheet.derived.stats.hpMax).toBe(55);
    expect(sheet.derived.stats.atk).toBe(19);
    expect(sheet.derived.stats.def).toBe(5);
    expect(
      sheet.derived.equipment.find((entry) => entry.slot === "hand")?.item?.name,
    ).toBe("Filo de prueba");
    expect(sheet.derived.warnings).toEqual([]);

    const campaign = (
      await app.inject({ method: "GET", url: `/api/campaigns/${campaignId}` })
    ).json() as Campaign;
    expect(campaign.content.items).toHaveLength(1);
    expect(campaign.content.skills).toHaveLength(1);
    expect(campaign.content.effects).toHaveLength(1);
    expect(campaign.content.characters).toHaveLength(1);
  });

  it("actualiza un personaje con PATCH y conserva las referencias", async () => {
    const campaign = (
      await app.inject({ method: "GET", url: `/api/campaigns/${campaignId}` })
    ).json() as Campaign;
    const character = campaign.content.characters[0]!;
    const item = campaign.content.items[0]!;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${character.id}`,
      payload: {
        name: "Tester renombrado",
        equipment: {
          horns: null,
          hand: item.id,
          armor: null,
          leg: null,
          utility: null,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const updated = response.json() as {
      name: string;
      equipment: Record<string, string | null>;
      skills: (string | null)[];
    };
    expect(updated.name).toBe("Tester renombrado");
    expect(updated.equipment.hand).toBe(item.id);
    expect(updated.equipment.utility).toBeNull();
    expect(updated.skills[0]).not.toBeNull();
  });

  it("rechaza reglas de campaña incoherentes con 422", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${campaignId}`,
      payload: { rules: { luckFloor: 0.95, luckCap: 0.2 } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("invalid_rules");
  });

  it("rechaza payloads inválidos con 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/items`,
      payload: { name: "", slot: "horns" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_payload");
  });

  it("bloquea el borrado de contenido referenciado", async () => {
    const campaign = (
      await app.inject({ method: "GET", url: `/api/campaigns/${campaignId}` })
    ).json() as Campaign;
    const item = campaign.content.items[0]!;
    const response = await app.inject({
      method: "DELETE",
      url: `/api/content/items/${item.id}`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("content_referenced");
  });

  it("persiste en SQLite al reiniciar el servidor", async () => {
    await app.close();
    app = await openApp();

    const campaign = (
      await app.inject({ method: "GET", url: `/api/campaigns/${campaignId}` })
    ).json() as Campaign;
    expect(campaign.name).toBe("Mesa de pruebas");
    expect(campaign.content.items).toHaveLength(1);
    expect(campaign.content.characters[0]?.name).toBe("Tester renombrado");
  });

  it("exporta e importa la campaña remapeando IDs y referencias", async () => {
    const exportResponse = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/export`,
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers["content-disposition"]).toContain("attachment");
    const exported = JSON.parse(exportResponse.body) as Campaign;

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/campaigns/import",
      payload: exported,
    });
    expect(importResponse.statusCode).toBe(201);
    const imported = importResponse.json() as Campaign;

    expect(imported.id).not.toBe(exported.id);
    expect(imported.content.items).toHaveLength(1);
    expect(imported.content.items[0]!.id).not.toBe(exported.content.items[0]!.id);
    expect(imported.content.characters[0]!.equipment.hand).toBe(
      imported.content.items[0]!.id,
    );
    expect(imported.content.characters[0]!.skills[0]).toBe(
      imported.content.skills[0]!.id,
    );

    const sheetResponse = await app.inject({
      method: "GET",
      url: `/api/campaigns/${imported.id}/characters/${imported.content.characters[0]!.id}/sheet`,
    });
    expect(sheetResponse.statusCode).toBe(200);
    const sheet = sheetResponse.json() as CharacterSheet;
    expect(sheet.derived.stats.hpMax).toBe(55);
    expect(sheet.derived.warnings).toEqual([]);
  });

  it("crea la campaña semilla al arrancar una base vacía", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "protocol-life-seed-"));
    const other = await buildApp({
      dbPath: join(otherDir, "seed.sqlite"),
      uploadsDir: join(otherDir, "uploads"),
      webDistDir: join(otherDir, "no-web-dist"),
      seed: true,
    });
    try {
      const campaigns = (
        await other.app.inject({ method: "GET", url: "/api/campaigns" })
      ).json() as Array<{ name: string; counts: Record<string, number> }>;
      expect(campaigns).toHaveLength(1);
      expect(campaigns[0]?.name).toBe("Campaña de prueba");
      expect(campaigns[0]?.counts.items).toBe(7);
      expect(campaigns[0]?.counts.effects).toBe(4);
      expect(campaigns[0]?.counts.characters).toBe(4);
      expect(campaigns[0]?.counts.encounters).toBe(1);
    } finally {
      await other.app.close();
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});
