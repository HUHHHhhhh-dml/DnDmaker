import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  Character,
  Dungeon,
  DungeonRoom,
  Encounter,
  HostSessionResponse,
  Item,
  JoinSessionResponse,
  Skill,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";

/**
 * Fase 4B — CRUD y editor de mazmorras lineales.
 *
 * SQLite temporal (`mkdtemp`), servicio y rutas HTTP reales. No se toca
 * `data/protocol-life.sqlite`. El recorrido (run) es 4C y no se prueba aquí.
 */

let dir: string;
let built: BuiltApp;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-dungeon-"));
  built = await buildApp({
    dbPath: join(dir, "dungeon.sqlite"),
    uploadsDir: join(dir, "uploads"),
    webDistDir: join(dir, "no-web-dist"),
    seed: false,
  });
  app = built.app;
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface Fixture {
  campaignId: string;
  dmToken: string;
  sessionCode: string;
  sessionId: string;
  playerToken: string;
  encounterA: Encounter;
  encounterB: Encounter;
  itemA: Item;
  itemB: Item;
}

async function makeFixture(): Promise<Fixture> {
  const campaign = built.repository.createCampaign({
    name: "Mazmorras de prueba",
    seed: false,
  });
  const campaignId = campaign.id;

  const itemA = built.repository.createContent("items", campaignId, {
    name: "Reliquia de la cripta",
    slot: "utility",
    unlocked: true,
    price: 12,
  }) as Item;
  const itemB = built.repository.createContent("items", campaignId, {
    name: "Cable de cobre",
    slot: "utility",
    unlocked: true,
    price: 3,
  }) as Item;

  const enemy = built.repository.createContent("characters", campaignId, {
    name: "Centinela oxidado",
    kind: "enemy",
    baseStats: { hpMax: 20, def: 0, atk: 5, spd: 1, luck: 0, skillSlots: 2 },
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

  const encounterA = built.repository.createContent(
    "encounters",
    campaignId,
    {
      name: "Guardia de la cripta",
      enemies: [{ characterId: enemy.id }],
      rewards: { itemIds: [itemA.id], currency: 5 },
    },
  ) as Encounter;

  const encounterB = built.repository.createContent(
    "encounters",
    campaignId,
    {
      name: "Pasillo de ecos",
      enemies: [],
    },
  ) as Encounter;

  const character = built.repository.createContent(
    "characters",
    campaignId,
    {
      name: "Ana la Exploradora",
      kind: "player",
      baseStats: { hpMax: 50, def: 0, atk: 20, spd: 10, luck: 0, skillSlots: 2 },
      equipment: {
        horns: null,
        hand: null,
        armor: null,
        leg: null,
        utility: null,
      },
      skills: [null, null, null],
      inventory: [],
    },
  ) as Character;

  const hostedResponse = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/session`,
    payload: {},
  });
  expect(hostedResponse.statusCode, hostedResponse.body).toBe(201);
  const hosted = hostedResponse.json() as HostSessionResponse;

  const joinedResponse = await app.inject({
    method: "POST",
    url: `/api/sessions/${hosted.session.code}/join`,
    payload: { name: "Ana", characterId: character.id },
  });
  expect(joinedResponse.statusCode, joinedResponse.body).toBe(201);
  const joined = joinedResponse.json() as JoinSessionResponse;
  // Sin socket: la presencia simulada es lo que exige el arranque de combate.
  built.sessions.markPlayerConnected(
    hosted.session.code,
    joined.player.id,
    true,
  );

  return {
    campaignId,
    dmToken: hosted.dmToken,
    sessionCode: hosted.session.code,
    sessionId: hosted.session.id,
    playerToken: joined.playerToken,
    encounterA,
    encounterB,
    itemA,
    itemB,
  };
}

function withToken(token?: string): Record<string, string> {
  return token ? { "x-session-token": token } : {};
}

function expectError(
  response: { statusCode: number; json: () => unknown },
  status: number,
  code: string,
): void {
  expect(response.statusCode, JSON.stringify(response.json())).toBe(status);
  const body = response.json() as { error?: { code?: string } };
  expect(body.error?.code).toBe(code);
}

async function getCampaign(campaignId: string): Promise<Campaign> {
  const response = await app.inject({
    method: "GET",
    url: `/api/campaigns/${campaignId}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Campaign;
}

interface DungeonOverrides {
  name?: string;
  description?: string;
  entryRoomId?: string;
  rooms: Record<string, unknown>[];
}

async function createDungeon(
  fixture: Fixture,
  overrides?: Partial<DungeonOverrides>,
): Promise<Dungeon> {
  const response = await app.inject({
    method: "POST",
    url: `/api/campaigns/${fixture.campaignId}/dungeons`,
    headers: withToken(fixture.dmToken),
    payload: {
      name: overrides?.name ?? "Cripta de prueba",
      ...(overrides?.description ? { description: overrides.description } : {}),
      ...(overrides?.entryRoomId ? { entryRoomId: overrides.entryRoomId } : {}),
      rooms: overrides?.rooms ?? [
        { name: "Entrada", encounterId: fixture.encounterA.id },
        { name: "Fogata", kind: "rest" },
      ],
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as Dungeon;
}

async function patchDungeon(
  fixture: Fixture,
  dungeonId: string,
  payload: Record<string, unknown>,
): Promise<Dungeon> {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeonId}`,
    headers: withToken(fixture.dmToken),
    payload,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as Dungeon;
}

/* -------------------------------------------------------------------------- */
/* CRUD                                                                       */
/* -------------------------------------------------------------------------- */

describe("Fase 4B — CRUD de mazmorras", () => {
  it("el DM crea una mazmorra con salas, tipos, entrada y cofre", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      name: "Cripta lineal",
      description: "Cuatro salas de prueba",
      entryRoomId: "room-hall",
      rooms: [
        {
          id: "room-entry",
          name: "Entrada",
          encounterId: fixture.encounterA.id,
          background: "/uploads/entrada.png",
        },
        {
          id: "room-hall",
          name: "Guardia",
          kind: "boss",
          encounterId: fixture.encounterA.id,
        },
        {
          id: "room-rest",
          name: "Fogata",
          kind: "rest",
          notes: "Solo el DM sabe que aquí hay una trampa.",
        },
        {
          id: "room-chest",
          name: "Tesoro",
          kind: "treasure",
          rewards: {
            itemIds: [fixture.itemA.id],
            currency: 25,
            notes: "Cofre de la cripta",
          },
        },
      ],
    });

    expect(dungeon.id).toMatch(/^dgn/);
    expect(dungeon.name).toBe("Cripta lineal");
    expect(dungeon.description).toBe("Cuatro salas de prueba");
    expect(dungeon.entryRoomId).toBe("room-hall");
    expect(dungeon.rooms.map((room) => room.id)).toEqual([
      "room-entry",
      "room-hall",
      "room-rest",
      "room-chest",
    ]);
    expect(dungeon.rooms.map((room) => room.kind)).toEqual([
      undefined,
      "boss",
      "rest",
      "treasure",
    ]);
    expect(dungeon.rooms[0]?.background).toBe("/uploads/entrada.png");
    expect(dungeon.rooms[3]?.rewards).toEqual({
      itemIds: [fixture.itemA.id],
      currency: 25,
      notes: "Cofre de la cripta",
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/dungeons`,
      headers: withToken(fixture.dmToken),
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Dungeon[]).map((entry) => entry.id)).toEqual([
      dungeon.id,
    ]);

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.content.dungeons).toEqual([dungeon]);
  });

  it("asigna ids de sala y usa la primera sala como entrada por defecto", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      rooms: [{ name: "Uno" }, { name: "Dos", kind: "rest" }],
    });

    const [first, second] = dungeon.rooms;
    expect(first?.id).toMatch(/^drm/);
    expect(second?.id).toMatch(/^drm/);
    expect(first?.id).not.toBe(second?.id);
    expect(dungeon.entryRoomId).toBe(first?.id);
  });

  it("valida entrada inexistente, ids repetidos, encuentros y recompensas", async () => {
    const fixture = await makeFixture();
    const url = `/api/campaigns/${fixture.campaignId}/dungeons`;
    const headers = withToken(fixture.dmToken);

    const badEntry = await app.inject({
      method: "POST",
      url,
      headers,
      payload: {
        name: "Entrada rota",
        entryRoomId: "room-nope",
        rooms: [{ id: "room-1", name: "Sala" }],
      },
    });
    expectError(badEntry, 422, "validation_failed");

    const duplicatedRoom = await app.inject({
      method: "POST",
      url,
      headers,
      payload: {
        name: "Salas repetidas",
        rooms: [
          { id: "room-1", name: "Sala A" },
          { id: "room-1", name: "Sala B" },
        ],
      },
    });
    expectError(duplicatedRoom, 422, "validation_failed");

    const missingEncounter = await app.inject({
      method: "POST",
      url,
      headers,
      payload: {
        name: "Encuentro fantasma",
        rooms: [{ name: "Sala", encounterId: "enc_no_existe" }],
      },
    });
    expectError(missingEncounter, 422, "validation_failed");

    const missingReward = await app.inject({
      method: "POST",
      url,
      headers,
      payload: {
        name: "Cofre fantasma",
        rooms: [
          {
            name: "Cofre",
            kind: "treasure",
            rewards: { itemIds: ["itm_no_existe"], currency: 5 },
          },
        ],
      },
    });
    expectError(missingReward, 422, "validation_failed");

    const missingSkillReward = await app.inject({
      method: "POST",
      url,
      headers,
      payload: {
        name: "Cofre de skills fantasma",
        rooms: [
          {
            name: "Cofre",
            kind: "treasure",
            rewards: { skillIds: ["skl_no_existe"] },
          },
        ],
      },
    });
    expectError(missingSkillReward, 422, "validation_failed");

    const emptyRooms = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { name: "Sin salas", rooms: [] },
    });
    expectError(emptyRooms, 400, "invalid_payload");

    const noName = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { rooms: [{ name: "Sala" }] },
    });
    expectError(noName, 400, "invalid_payload");
  });

  it("acepta salas de ambientación y cofres vacíos como avisos", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      name: "Solo atmósfera",
      rooms: [
        { name: "Pasillo", description: "Huele a óxido." },
        { name: "Cofre vacío", kind: "treasure" },
      ],
    });

    expect(dungeon.rooms).toHaveLength(2);
    expect(dungeon.rooms[0]?.encounterId).toBeUndefined();
  });

  it("actualiza, reordena y conserva los ids de sala", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      entryRoomId: "room-2",
      rooms: [
        { id: "room-1", name: "Uno", encounterId: fixture.encounterA.id },
        { id: "room-2", name: "Dos", kind: "rest" },
        { id: "room-3", name: "Tres", encounterId: fixture.encounterB.id },
      ],
    });

    const [roomOne, roomTwo, roomThree] = dungeon.rooms;
    if (!roomOne || !roomTwo || !roomThree) throw new Error("Faltan salas.");

    const patched = await patchDungeon(fixture, dungeon.id, {
      name: "Cripta reordenada",
      entryRoomId: "room-3",
      rooms: [
        { ...roomThree, id: "room-3", name: "Tres (jefe)", kind: "boss" },
        roomTwo,
        { ...roomOne, id: "room-1", notes: "Ahora al final" },
      ],
    });

    expect(patched.name).toBe("Cripta reordenada");
    expect(patched.entryRoomId).toBe("room-3");
    expect(patched.rooms.map((room) => room.id)).toEqual([
      "room-3",
      "room-2",
      "room-1",
    ]);
    expect(patched.rooms[0]?.kind).toBe("boss");
    expect(patched.rooms[2]?.notes).toBe("Ahora al final");

    const withNewRoom = await patchDungeon(fixture, dungeon.id, {
      rooms: [...patched.rooms, { name: "Sala nueva", kind: "rest" }],
    });
    const added = withNewRoom.rooms[3];
    expect(added?.id).toMatch(/^drm/);
    expect(withNewRoom.entryRoomId).toBe("room-3");
  });

  it("permite borrar la descripción de la mazmorra con una cadena vacía", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      description: "Descripción inicial",
    });
    expect(dungeon.description).toBe("Descripción inicial");

    const cleared = await patchDungeon(fixture, dungeon.id, {
      description: "",
    });
    expect(cleared.description).toBeUndefined();

    // Omitir la clave en otro PATCH no la recupera.
    const renamed = await patchDungeon(fixture, dungeon.id, {
      name: "Sin descripción",
    });
    expect(renamed.description).toBeUndefined();
  });

  it("no permite dejar la entrada en una sala eliminada", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      entryRoomId: "room-1",
      rooms: [
        { id: "room-1", name: "Uno", encounterId: fixture.encounterA.id },
        { id: "room-2", name: "Dos", kind: "rest" },
      ],
    });
    const roomTwo = dungeon.rooms[1];
    if (!roomTwo) throw new Error("Falta la segunda sala.");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeon.id}`,
      headers: withToken(fixture.dmToken),
      payload: { rooms: [roomTwo], entryRoomId: "room-1" },
    });
    expectError(response, 422, "validation_failed");

    const responseWithoutEntry = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeon.id}`,
      headers: withToken(fixture.dmToken),
      payload: { rooms: [roomTwo] },
    });
    expectError(responseWithoutEntry, 422, "validation_failed");
  });

  it("borra la mazmorra y responde 404 con ids desconocidos", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeon.id}`,
      headers: withToken(fixture.dmToken),
    });
    expect(removed.statusCode).toBe(204);

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.content.dungeons).toHaveLength(0);

    const missing = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/dgn_no_existe`,
      headers: withToken(fixture.dmToken),
      payload: { name: "Fantasma" },
    });
    expectError(missing, 404, "dungeon_not_found");

    const missingDelete = await app.inject({
      method: "DELETE",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/dgn_no_existe`,
      headers: withToken(fixture.dmToken),
    });
    expectError(missingDelete, 404, "dungeon_not_found");
  });

  it("un jugador no puede crear, editar, borrar ni listar mazmorras", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture);
    const playerHeaders = withToken(fixture.playerToken);

    const list = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/dungeons`,
      headers: playerHeaders,
    });
    expectError(list, 403, "dm_only");

    const dmList = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/dungeons`,
      headers: withToken(fixture.dmToken),
    });
    expect(dmList.statusCode).toBe(200);

    const create = await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/dungeons`,
      headers: playerHeaders,
      payload: { name: "Pirata", rooms: [{ name: "Sala" }] },
    });
    expectError(create, 403, "dm_only");

    const update = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeon.id}`,
      headers: playerHeaders,
      payload: { name: "Pirata" },
    });
    expectError(update, 403, "dm_only");

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeon.id}`,
      headers: playerHeaders,
    });
    expectError(remove, 403, "dm_only");
  });

  it("el estado del jugador no incluye mazmorras ni notas privadas", async () => {
    const fixture = await makeFixture();
    await createDungeon(fixture, {
      name: "Cripta secreta",
      rooms: [
        {
          name: "Entrada",
          encounterId: fixture.encounterA.id,
          notes: "SECRETO-SOLO-DM",
        },
      ],
    });

    const state = await app.inject({
      method: "GET",
      url: `/api/sessions/${fixture.sessionCode}/state`,
      headers: withToken(fixture.playerToken),
    });
    expect(state.statusCode, state.body).toBe(200);
    const body = state.json() as { campaign: Campaign };
    expect(body.campaign.content.dungeons).toEqual([]);
    expect(state.body).not.toContain("SECRETO-SOLO-DM");
    expect(state.body).not.toContain("Cripta secreta");
  });

  it("no permite editar mazmorras durante el combate", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture);
    built.combat.startEncounter(
      fixture.campaignId,
      fixture.encounterA.id,
      fixture.sessionId,
      { seed: "seed-dungeon", speedRoll: false },
    );

    const create = await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/dungeons`,
      headers: withToken(fixture.dmToken),
      payload: { name: "En combate", rooms: [{ name: "Sala" }] },
    });
    expectError(create, 423, "combat_lock");

    const update = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeon.id}`,
      headers: withToken(fixture.dmToken),
      payload: { name: "En combate" },
    });
    expectError(update, 423, "combat_lock");

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeon.id}`,
      headers: withToken(fixture.dmToken),
    });
    expectError(remove, 423, "combat_lock");
  });

  it("bloquea borrar un encuentro vinculado y se libera al borrar la mazmorra", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      rooms: [
        { name: "Entrada", encounterId: fixture.encounterB.id },
        { name: "Fogata", kind: "rest" },
      ],
    });

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/content/encounters/${fixture.encounterB.id}`,
      headers: withToken(fixture.dmToken),
    });
    expectError(blocked, 409, "content_referenced");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${dungeon.id}`,
      headers: withToken(fixture.dmToken),
    });
    expect(removed.statusCode).toBe(204);

    const freed = await app.inject({
      method: "DELETE",
      url: `/api/content/encounters/${fixture.encounterB.id}`,
      headers: withToken(fixture.dmToken),
    });
    expect(freed.statusCode).toBe(204);
  });

  it("bloquea borrar un objeto usado como recompensa de cofre", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      rooms: [
        {
          name: "Cofre",
          kind: "treasure",
          rewards: { itemIds: [fixture.itemB.id], currency: 1 },
        },
      ],
    });

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/content/items/${fixture.itemB.id}`,
      headers: withToken(fixture.dmToken),
    });
    expectError(blocked, 409, "content_referenced");

    await patchDungeon(fixture, dungeon.id, {
      rooms: [{ id: dungeon.rooms[0]?.id, name: "Cofre", kind: "treasure" }],
    });

    const freed = await app.inject({
      method: "DELETE",
      url: `/api/content/items/${fixture.itemB.id}`,
      headers: withToken(fixture.dmToken),
    });
    expect(freed.statusCode).toBe(204);
  });
});

/* -------------------------------------------------------------------------- */
/* Export / import                                                            */
/* -------------------------------------------------------------------------- */

describe("Fase 4B — export/import de mazmorras", () => {
  it("exporta e importa remapeando ids de mazmorra, sala, encuentro y recompensa", async () => {
    const fixture = await makeFixture();
    const rewardSkill = built.repository.createContent(
      "skills",
      fixture.campaignId,
      {
        name: "Técnica exportable",
        coins: 1,
        baseClash: 10,
        coinClash: 0,
        baseDamage: 10,
        coinDamage: 0,
        target: "single",
      },
    ) as Skill;
    const dungeon = await createDungeon(fixture, {
      name: "Cripta exportable",
      description: "Con jefe y cofre",
      entryRoomId: "room-2",
      rooms: [
        {
          id: "room-1",
          name: "Entrada",
          encounterId: fixture.encounterA.id,
          background: "/uploads/cripta.png",
        },
        {
          id: "room-2",
          name: "Jefe",
          kind: "boss",
          encounterId: fixture.encounterB.id,
          description: "La puerta del trono.",
        },
        {
          id: "room-3",
          name: "Cofre",
          kind: "treasure",
          unlockRewards: true,
          rewards: {
            itemIds: [fixture.itemA.id],
            skillIds: [rewardSkill.id],
            currency: 9,
            notes: "Botín del jefe",
          },
        },
      ],
    });

    const exported = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/export`,
      headers: withToken(fixture.dmToken),
    });
    expect(exported.statusCode, exported.body).toBe(200);
    const campaign = exported.json() as Campaign;
    expect(campaign.content.dungeons).toHaveLength(1);

    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/campaigns/import",
      payload: { campaign },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = importedResponse.json() as Campaign;
    const importedDungeon = imported.content.dungeons[0];
    if (!importedDungeon) throw new Error("No se importó la mazmorra.");

    expect(importedDungeon.id).not.toBe(dungeon.id);
    expect(importedDungeon.name).toBe("Cripta exportable");
    expect(importedDungeon.description).toBe("Con jefe y cofre");
    expect(importedDungeon.rooms.map((room) => room.name)).toEqual([
      "Entrada",
      "Jefe",
      "Cofre",
    ]);

    // Ningún id de sala puede coincidir con el export original.
    const originalRoomIds = new Set(dungeon.rooms.map((room) => room.id));
    for (const room of importedDungeon.rooms) {
      expect(originalRoomIds.has(room.id)).toBe(false);
    }
    // La entrada sigue apuntando a la segunda sala, ya remapeada.
    expect(importedDungeon.entryRoomId).toBe(importedDungeon.rooms[1]?.id);
    expect(importedDungeon.rooms[1]?.id).not.toBe("room-2");

    // Encuentros remapeados y existentes en la campaña importada.
    const importedEncounterIds = imported.content.encounters.map(
      (encounter) => encounter.id,
    );
    expect(importedEncounterIds).toContain(importedDungeon.rooms[0]?.encounterId);
    expect(importedDungeon.rooms[0]?.encounterId).not.toBe(
      fixture.encounterA.id,
    );
    expect(importedDungeon.rooms[0]?.background).toBe("/uploads/cripta.png");

    // Recompensa de cofre remapeada al objeto importado.
    const rewardItemId = importedDungeon.rooms[2]?.rewards?.itemIds?.[0];
    expect(rewardItemId).toBeDefined();
    expect(imported.content.items.map((item) => item.id)).toContain(rewardItemId);
    expect(rewardItemId).not.toBe(fixture.itemA.id);
    expect(importedDungeon.rooms[2]?.rewards?.currency).toBe(9);
    expect(importedDungeon.rooms[2]?.rewards?.notes).toBe("Botín del jefe");
    expect(importedDungeon.rooms[2]?.unlockRewards).toBe(true);
    const importedSkillId = importedDungeon.rooms[2]?.rewards?.skillIds?.[0];
    expect(importedSkillId).toBeDefined();
    expect(importedSkillId).not.toBe(rewardSkill.id);
    expect(
      imported.content.skills.some((skill) => skill.id === importedSkillId),
    ).toBe(true);
  });

  it("importa un export antiguo sin tipo, entrada, fondo ni recompensas", async () => {
    const fixture = await makeFixture();
    const dungeon = await createDungeon(fixture, {
      rooms: [
        { id: "room-1", name: "Entrada", encounterId: fixture.encounterA.id },
        { id: "room-2", name: "Fondo", notes: "Nota antigua" },
      ],
    });

    const exported = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/export`,
      headers: withToken(fixture.dmToken),
    });
    expect(exported.statusCode, exported.body).toBe(200);
    const legacy = exported.json() as Campaign;
    const legacyDungeon = legacy.content.dungeons[0];
    if (!legacyDungeon) throw new Error("No se exportó la mazmorra.");

    delete (legacyDungeon as Partial<Dungeon>).entryRoomId;
    for (const room of legacyDungeon.rooms) {
      delete (room as Partial<DungeonRoom>).kind;
      delete (room as Partial<DungeonRoom>).description;
      delete (room as Partial<DungeonRoom>).background;
      delete (room as Partial<DungeonRoom>).rewards;
    }

    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/campaigns/import",
      payload: { campaign: legacy },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = importedResponse.json() as Campaign;
    const importedDungeon = imported.content.dungeons[0];
    if (!importedDungeon) throw new Error("No se importó la mazmorra.");

    expect(importedDungeon.rooms).toHaveLength(2);
    expect(importedDungeon.rooms[0]?.name).toBe("Entrada");
    expect(importedDungeon.rooms[1]?.name).toBe("Fondo");
    expect(importedDungeon.rooms[1]?.notes).toBe("Nota antigua");
    expect(importedDungeon.entryRoomId).toBeUndefined();
    expect(importedDungeon.rooms[0]?.encounterId).not.toBe(
      fixture.encounterA.id,
    );
    expect(
      imported.content.encounters.map((encounter) => encounter.id),
    ).toContain(importedDungeon.rooms[0]?.encounterId);
    expect(dungeon.rooms[1]?.notes).toBe("Nota antigua");
  });
});
