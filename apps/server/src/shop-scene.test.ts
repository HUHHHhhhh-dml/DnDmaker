import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  Character,
  Encounter,
  HostSessionResponse,
  Item,
  JoinSessionResponse,
  SessionStateResponse,
  Shop,
  ShopScene,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";

/**
 * Fase 4A-3 — escena de tienda y compra como desbloqueo.
 *
 * SQLite temporal (`mkdtemp`). El DM abre una tienda en la sesión; los
 * jugadores compran pagando el precio y desbloqueando el objeto para toda la
 * campaña. La compra **no** añade nada al inventario.
 */

let dir: string;
let built: BuiltApp;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-shop-"));
  built = await buildApp({
    dbPath: join(dir, "shop.sqlite"),
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
  playerToken: string;
  sessionCode: string;
  sessionId: string;
  characterId: string;
  lockedItem: Item;
  openItem: Item;
  unsoldItem: Item;
  shop: Shop;
}

let counter = 0;

async function makeFixture(): Promise<Fixture> {
  counter += 1;
  const campaign = built.repository.createCampaign({
    name: `Tienda escena ${counter}`,
    seed: false,
  });
  const campaignId = campaign.id;
  await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/wallet`,
    payload: { delta: 100 },
  });

  const lockedItem = built.repository.createContent("items", campaignId, {
    name: "Filo de prueba",
    slot: "hand",
    unlocked: false,
    stats: { atk: 3, spd: 1 },
  }) as Item;
  const openItem = built.repository.createContent("items", campaignId, {
    name: "Objeto libre",
    slot: "utility",
    unlocked: true,
  }) as Item;
  const unsoldItem = built.repository.createContent("items", campaignId, {
    name: "No está en la tienda",
    slot: "armor",
    unlocked: false,
  }) as Item;

  const character = built.repository.createContent("characters", campaignId, {
    name: "Comprandera",
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
    inventory: [],
  }) as Character;

  const hostedResponse = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/session`,
    payload: {},
  });
  expect(hostedResponse.statusCode, hostedResponse.body).toBe(201);
  const hosted = hostedResponse.json() as HostSessionResponse;

  const joined = await app.inject({
    method: "POST",
    url: `/api/sessions/${hosted.session.code}/join`,
    payload: { name: "Ana", characterId: character.id },
  });
  expect(joined.statusCode, joined.body).toBe(201);
  const joinedBody = joined.json() as JoinSessionResponse;
  built.sessions.markPlayerConnected(
    hosted.session.code,
    joinedBody.player.id,
    true,
  );

  const created = await createShop(campaignId, hosted.dmToken, {
    name: "Mercado de la estación",
    background: "/uploads/mercado.gif",
    items: [
      { itemId: lockedItem.id, price: 25, stock: 2 },
      { itemId: openItem.id, price: 5 },
    ],
  });

  return {
    campaignId,
    dmToken: hosted.dmToken,
    playerToken: joinedBody.playerToken,
    sessionCode: hosted.session.code,
    sessionId: hosted.session.id,
    characterId: character.id,
    lockedItem,
    openItem,
    unsoldItem,
    shop: created,
  };
}

function token(token?: string): Record<string, string> {
  return token ? { "x-session-token": token } : {};
}

async function createShop(
  campaignId: string,
  dmToken: string,
  input: {
    name: string;
    background?: string;
    items: { itemId: string; price: number; stock?: number }[];
  },
): Promise<Shop> {
  const response = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/shops`,
    headers: token(dmToken),
    payload: input,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as Shop;
}

function openShop(fixture: Fixture, shopId = fixture.shop.id, dmToken = fixture.dmToken) {
  return app.inject({
    method: "POST",
    url: `/api/sessions/${fixture.sessionCode}/shop/open`,
    headers: token(dmToken),
    payload: { shopId },
  });
}

function closeShop(fixture: Fixture, dmToken = fixture.dmToken) {
  return app.inject({
    method: "POST",
    url: `/api/sessions/${fixture.sessionCode}/shop/close`,
    headers: token(dmToken),
    payload: {},
  });
}

function buy(fixture: Fixture, tokenValue: string | undefined, itemId: string) {
  return app.inject({
    method: "POST",
    url: `/api/sessions/${fixture.sessionCode}/shop/buy`,
    headers: token(tokenValue),
    payload: { itemId },
  });
}

async function getSessionState(fixture: Fixture): Promise<SessionStateResponse> {
  const response = await app.inject({
    method: "GET",
    url: `/api/sessions/${fixture.sessionCode}/state`,
    headers: token(fixture.playerToken),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as SessionStateResponse;
}

function campaignOf(fixture: Fixture): Campaign {
  return built.repository.getCampaign(fixture.campaignId);
}

function itemOf(fixture: Fixture, itemId: string): Item {
  const item = campaignOf(fixture).content.items.find(
    (entry) => entry.id === itemId,
  );
  if (!item) throw new Error(`No existe el objeto ${itemId}`);
  return item;
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

/* -------------------------------------------------------------------------- */
/* Abrir y cerrar                                                             */
/* -------------------------------------------------------------------------- */

describe("Fase 4A-3 — abrir y cerrar la tienda", () => {
  it("el DM abre la tienda y la sala recibe la escena con objetos bloqueados", async () => {
    const fixture = await makeFixture();
    const response = await openShop(fixture);
    expect(response.statusCode, response.body).toBe(200);
    const scene = response.json() as ShopScene;

    expect(scene.name).toBe("Mercado de la estación");
    expect(scene.background).toBe("/uploads/mercado.gif");
    expect(scene.items).toHaveLength(2);
    const locked = scene.items.find(
      (entry) => entry.item.id === fixture.lockedItem.id,
    );
    expect(locked).toMatchObject({
      price: 25,
      stock: 2,
      unlocked: false,
    });
    expect(locked?.item).toMatchObject({
      name: "Filo de prueba",
      slot: "hand",
      stats: { atk: 3, spd: 1 },
    });
    expect(
      scene.items.find((entry) => entry.item.id === fixture.openItem.id)
        ?.unlocked,
    ).toBe(true);

    // La escena llega al jugador por el estado de la sesión.
    const state = await getSessionState(fixture);
    expect(state.activeShop?.shopId).toBe(fixture.shop.id);
    expect(state.activeShop?.items).toHaveLength(2);
  });

  it("el jugador no puede abrir ni cerrar la tienda", async () => {
    const fixture = await makeFixture();
    expectError(await openShop(fixture, fixture.shop.id, fixture.playerToken), 403, "dm_only");
    expectError(await closeShop(fixture, fixture.playerToken), 403, "dm_only");
  });

  it("abrir otra tienda reemplaza la anterior y cerrar devuelve null", async () => {
    const fixture = await makeFixture();
    await openShop(fixture);

    const second = await createShop(fixture.campaignId, fixture.dmToken, {
      name: "Trastienda",
      items: [{ itemId: fixture.unsoldItem.id, price: 7 }],
    });
    const replaced = await openShop(fixture, second.id);
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect((replaced.json() as ShopScene).name).toBe("Trastienda");

    const closed = await closeShop(fixture);
    expect(closed.statusCode).toBe(204);
    expect((await getSessionState(fixture)).activeShop).toBeNull();
    expect(built.shopScene.getBySession(fixture.sessionId)).toBeNull();
  });

  it("borrar la tienda abierta cierra la escena", async () => {
    const fixture = await makeFixture();
    await openShop(fixture);
    built.repository.deleteShop(fixture.campaignId, fixture.shop.id);
    expect(built.shopScene.getBySession(fixture.sessionId)).toBeNull();
    expect((await getSessionState(fixture)).activeShop).toBeNull();
  });

  it("no se puede abrir una tienda durante el combate", async () => {
    const fixture = await makeFixture();
    built.sessions.setStatus(fixture.sessionId, "combat");
    expectError(await openShop(fixture), 423, "combat_lock");
  });
});

/* -------------------------------------------------------------------------- */
/* Compra = desbloqueo                                                        */
/* -------------------------------------------------------------------------- */

describe("Fase 4A-3 — comprar desbloquea el objeto", () => {
  it("paga la bolsa, baja el stock y desbloquea para la campaña sin tocar el inventario", async () => {
    const fixture = await makeFixture();
    await openShop(fixture);

    const response = await buy(fixture, fixture.playerToken, fixture.lockedItem.id);
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json() as {
      shop: ShopScene;
      wallet: { cleanShards: number };
      item: Item;
      spent: number;
    };

    expect(result.spent).toBe(25);
    expect(result.wallet.cleanShards).toBe(75);
    expect(result.item.unlocked).toBe(true);
    expect(
      result.shop.items.find((entry) => entry.item.id === fixture.lockedItem.id)
        ?.unlocked,
    ).toBe(true);

    const campaign = campaignOf(fixture);
    expect(campaign.wallet.cleanShards).toBe(75);
    expect(itemOf(fixture, fixture.lockedItem.id).unlocked).toBe(true);
    expect(
      campaign.content.shops
        .find((shop) => shop.id === fixture.shop.id)
        ?.items.find((entry) => entry.itemId === fixture.lockedItem.id)?.stock,
    ).toBe(1);

    // La compra NO añade el objeto al inventario de nadie.
    const character = campaign.content.characters.find(
      (entry) => entry.id === fixture.characterId,
    );
    expect(character?.inventory).toEqual([]);

    // Ahora el objeto aparece en la biblioteca saneada del jugador.
    const state = await getSessionState(fixture);
    expect(
      state.campaign.content.items.some(
        (item) => item.id === fixture.lockedItem.id,
      ),
    ).toBe(true);
  });

  it("no permite recomprar un objeto ya desbloqueado", async () => {
    const fixture = await makeFixture();
    await openShop(fixture);
    await buy(fixture, fixture.playerToken, fixture.lockedItem.id);

    const again = await buy(fixture, fixture.playerToken, fixture.lockedItem.id);
    expectError(again, 409, "item_already_unlocked");
    expect(campaignOf(fixture).wallet.cleanShards).toBe(75);
  });

  it("rechaza sin fondos, sin stock o con el objeto fuera de la tienda", async () => {
    // Sin fondos.
    const noFunds = await makeFixture();
    await openShop(noFunds);
    await app.inject({
      method: "POST",
      url: `/api/campaigns/${noFunds.campaignId}/wallet`,
      headers: token(noFunds.dmToken),
      payload: { delta: -100 },
    });
    expectError(
      await buy(noFunds, noFunds.playerToken, noFunds.lockedItem.id),
      409,
      "insufficient_funds",
    );

    // Stock 0 desde el principio.
    const noStock = await makeFixture();
    const emptyShop = await createShop(noStock.campaignId, noStock.dmToken, {
      name: "Agotada",
      items: [{ itemId: noStock.lockedItem.id, price: 1, stock: 0 }],
    });
    await openShop(noStock, emptyShop.id);
    expectError(
      await buy(noStock, noStock.playerToken, noStock.lockedItem.id),
      409,
      "out_of_stock",
    );

    // El objeto no está en la tienda abierta.
    const fixture = await makeFixture();
    await openShop(fixture);
    expectError(
      await buy(fixture, fixture.playerToken, fixture.unsoldItem.id),
      404,
      "shop_item_not_found",
    );
  });

  it("sin tienda abierta no se puede comprar y el DM no compra", async () => {
    const fixture = await makeFixture();
    expectError(
      await buy(fixture, fixture.playerToken, fixture.lockedItem.id),
      404,
      "shop_not_open",
    );

    await openShop(fixture);
    expectError(
      await buy(fixture, fixture.dmToken, fixture.lockedItem.id),
      403,
      "player_only",
    );
  });

  it("no se puede comprar durante el combate", async () => {
    const fixture = await makeFixture();
    await openShop(fixture);
    built.sessions.setStatus(fixture.sessionId, "combat");
    expectError(
      await buy(fixture, fixture.playerToken, fixture.lockedItem.id),
      423,
      "combat_lock",
    );
  });

  it("empezar un combate cierra la tienda abierta", async () => {
    const fixture = await makeFixture();
    await openShop(fixture);

    const enemy = built.repository.createContent("characters", fixture.campaignId, {
      name: "Hostil",
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
      fixture.campaignId,
      { name: "Emboscada", enemies: [{ characterId: enemy.id }] },
    ) as Encounter;

    built.combat.startEncounter(
      fixture.campaignId,
      encounter.id,
      fixture.sessionId,
      { seed: "seed-tienda", speedRoll: false },
    );
    expect(built.shopScene.getBySession(fixture.sessionId)).toBeNull();
    expect((await getSessionState(fixture)).activeShop).toBeNull();
  });

  it("el desbloqueo y el fondo sobreviven al export/import", async () => {
    const fixture = await makeFixture();
    await openShop(fixture);
    await buy(fixture, fixture.playerToken, fixture.lockedItem.id);

    const exported = await app.inject({
      method: "GET",
      url: `/api/campaigns/${fixture.campaignId}/export`,
      headers: token(fixture.dmToken),
    });
    expect(exported.statusCode, exported.body).toBe(200);
    const campaign = exported.json() as Campaign;

    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/campaigns/import",
      payload: { campaign },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = importedResponse.json() as Campaign;

    expect(
      imported.content.items.find((item) => item.name === "Filo de prueba")
        ?.unlocked,
    ).toBe(true);
    expect(imported.content.shops[0]?.background).toBe("/uploads/mercado.gif");
  });
});
