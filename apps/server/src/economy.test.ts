import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  Character,
  CombatState,
  Encounter,
  HostSessionResponse,
  Item,
  JoinSessionResponse,
  Shop,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";

/**
 * Fase 4A — Clean Shards, tiendas y botín de encuentro.
 *
 * SQLite temporal (`mkdtemp`), el servicio real y las rutas HTTP reales.
 * Nunca se toca `data/protocol-life.sqlite`.
 */

let dir: string;
let dbFile: string;
let built: BuiltApp;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-economy-"));
  dbFile = join(dir, "economy.sqlite");
  built = await buildApp({
    dbPath: dbFile,
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

interface PlayerFixture {
  token: string;
  playerId: string;
  character: Character;
}

interface Fixture {
  campaignId: string;
  dmToken: string;
  sessionCode: string;
  sessionId: string;
  players: PlayerFixture[];
  itemA: Item;
  itemB: Item;
  lockedItem: Item;
}

async function createItem(
  campaignId: string,
  name: string,
  unlocked: boolean,
  price = 10,
): Promise<Item> {
  return built.repository.createContent("items", campaignId, {
    name,
    slot: "utility",
    unlocked,
    price,
  }) as Item;
}

async function createPlayerCharacter(
  campaignId: string,
  name: string,
): Promise<Character> {
  return built.repository.createContent("characters", campaignId, {
    name,
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
  }) as Character;
}

async function makeFixture(playerCount = 2): Promise<Fixture> {
  const campaign = built.repository.createCampaign({
    name: "Economía de prueba",
    seed: false,
  });
  const campaignId = campaign.id;
  const itemA = await createItem(campaignId, "Shard antiguo", true, 10);
  const itemB = await createItem(campaignId, "Cable de cobre", true, 5);
  const lockedItem = await createItem(campaignId, "Prototipo secreto", false, 99);

  const characters: Character[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    characters.push(
      await createPlayerCharacter(campaignId, `Jugador ${index + 1}`),
    );
  }

  const hostedResponse = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/session`,
    payload: {},
  });
  expect(hostedResponse.statusCode, hostedResponse.body).toBe(201);
  const hosted = hostedResponse.json() as HostSessionResponse;

  const players: PlayerFixture[] = [];
  for (const [index, character] of characters.entries()) {
    const joinedResponse = await app.inject({
      method: "POST",
      url: `/api/sessions/${hosted.session.code}/join`,
      payload: { name: `Ana ${index + 1}`, characterId: character.id },
    });
    expect(joinedResponse.statusCode, joinedResponse.body).toBe(201);
    const joined = joinedResponse.json() as JoinSessionResponse;
    players.push({
      token: joined.playerToken,
      playerId: joined.player.id,
      character,
    });
  }
  // Los tests HTTP no abren socket: simulamos presencia para poder combatir.
  for (const player of players) {
    built.sessions.markPlayerConnected(hosted.session.code, player.playerId, true);
  }

  return {
    campaignId,
    dmToken: hosted.dmToken,
    sessionCode: hosted.session.code,
    sessionId: hosted.session.id,
    players,
    itemA,
    itemB,
    lockedItem,
  };
}

function withToken(token?: string): Record<string, string> {
  return token ? { "x-session-token": token } : {};
}

async function getCampaign(campaignId: string): Promise<Campaign> {
  const response = await app.inject({
    method: "GET",
    url: `/api/campaigns/${campaignId}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Campaign;
}

function characterById(campaign: Campaign, characterId: string): Character {
  const found = campaign.content.characters.find(
    (character) => character.id === characterId,
  );
  if (!found) throw new Error(`No existe el personaje ${characterId}`);
  return found;
}

function shopById(campaign: Campaign, shopId: string): Shop {
  const found = campaign.content.shops.find((shop) => shop.id === shopId);
  if (!found) throw new Error(`No existe la tienda ${shopId}`);
  return found;
}

async function createShop(
  fixture: Fixture,
  overrides: Partial<{
    name: string;
    background: string;
    items: { itemId: string; price: number; stock?: number }[];
  }> = {},
): Promise<Shop> {
  const response = await app.inject({
    method: "POST",
    url: `/api/campaigns/${fixture.campaignId}/shops`,
    headers: withToken(fixture.dmToken),
    payload: {
      name: overrides.name ?? "Tienda de la estación",
      ...(overrides.background ? { background: overrides.background } : {}),
      items: overrides.items ?? [
        { itemId: fixture.itemA.id, price: 10, stock: 3 },
        { itemId: fixture.itemB.id, price: 5 },
      ],
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as Shop;
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

interface PreparedEncounter {
  encounterId: string;
  skillId: string;
}

/**
 * Crea un encuentro con un enemigo débil y una skill fuerte para el primer
 * jugador. No arranca el combate: lo decide cada test.
 */
async function prepareEncounter(
  fixture: Fixture,
  rewards?: Encounter["rewards"],
): Promise<PreparedEncounter> {
  const campaignId = fixture.campaignId;
  const skill = built.repository.createContent("skills", campaignId, {
    name: "Golpe de prueba",
    coins: 1,
    baseClash: 100,
    coinClash: 0,
    baseDamage: 100,
    coinDamage: 0,
    target: "single",
  }) as { id: string };

  const enemy = built.repository.createContent("characters", campaignId, {
    name: "Chatarra hostil",
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
      name: "Emboscada de prueba",
      enemies: [{ characterId: enemy.id }],
      rewards,
    },
  ) as Encounter;

  const firstPlayer = fixture.players[0];
  if (!firstPlayer) throw new Error("El fixture no tiene jugadores.");
  built.repository.updateContent("characters", firstPlayer.character.id, {
    skills: [skill.id, null, null],
    baseStats: {
      hpMax: 50,
      def: 0,
      atk: 200,
      spd: 10,
      luck: 0,
      skillSlots: 2,
    },
  });

  return { encounterId: encounter.id, skillId: skill.id };
}

function startCombat(fixture: Fixture, encounterId: string): CombatState {
  return built.combat.startEncounter(
    fixture.campaignId,
    encounterId,
    fixture.sessionId,
    { seed: "seed-economia", speedRoll: false },
  );
}

/** Declara con el primer jugador y bloquea a todos; la ronda gana el combate. */
function winRound(
  fixture: Fixture,
  combatId: string,
  skillId: string,
): CombatState {
  const session = built.sessions.getById(fixture.sessionId);
  if (!session) throw new Error("La sesión desapareció.");

  const current = built.combat.getState(combatId);
  const enemyUnit = current.units.find((unit) => unit.team === "enemies");
  if (!enemyUnit) throw new Error("El combate no tiene enemigos.");

  const first = session.players[0];
  if (!first) throw new Error("La sesión no tiene jugadores.");
  built.combat.declareActions({ role: "player", player: first }, combatId, [
    { slot: 1, skillId, targetId: enemyUnit.id },
  ]);

  // El resto de jugadores se bloquea sin acciones.
  for (const player of session.players.slice(1)) {
    built.combat.declareActions({ role: "player", player }, combatId, []);
  }
  for (const player of session.players) {
    built.combat.lockActions(combatId, { role: "player", player });
  }
  // El lock del DM cierra los turnos y `resolveCombatRound` resuelve la ronda
  // (igual que hace el socket al recibir `combat:lock`).
  built.combat.lockActions(combatId, { role: "dm" });
  return built.combat.resolveCombatRound(combatId);
}

/** Prepara, arranca y gana el combate en una llamada. */
async function startWinningCombat(
  fixture: Fixture,
  rewards?: Encounter["rewards"],
): Promise<{ combatId: string; encounterId: string }> {
  const prepared = await prepareEncounter(fixture, rewards);
  const state = startCombat(fixture, prepared.encounterId);
  winRound(fixture, state.id, prepared.skillId);
  return { combatId: state.id, encounterId: prepared.encounterId };
}

/* -------------------------------------------------------------------------- */
/* Bolsa de party                                                             */
/* -------------------------------------------------------------------------- */

describe("Fase 4A — bolsa de Clean Shards", () => {
  it("una campaña nueva nace con 0 Clean Shards", async () => {
    const fixture = await makeFixture(1);
    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.wallet).toEqual({ cleanShards: 0 });
  });

  it("el DM suma y resta; la bolsa nunca queda en negativo", async () => {
    const fixture = await makeFixture(1);

    const add = await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/wallet`,
      headers: withToken(fixture.dmToken),
      payload: { delta: 250 },
    });
    expect(add.statusCode, add.body).toBe(200);
    expect((add.json() as Campaign).wallet.cleanShards).toBe(250);

    const spend = await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/wallet`,
      headers: withToken(fixture.dmToken),
      payload: { delta: -100 },
    });
    expect(spend.statusCode, spend.body).toBe(200);
    expect((spend.json() as Campaign).wallet.cleanShards).toBe(150);

    const tooMuch = await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/wallet`,
      headers: withToken(fixture.dmToken),
      payload: { delta: -1000 },
    });
    expectError(tooMuch, 409, "insufficient_funds");

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(150);
  });

  it("una campaña de Fase 3 sin wallet se lee como 0", async () => {
    const fixture = await makeFixture(1);
    const legacy = new Database(dbFile);
    try {
      legacy
        .prepare("UPDATE campaigns SET extras = ? WHERE id = ?")
        .run('{"shops":[],"dungeons":[]}', fixture.campaignId);
    } finally {
      legacy.close();
    }

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.wallet).toEqual({ cleanShards: 0 });
  });

  it("editar la campaña no pierde la bolsa", async () => {
    const fixture = await makeFixture(1);
    await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/wallet`,
      headers: withToken(fixture.dmToken),
      payload: { delta: 40 },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${fixture.campaignId}`,
      headers: withToken(fixture.dmToken),
      payload: { name: "Campaña renombrada" },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((patched.json() as Campaign).wallet.cleanShards).toBe(40);
    expect((patched.json() as Campaign).name).toBe("Campaña renombrada");
  });
});

/* -------------------------------------------------------------------------- */
/* CRUD de tiendas                                                            */
/* -------------------------------------------------------------------------- */

describe("Fase 4A — CRUD de tiendas", () => {
  it("el DM crea una tienda cerrada y la lista", async () => {
    const fixture = await makeFixture(1);
    const shop = await createShop(fixture);

    expect(shop.name).toBe("Tienda de la estación");
    expect(shop.background).toBeUndefined();
    expect(shop.items).toHaveLength(2);

    const list = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/shops`,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Shop[]).map((entry) => entry.id)).toEqual([shop.id]);

    const campaign = await getCampaign(fixture.campaignId);
    expect(shopById(campaign, shop.id).items).toHaveLength(2);
  });

  it("valida objetos inexistentes, duplicados y precios negativos", async () => {
    const fixture = await makeFixture(1);

    const missing = await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/shops`,
      headers: withToken(fixture.dmToken),
      payload: {
        name: "Tienda rota",
        items: [{ itemId: "itm_no_existe", price: 5 }],
      },
    });
    expectError(missing, 422, "validation_failed");

    const duplicated = await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/shops`,
      headers: withToken(fixture.dmToken),
      payload: {
        name: "Tienda duplicada",
        items: [
          { itemId: fixture.itemA.id, price: 5 },
          { itemId: fixture.itemA.id, price: 7 },
        ],
      },
    });
    expectError(duplicated, 422, "validation_failed");

    const negative = await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/shops`,
      headers: withToken(fixture.dmToken),
      payload: {
        name: "Tienda negativa",
        items: [{ itemId: fixture.itemA.id, price: -1 }],
      },
    });
    expectError(negative, 400, "invalid_payload");
  });

  it("un jugador no puede editar la tienda", async () => {
    const fixture = await makeFixture(1);
    const shop = await createShop(fixture);

    const playerEdit = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${fixture.campaignId}/shops/${shop.id}`,
      headers: withToken(fixture.players[0]?.token),
      payload: { name: "Tienda pirata" },
    });
    expectError(playerEdit, 403, "dm_only");
  });

  it("no permite borrar un objeto que está a la venta", async () => {
    const fixture = await makeFixture(1);
    await createShop(fixture);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/content/items/${fixture.itemA.id}`,
      headers: withToken(fixture.dmToken),
    });
    expectError(response, 409, "content_referenced");
  });

  it("borra la tienda", async () => {
    const fixture = await makeFixture(1);
    const shop = await createShop(fixture);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/campaigns/${fixture.campaignId}/shops/${shop.id}`,
      headers: withToken(fixture.dmToken),
    });
    expect(removed.statusCode).toBe(204);

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.content.shops).toHaveLength(0);
  });

  it("importa un export de Fase 3 sin wallet y le pone 0", async () => {
    const fixture = await makeFixture(1);
    const exported = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/export`,
      headers: withToken(fixture.dmToken),
    });
    expect(exported.statusCode, exported.body).toBe(200);
    // Simula un export de Fase 3: campaña válida sin la clave `wallet`.
    const legacyExport = exported.json() as Record<string, unknown>;
    delete legacyExport.wallet;

    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/campaigns/import",
      payload: { campaign: legacyExport },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    expect((importedResponse.json() as Campaign).wallet).toEqual({
      cleanShards: 0,
    });
  });

  it("exporta e importa con IDs remapeados y la bolsa", async () => {
    const fixture = await makeFixture(1);
    const shop = await createShop(fixture, {
      background: "/uploads/mercado.gif",
    });
    await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/wallet`,
      headers: withToken(fixture.dmToken),
      payload: { delta: 77 },
    });

    const exported = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/export`,
      headers: withToken(fixture.dmToken),
    });
    expect(exported.statusCode, exported.body).toBe(200);
    const campaign = exported.json() as Campaign;
    expect(campaign.wallet.cleanShards).toBe(77);
    expect(campaign.content.shops).toHaveLength(1);
    expect(campaign.content.shops[0]?.background).toBe("/uploads/mercado.gif");

    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/campaigns/import",
      payload: { campaign },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = importedResponse.json() as Campaign;

    expect(imported.id).not.toBe(campaign.id);
    expect(imported.wallet.cleanShards).toBe(77);
    const importedShop = imported.content.shops[0];
    expect(importedShop?.id).not.toBe(shop.id);
    expect(importedShop?.background).toBe("/uploads/mercado.gif");
    const importedItemIds = imported.content.items.map((item) => item.id);
    for (const entry of importedShop?.items ?? []) {
      expect(importedItemIds).toContain(entry.itemId);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Saneado del jugador                                                        */
/* -------------------------------------------------------------------------- */

describe("Fase 4A — saneado del jugador", () => {
  it("no recibe tiendas en su campaña y sí la bolsa", async () => {
    const fixture = await makeFixture(1);
    await createShop(fixture, {
      items: [
        { itemId: fixture.itemA.id, price: 10 },
        { itemId: fixture.lockedItem.id, price: 50 },
      ],
    });
    await app.inject({
      method: "POST",
      url: `/api/campaigns/${fixture.campaignId}/wallet`,
      headers: withToken(fixture.dmToken),
      payload: { delta: 33 },
    });

    const stateResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${fixture.sessionCode}/state`,
      headers: withToken(fixture.players[0]?.token),
    });
    expect(stateResponse.statusCode, stateResponse.body).toBe(200);
    const state = stateResponse.json() as {
      campaign: Campaign;
      character: Character;
    };

    expect(state.campaign.wallet.cleanShards).toBe(33);
    // La escena de tienda manda su propio snapshot; la campaña saneada no
    // incluye tiendas ni objetos bloqueados.
    expect(state.campaign.content.shops).toEqual([]);
    expect(state.campaign.content.encounters).toEqual([]);
    expect(
      state.campaign.content.items.some(
        (item) => item.id === fixture.lockedItem.id,
      ),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Recompensas de encuentro                                                   */
/* -------------------------------------------------------------------------- */

describe("Fase 4A — recompensas de encuentro", () => {
  it("la victoria paga la moneda y entrega cada objeto a todos los jugadores", async () => {
    const fixture = await makeFixture(2);
    await startWinningCombat(fixture, {
      currency: 30,
      itemIds: [fixture.itemA.id, fixture.itemB.id],
    });

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(30);
    for (const player of fixture.players) {
      const character = characterById(campaign, player.character.id);
      expect(character.inventory).toEqual([
        { itemId: fixture.itemA.id, qty: 1 },
        { itemId: fixture.itemB.id, qty: 1 },
      ]);
    }
  });

  it("no duplica recompensas al volver a cerrar el combate", async () => {
    const fixture = await makeFixture(1);
    const { combatId } = await startWinningCombat(fixture, {
      currency: 30,
      itemIds: [fixture.itemA.id],
    });
    const finished = built.combat.getState(combatId);
    expect(finished.rewardsApplied).toBe(true);

    const again = built.combat.endEncounter(combatId, "dm");
    expect(again.rewardsApplied).toBe(true);

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(30);
    expect(
      characterById(campaign, fixture.players[0]!.character.id).inventory,
    ).toEqual([{ itemId: fixture.itemA.id, qty: 1 }]);
  });

  it("sin ganador no hay recompensa", async () => {
    const fixture = await makeFixture(1);
    const prepared = await prepareEncounter(fixture, {
      currency: 99,
      itemIds: [fixture.itemA.id],
    });
    const state = startCombat(fixture, prepared.encounterId);

    // El DM cierra el combate con el enemigo vivo: no hay ganador.
    const ended = built.combat.endEncounter(state.id, "dm");
    expect(ended.winner).toBeUndefined();
    expect(ended.rewardsApplied).toBeUndefined();

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(0);
    expect(
      characterById(campaign, fixture.players[0]!.character.id).inventory,
    ).toEqual([]);
  });

  it("los objetos repetidos se entregan como copias", async () => {
    const fixture = await makeFixture(1);
    await startWinningCombat(fixture, {
      itemIds: [fixture.itemB.id, fixture.itemB.id],
    });

    const campaign = await getCampaign(fixture.campaignId);
    expect(
      characterById(campaign, fixture.players[0]!.character.id).inventory,
    ).toEqual([{ itemId: fixture.itemB.id, qty: 2 }]);
  });

  it("un encuentro sin recompensas no cambia la bolsa ni el inventario", async () => {
    const fixture = await makeFixture(1);
    const { combatId } = await startWinningCombat(fixture);

    const state = built.combat.getState(combatId);
    expect(state.rewardsApplied).toBe(true);
    expect(state.rewardSummary).toBeUndefined();

    const campaign = await getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(0);
    expect(
      characterById(campaign, fixture.players[0]!.character.id).inventory,
    ).toEqual([]);
  });

  it("el resumen del botín viaja en el estado público del combate", async () => {
    const fixture = await makeFixture(1);
    const { combatId } = await startWinningCombat(fixture, {
      currency: 12,
      itemIds: [fixture.itemA.id],
    });

    const state = built.combat.getState(combatId);
    expect(state.rewardSummary).toEqual({
      currency: 12,
      itemIds: [fixture.itemA.id],
      characterIds: [fixture.players[0]!.character.id],
    });
    const end = state.log.find((event) => event.type === "combatEnd");
    expect(end?.data?.rewards).toMatchObject({ currency: 12 });
  });
});
