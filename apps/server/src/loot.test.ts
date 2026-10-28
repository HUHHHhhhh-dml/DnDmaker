import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  CampaignSettings,
  Character,
  CombatState,
  Encounter,
  HostSessionResponse,
  Item,
  JoinSessionResponse,
  LootDraft,
  SessionStateResponse,
} from "@protocol-life/shared";
import { lootTurnCharacter } from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";

/**
 * Fase 4A-2 — reparto de botín por turnos.
 *
 * Usa SQLite temporal (`mkdtemp`) y las rutas HTTP reales. El combate se gana
 * en una ronda declarando con el primer jugador (skill fuerte + enemigo débil).
 */

let dir: string;
let built: BuiltApp;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-loot-"));
  built = await buildApp({
    dbPath: join(dir, "loot.sqlite"),
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
  characterId: string;
  name: string;
  spd: number;
}

interface Fixture {
  campaignId: string;
  dmToken: string;
  sessionCode: string;
  sessionId: string;
  players: PlayerFixture[];
  items: Item[];
}

const SPEEDS = [20, 15, 10] as const;
let fixtureCounter = 0;

async function makeFixture(options: {
  shareLoot?: boolean;
  players?: number;
  items?: number;
} = {}): Promise<Fixture> {
  fixtureCounter += 1;
  const playerCount = options.players ?? 2;
  const itemCount = options.items ?? 2;
  const settings: Partial<CampaignSettings> =
    options.shareLoot === undefined ? {} : { shareLoot: options.shareLoot };

  const campaign = built.repository.createCampaign({
    name: `Botín ${fixtureCounter}`,
    seed: false,
    settings,
  });
  const campaignId = campaign.id;

  const items: Item[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    items.push(
      built.repository.createContent("items", campaignId, {
        name: `Botín ${index + 1}`,
        slot: "utility",
        unlocked: true,
      }) as Item,
    );
  }

  const characters: Character[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    characters.push(
      built.repository.createContent("characters", campaignId, {
        name: `Jugador ${index + 1}`,
        kind: "player",
        baseStats: {
          hpMax: 50,
          def: 0,
          atk: 20,
          spd: SPEEDS[index] ?? 10,
          luck: 0,
          skillSlots: 2,
        },
        equipment: {
          horns: null,
          hand: null,
          armor: null,
          leg: null,
          utility: null,
        },
        skills: [null, null, null],
        inventory: [],
      }) as Character,
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
    const joined = await app.inject({
      method: "POST",
      url: `/api/sessions/${hosted.session.code}/join`,
      payload: { name: `P${index + 1}`, characterId: character.id },
    });
    expect(joined.statusCode, joined.body).toBe(201);
    const body = joined.json() as JoinSessionResponse;
    players.push({
      token: body.playerToken,
      playerId: body.player.id,
      characterId: character.id,
      name: character.name,
      spd: SPEEDS[index] ?? 10,
    });
  }
  for (const player of players) {
    built.sessions.markPlayerConnected(
      hosted.session.code,
      player.playerId,
      true,
    );
  }

  return {
    campaignId,
    dmToken: hosted.dmToken,
    sessionCode: hosted.session.code,
    sessionId: hosted.session.id,
    players,
    items,
  };
}

function withToken(token?: string): Record<string, string> {
  return token ? { "x-session-token": token } : {};
}

async function prepareEncounter(
  fixture: Fixture,
  options: { currency?: number; itemIds?: string[] } = {},
): Promise<{ encounterId: string; skillId: string }> {
  const campaignId = fixture.campaignId;
  const skill = built.repository.createContent("skills", campaignId, {
    name: "Golpe de prueba",
    coins: 1,
    baseClash: 100,
    coinClash: 0,
    baseDamage: 200,
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

  const encounter = built.repository.createContent("encounters", campaignId, {
    name: "Emboscada de botín",
    enemies: [{ characterId: enemy.id }],
    rewards: {
      currency: options.currency ?? 30,
      itemIds: options.itemIds ?? fixture.items.map((item) => item.id),
    },
  }) as Encounter;

  const first = fixture.players[0];
  if (!first) throw new Error("El fixture no tiene jugadores.");
  built.repository.updateContent("characters", first.characterId, {
    skills: [skill.id, null, null],
    baseStats: {
      hpMax: 50,
      def: 0,
      atk: 200,
      spd: first.spd,
      luck: 0,
      skillSlots: 2,
    },
  });

  return { encounterId: encounter.id, skillId: skill.id };
}

/** Gana el combate en una ronda. Devuelve el estado final del combate. */
async function winCombat(
  fixture: Fixture,
  options: { currency?: number; itemIds?: string[] } = {},
): Promise<CombatState> {
  const prepared = await prepareEncounter(fixture, options);
  const state = built.combat.startEncounter(
    fixture.campaignId,
    prepared.encounterId,
    fixture.sessionId,
    { seed: "seed-loot", speedRoll: false },
  );
  const session = built.sessions.getById(fixture.sessionId);
  if (!session) throw new Error("La sesión desapareció.");
  const firstPlayer = session.players[0];
  const enemyUnit = state.units.find((unit) => unit.team === "enemies");
  if (!firstPlayer || !enemyUnit) throw new Error("Escenario incompleto.");

  built.combat.declareActions(
    { role: "player", player: firstPlayer },
    state.id,
    [{ slot: 1, skillId: prepared.skillId, targetId: enemyUnit.id }],
  );
  for (const player of session.players.slice(1)) {
    built.combat.declareActions({ role: "player", player }, state.id, []);
  }
  for (const player of session.players) {
    built.combat.lockActions(state.id, { role: "player", player });
  }
  built.combat.lockActions(state.id, { role: "dm" });
  return built.combat.resolveCombatRound(state.id);
}

async function getLoot(fixture: Fixture, token = fixture.players[0]?.token) {
  return app.inject({
    method: "GET",
    url: `/api/sessions/${fixture.sessionCode}/loot`,
    headers: withToken(token),
  });
}

async function pick(
  fixture: Fixture,
  token: string | undefined,
  itemIndex: number,
) {
  return app.inject({
    method: "POST",
    url: `/api/sessions/${fixture.sessionCode}/loot/pick`,
    headers: withToken(token),
    payload: { itemIndex },
  });
}

async function dmAction(
  fixture: Fixture,
  action: "skip" | "close",
  token = fixture.dmToken,
) {
  return app.inject({
    method: "POST",
    url: `/api/sessions/${fixture.sessionCode}/loot/${action}`,
    headers: withToken(token),
    payload: {},
  });
}

function playerCharacter(fixture: Fixture, player: PlayerFixture): Character {
  const campaign = built.repository.getCampaign(fixture.campaignId);
  const found = campaign.content.characters.find(
    (character) => character.id === player.characterId,
  );
  if (!found) throw new Error("Personaje no encontrado.");
  return found;
}

function inventoryOf(character: Character, itemId: string): number {
  return (
    character.inventory.find((entry) => entry.itemId === itemId)?.qty ?? 0
  );
}

/* -------------------------------------------------------------------------- */
/* Creación del reparto                                                       */
/* -------------------------------------------------------------------------- */

describe("Fase 4A-2 — creación del reparto", () => {
  it("el DM puede desactivar el reparto desde los ajustes", async () => {
    const fixture = await makeFixture({ players: 2, items: 1 });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${fixture.campaignId}`,
      headers: withToken(fixture.dmToken),
      payload: { settings: { shareLoot: false } },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((patched.json() as Campaign).settings.shareLoot).toBe(false);

    await winCombat(fixture);
    expect((await getLoot(fixture)).json()).not.toBeNull();
  });

  it("con shareLoot por defecto no hay reparto y todos reciben los objetos", async () => {
    const fixture = await makeFixture({ players: 2, items: 2 });
    const state = await winCombat(fixture);

    expect(state.rewardSummary?.pendingItemIds).toBeUndefined();
    expect(state.rewardSummary?.lootDraftId).toBeUndefined();
    for (const player of fixture.players) {
      const character = playerCharacter(fixture, player);
      for (const item of fixture.items) {
        expect(inventoryOf(character, item.id)).toBe(1);
      }
    }
    const loot = await getLoot(fixture);
    expect(loot.statusCode).toBe(200);
    expect(loot.json()).toBeNull();
  });

  it("con shareLoot off crea el reparto, paga la moneda y no entrega objetos", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 2,
      items: 2,
    });
    const state = await winCombat(fixture, { currency: 30 });

    expect(state.rewardSummary).toMatchObject({
      currency: 30,
      pendingItemIds: fixture.items.map((item) => item.id),
    });
    expect(state.rewardSummary?.lootDraftId).toBeTruthy();

    const campaign = built.repository.getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(30);
    for (const player of fixture.players) {
      expect(playerCharacter(fixture, player).inventory).toEqual([]);
    }

    const loot = await getLoot(fixture);
    expect(loot.statusCode, loot.body).toBe(200);
    const draft = loot.json() as LootDraft;
    expect(draft.status).toBe("active");
    expect(draft.pool).toEqual(fixture.items.map((item) => item.id));
    // Orden por SPD descendente.
    expect(draft.order).toEqual(
      [...fixture.players]
        .sort((a, b) => b.spd - a.spd)
        .map((player) => player.characterId),
    );
    expect(draft.round).toBe(1);
    expect(draft.turnIndex).toBe(0);
  });

  it("con un solo jugador entrega los objetos sin reparto", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 1,
      items: 2,
    });
    const state = await winCombat(fixture);

    expect(state.rewardSummary?.pendingItemIds).toBeUndefined();
    const character = playerCharacter(fixture, fixture.players[0]!);
    for (const item of fixture.items) {
      expect(inventoryOf(character, item.id)).toBe(1);
    }
    const loot = await getLoot(fixture);
    expect(loot.json()).toBeNull();
  });

  it("el estado de la sesión incluye el reparto activo para reconectar", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 2,
      items: 1,
    });
    await winCombat(fixture);

    const stateResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${fixture.sessionCode}/state`,
      headers: withToken(fixture.players[0]?.token),
    });
    expect(stateResponse.statusCode, stateResponse.body).toBe(200);
    const payload = stateResponse.json() as SessionStateResponse;
    expect(payload.lootDraft?.status).toBe("active");
    expect(payload.lootDraft?.pool).toHaveLength(1);
  });

  it("empezar otro combate cierra el reparto pendiente", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 2,
      items: 2,
    });
    await winCombat(fixture);
    expect((await getLoot(fixture)).json()).not.toBeNull();

    const prepared = await prepareEncounter(fixture);
    built.combat.startEncounter(
      fixture.campaignId,
      prepared.encounterId,
      fixture.sessionId,
      { seed: "seed-loot-2", speedRoll: false },
    );

    const loot = await getLoot(fixture);
    expect(loot.json()).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Turnos                                                                     */
/* -------------------------------------------------------------------------- */

describe("Fase 4A-2 — turnos y entrega", () => {
  it("solo el jugador del turno elige, y el objeto va a su inventario", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 2,
      items: 2,
    });
    await winCombat(fixture);
    const draft = (await getLoot(fixture)).json() as LootDraft;
    const first = fixture.players.find(
      (player) => player.characterId === draft.order[0],
    );
    const other = fixture.players.find(
      (player) => player.characterId !== draft.order[0],
    );
    if (!first || !other) throw new Error("Jugadores no encontrados.");

    const outOfTurn = await pick(fixture, other.token, 0);
    expect(outOfTurn.statusCode).toBe(409);
    expect((outOfTurn.json() as { error: { code: string } }).error.code).toBe(
      "not_your_turn",
    );

    const response = await pick(fixture, first.token, 0);
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json() as { draft: LootDraft; itemId: string };
    expect(result.draft.pool).toHaveLength(1);
    expect(result.draft.turnIndex).toBe(1);
    expect(playerCharacter(fixture, first).inventory).toEqual([
      { itemId: result.itemId, qty: 1 },
    ]);
    // El otro jugador sigue sin objetos.
    expect(playerCharacter(fixture, other).inventory).toEqual([]);
  });

  it("el DM no puede elegir por los jugadores", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 2,
      items: 1,
    });
    await winCombat(fixture);

    const response = await pick(fixture, fixture.dmToken, 0);
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "dm_cannot_pick",
    );
  });

  it("el reparto es serpiente entre rondas", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 2,
      items: 3,
    });
    await winCombat(fixture);

    const order: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      const current = (await getLoot(fixture)).json() as LootDraft;
      const turnCharacterId = lootTurnCharacter(current);
      const chooser = fixture.players.find(
        (player) => player.characterId === turnCharacterId,
      );
      if (!chooser) throw new Error("Sin jugador en el turno.");
      order.push(chooser.name);
      const response = await pick(fixture, chooser.token, 0);
      expect(response.statusCode, response.body).toBe(200);
    }

    const fast = fixture.players[0]?.name;
    const slow = fixture.players[1]?.name;
    // Ronda 1: rápido, lento. Ronda 2 (invertida): lento.
    expect(order).toEqual([fast, slow, slow]);
    const final = (await getLoot(fixture)).json() as LootDraft | null;
    expect(final).toBeNull();
  });

  it("el DM puede saltar el turno sin gastar objeto", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 2,
      items: 2,
    });
    await winCombat(fixture);
    const before = (await getLoot(fixture)).json() as LootDraft;

    const response = await dmAction(fixture, "skip");
    expect(response.statusCode, response.body).toBe(200);
    const next = response.json() as LootDraft;
    expect(next.pool).toEqual(before.pool);
    expect(next.turnIndex).toBe(1);
    expect(next.picks).toEqual([]);
  });

  it("cerrar el reparto deja lo no elegido sin asignar", async () => {
    const fixture = await makeFixture({
      shareLoot: false,
      players: 2,
      items: 2,
    });
    await winCombat(fixture);
    const draft = (await getLoot(fixture)).json() as LootDraft;
    const chooser = fixture.players.find(
      (player) => player.characterId === draft.order[0],
    );
    if (!chooser) throw new Error("Sin jugador.");

    await pick(fixture, chooser.token, 0);
    const closed = await dmAction(fixture, "close");
    expect(closed.statusCode, closed.body).toBe(200);
    expect((closed.json() as LootDraft).status).toBe("done");

    // Ya no hay reparto activo y el objeto restante no está en ningún inventario.
    expect((await getLoot(fixture)).json()).toBeNull();
    const campaign = built.repository.getCampaign(fixture.campaignId);
    for (const player of fixture.players) {
      const character = campaign.content.characters.find(
        (entry) => entry.id === player.characterId,
      );
      if (!character) throw new Error("Personaje no encontrado.");
      for (const item of fixture.items) {
        expect(inventoryOf(character, item.id)).toBeLessThanOrEqual(1);
      }
    }

    // Cualquier intento posterior no encuentra reparto.
    const late = await pick(fixture, chooser.token, 0);
    expect(late.statusCode).toBe(404);
  });
});
