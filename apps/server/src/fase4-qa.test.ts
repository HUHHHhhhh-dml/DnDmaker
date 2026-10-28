import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  Character,
  CombatState,
  Dungeon,
  Encounter,
  HostSessionResponse,
  Item,
  JoinSessionResponse,
  PublicDungeonRun,
  SessionStateResponse,
  Shop,
  ShopScene,
  Skill,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";
import { createBackup, restoreDatabase } from "./backup";

/**
 * Fase 4E — QA de sesión completa sobre SQLite temporal.
 *
 * Campaña → 2 jugadores → tienda (objeto + skill) → mazmorra con encuentro y
 * cofre (objeto + skill + moneda) → victoria/avance → backup/restore en otra
 * base → reconexión. Todo por HTTP real; nunca se toca `data/protocol-life.sqlite`.
 */

let dir: string;
let built: BuiltApp;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-fase4-qa-"));
  built = await buildApp({
    dbPath: join(dir, "qa.sqlite"),
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

interface QaPlayer {
  token: string;
  playerId: string;
  characterId: string;
  character: Character;
}

interface QaFixture {
  campaignId: string;
  dmToken: string;
  sessionCode: string;
  sessionId: string;
  players: QaPlayer[];
  shopId: string;
  shopItem: Item;
  shopSkill: Skill;
  chestItem: Item;
  chestSkill: Skill;
  dungeonId: string;
  encounterId: string;
  skillId: string;
}

let counter = 0;

async function createPlayer(
  campaignId: string,
  name: string,
  skillId: string,
): Promise<Character> {
  return built.repository.createContent("characters", campaignId, {
    name,
    kind: "player",
    baseStats: { hpMax: 50, def: 0, atk: 200, spd: 10, luck: 0, skillSlots: 2 },
    equipment: {
      horns: null,
      hand: null,
      armor: null,
      leg: null,
      utility: null,
    },
    skills: [skillId, null, null],
    inventory: [],
  }) as Character;
}

async function makeFixture(): Promise<QaFixture> {
  counter += 1;
  const campaign = built.repository.createCampaign({
    name: `QA Fase 4 ${counter}`,
    seed: false,
  });
  const campaignId = campaign.id;
  built.repository.adjustWallet(campaignId, { delta: 100 });

  const shopItem = built.repository.createContent("items", campaignId, {
    name: "Reliquia de tienda",
    slot: "utility",
    unlocked: false,
    price: 10,
  }) as Item;
  const chestItem = built.repository.createContent("items", campaignId, {
    name: "Reliquia del cofre",
    slot: "hand",
    unlocked: false,
    price: 20,
  }) as Item;
  const shopSkill = built.repository.createContent("skills", campaignId, {
    name: "Técnica de tienda",
    coins: 1,
    baseClash: 5,
    coinClash: 1,
    baseDamage: 5,
    coinDamage: 1,
    target: "single",
    unlocked: false,
  }) as Skill;
  const chestSkill = built.repository.createContent("skills", campaignId, {
    name: "Técnica del cofre",
    coins: 1,
    baseClash: 5,
    coinClash: 1,
    baseDamage: 5,
    coinDamage: 1,
    target: "single",
    unlocked: false,
  }) as Skill;
  const combatSkill = built.repository.createContent("skills", campaignId, {
    name: "Golpe de QA",
    coins: 1,
    baseClash: 100,
    coinClash: 0,
    baseDamage: 100,
    coinDamage: 0,
    target: "single",
    unlocked: true,
  }) as Skill;

  const enemy = built.repository.createContent("characters", campaignId, {
    name: "Chatarra de QA",
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
      name: "Guardia de QA",
      enemies: [{ characterId: enemy.id }],
    },
  ) as Encounter;

  const shop = built.repository.createShop(campaignId, {
    name: "Mercado de QA",
    items: [{ itemId: shopItem.id, price: 10, stock: 2 }],
    skills: [{ skillId: shopSkill.id, price: 15, stock: 1 }],
  }) as Shop;

  const dungeon = built.repository.createDungeon(campaignId, {
    name: "Cripta de QA",
    entryRoomId: "qa-room-1",
    rooms: [
      {
        id: "qa-room-1",
        name: "Entrada",
        encounterId: encounter.id,
        background: "/uploads/qa-entrada.png",
      },
      {
        id: "qa-room-2",
        name: "Cámara del tesoro",
        kind: "treasure",
        unlockRewards: true,
        rewards: {
          itemIds: [chestItem.id],
          skillIds: [chestSkill.id],
          currency: 30,
        },
      },
    ],
  }) as Dungeon;

  const characters: Character[] = [];
  for (let index = 0; index < 2; index += 1) {
    characters.push(
      await createPlayer(campaignId, `Jugador QA ${index + 1}`, combatSkill.id),
    );
  }

  const hostedResponse = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/session`,
    payload: {},
  });
  expect(hostedResponse.statusCode, hostedResponse.body).toBe(201);
  const hosted = hostedResponse.json() as HostSessionResponse;

  const players: QaPlayer[] = [];
  for (const [index, character] of characters.entries()) {
    const joinedResponse = await app.inject({
      method: "POST",
      url: `/api/sessions/${hosted.session.code}/join`,
      payload: { name: `Jugador QA ${index + 1}`, characterId: character.id },
    });
    expect(joinedResponse.statusCode, joinedResponse.body).toBe(201);
    const joined = joinedResponse.json() as JoinSessionResponse;
    players.push({
      token: joined.playerToken,
      playerId: joined.player.id,
      characterId: character.id,
      character,
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
    shopId: shop.id,
    shopItem,
    shopSkill,
    chestItem,
    chestSkill,
    dungeonId: dungeon.id,
    encounterId: encounter.id,
    skillId: combatSkill.id,
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

async function getState(
  fixture: QaFixture,
  token: string,
  targetApp = app,
): Promise<SessionStateResponse> {
  const response = await targetApp.inject({
    method: "GET",
    url: `/api/sessions/${fixture.sessionCode}/state`,
    headers: withToken(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as SessionStateResponse;
}

async function getDungeon(
  fixture: QaFixture,
  targetApp = app,
): Promise<PublicDungeonRun | null> {
  const response = await targetApp.inject({
    method: "GET",
    url: `/api/sessions/${fixture.sessionCode}/dungeon`,
    headers: withToken(fixture.dmToken),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as PublicDungeonRun | null;
}

function campaignOf(fixture: QaFixture): Campaign {
  return built.repository.getCampaign(fixture.campaignId);
}

function characterOf(
  fixture: QaFixture,
  characterId: string,
): Character {
  return campaignOf(fixture).content.characters.find(
    (character) => character.id === characterId,
  ) as Character;
}

function winRound(fixture: QaFixture, combatId: string): CombatState {
  const session = built.sessions.getById(fixture.sessionId);
  if (!session) throw new Error("La sesión desapareció.");
  const current = built.combat.getState(combatId);
  const enemyUnit = current.units.find((unit) => unit.team === "enemies");
  if (!enemyUnit) throw new Error("El combate no tiene enemigos.");
  const first = session.players[0];
  if (!first) throw new Error("La sesión no tiene jugadores.");

  built.combat.declareActions({ role: "player", player: first }, combatId, [
    { slot: 1, skillId: fixture.skillId, targetId: enemyUnit.id },
  ]);
  for (const player of session.players.slice(1)) {
    built.combat.declareActions({ role: "player", player }, combatId, []);
  }
  for (const player of session.players) {
    built.combat.lockActions(combatId, { role: "player", player });
  }
  built.combat.lockActions(combatId, { role: "dm" });
  return built.combat.resolveCombatRound(combatId);
}

describe("Fase 4E — sesión completa con 2 jugadores", () => {
  it("tienda, mazmorra, combate, cofre y backup/restore de punta a punta", async () => {
    const fixture = await makeFixture();
    const [playerOne, playerTwo] = fixture.players;
    if (!playerOne || !playerTwo) throw new Error("Faltan jugadores.");

    // --- Tienda: objeto y skill se compran y desbloquean para la campaña ---
    const openShop = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/shop/open`,
      headers: withToken(fixture.dmToken),
      payload: { shopId: fixture.shopId },
    });
    expect(openShop.statusCode, openShop.body).toBe(200);

    const buyItem = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/shop/buy`,
      headers: withToken(playerOne.token),
      payload: { itemId: fixture.shopItem.id },
    });
    expect(buyItem.statusCode, buyItem.body).toBe(200);
    const buySkill = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/shop/buy`,
      headers: withToken(playerOne.token),
      payload: { skillId: fixture.shopSkill.id },
    });
    expect(buySkill.statusCode, buySkill.body).toBe(200);
    expect(campaignOf(fixture).wallet.cleanShards).toBe(75);
    expect(
      campaignOf(fixture).content.items.find(
        (item) => item.id === fixture.shopItem.id,
      )?.unlocked,
    ).toBe(true);
    expect(
      campaignOf(fixture).content.skills.find(
        (skill) => skill.id === fixture.shopSkill.id,
      )?.unlocked,
    ).toBe(true);
    expect(characterOf(fixture, playerOne.characterId).inventory).toHaveLength(0);
    expect(characterOf(fixture, playerOne.characterId).skills).toEqual([
      fixture.skillId,
      null,
      null,
    ]);

    const stateAfterShop = await getState(fixture, playerOne.token);
    expect(
      stateAfterShop.campaign.content.items.some(
        (item) => item.id === fixture.shopItem.id,
      ),
    ).toBe(true);
    expect(
      stateAfterShop.campaign.content.skills.some(
        (skill) => skill.id === fixture.shopSkill.id,
      ),
    ).toBe(true);

    // Un jugador no abre tienda ni dirige la mazmorra.
    const playerOpen = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/shop/open`,
      headers: withToken(playerTwo.token),
      payload: { shopId: fixture.shopId },
    });
    expectError(playerOpen, 403, "dm_only");

    // --- Iniciar mazmorra: cierra la tienda y muestra la escena ---
    const startDungeon = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/start`,
      headers: withToken(fixture.dmToken),
      payload: { dungeonId: fixture.dungeonId },
    });
    expect(startDungeon.statusCode, startDungeon.body).toBe(201);
    const runStart = startDungeon.json() as PublicDungeonRun;
    expect(runStart.currentRoomId).toBe("qa-room-1");
    expect(runStart.pendingAction).toBe("encounter");

    const shopAfterStart = await app.inject({
      method: "GET",
      url: `/api/sessions/${fixture.sessionCode}/shop`,
      headers: withToken(fixture.dmToken),
    });
    expect(shopAfterStart.statusCode).toBe(200);
    expect(shopAfterStart.json()).toBeNull();

    const stateWithRun = await getState(fixture, playerTwo.token);
    expect(stateWithRun.dungeonRun?.currentRoomId).toBe("qa-room-1");
    expect(JSON.stringify(stateWithRun.dungeonRun)).not.toContain("notes");

    const playerStart = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/start`,
      headers: withToken(playerTwo.token),
      payload: { dungeonId: fixture.dungeonId },
    });
    expectError(playerStart, 403, "dm_only");

    // --- Sala de encuentro: combate real y victoria ---
    const startEncounter = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/encounter`,
      headers: withToken(fixture.dmToken),
    });
    expect(startEncounter.statusCode, startEncounter.body).toBe(200);
    const withCombat = startEncounter.json() as PublicDungeonRun;
    const combatId = withCombat.combatId;
    if (!combatId) throw new Error("La run no guardó el combate.");

    const playerEncounter = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/encounter`,
      headers: withToken(playerTwo.token),
    });
    expectError(playerEncounter, 403, "dm_only");

    winRound(fixture, combatId);

    const afterVictory = await getDungeon(fixture);
    expect(afterVictory?.clearedRoomIds).toContain("qa-room-1");
    expect(afterVictory?.combatId).toBeUndefined();
    expect(afterVictory?.canAdvance).toBe(true);

    // --- Avanzar al cofre: objeto + skill + moneda ---
    const advance = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/advance`,
      headers: withToken(fixture.dmToken),
    });
    expect(advance.statusCode, advance.body).toBe(200);
    expect((advance.json() as PublicDungeonRun).currentRoomId).toBe(
      "qa-room-2",
    );

    const chest = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/chest`,
      headers: withToken(fixture.dmToken),
    });
    expect(chest.statusCode, chest.body).toBe(200);
    const chestResult = chest.json() as {
      run: PublicDungeonRun;
      rewards: {
        currency?: number;
        itemIds?: string[];
        unlockedItemIds?: string[];
        unlockedSkillIds?: string[];
      } | null;
    };
    expect(chestResult.rewards?.currency).toBe(30);
    expect(chestResult.rewards?.itemIds).toContain(fixture.chestItem.id);
    expect(chestResult.rewards?.unlockedItemIds).toContain(
      fixture.chestItem.id,
    );
    expect(chestResult.rewards?.unlockedSkillIds).toContain(
      fixture.chestSkill.id,
    );
    expect(chestResult.run.openedRoomIds).toContain("qa-room-2");
    expect(chestResult.run.clearedRoomIds).toContain("qa-room-2");

    expect(campaignOf(fixture).wallet.cleanShards).toBe(105);
    expect(
      campaignOf(fixture).content.skills.find(
        (skill) => skill.id === fixture.chestSkill.id,
      )?.unlocked,
    ).toBe(true);
    for (const player of fixture.players) {
      const character = characterOf(fixture, player.characterId);
      expect(
        character.inventory.find(
          (entry) => entry.itemId === fixture.chestItem.id,
        )?.qty,
      ).toBe(1);
    }

    const chestAgain = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/chest`,
      headers: withToken(fixture.dmToken),
    });
    expectError(chestAgain, 409, "room_already_resolved");

    // --- Backup con la run/tienda/cofre ya aplicados y restore a otra base ---
    const backup = await createBackup({
      dbPath: join(dir, "qa.sqlite"),
      backupsDir: join(dir, "backups"),
    });
    const restoredPath = join(dir, "qa-restored.sqlite");
    const restore = await restoreDatabase({
      backupPath: backup.path,
      dbPath: restoredPath,
      backupsDir: join(dir, "backups"),
    });
    expect(restore.targetPath).toBe(restoredPath);

    const restored = await buildApp({
      dbPath: restoredPath,
      uploadsDir: join(dir, "uploads"),
      webDistDir: join(dir, "no-web-dist"),
      seed: false,
    });
    try {
      // La sesión y el token siguen valiendo tras restaurar.
      const restoredState = await getState(
        fixture,
        playerTwo.token,
        restored.app,
      );
      expect(restoredState.campaign.wallet.cleanShards).toBe(105);
      expect(restoredState.dungeonRun?.openedRoomIds).toContain("qa-room-2");
      expect(
        restoredState.campaign.content.items.some(
          (item) => item.id === fixture.chestItem.id,
        ),
      ).toBe(true);
      expect(
        restoredState.campaign.content.skills.some(
          (skill) => skill.id === fixture.chestSkill.id,
        ),
      ).toBe(true);
      expect(restored.combatStore.get(combatId)?.state.id).toBe(combatId);

      // La run restaurada puede terminar como cualquier otra.
      const end = await restored.app.inject({
        method: "POST",
        url: `/api/sessions/${fixture.sessionCode}/dungeon/end`,
        headers: withToken(fixture.dmToken),
      });
      expect(end.statusCode).toBe(204);
      const afterEnd = await getDungeon(fixture, restored.app);
      expect(afterEnd).toBeNull();
    } finally {
      await restored.app.close();
    }

    // La base original sigue funcionando y también puede terminar la run.
    const originalEnd = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/end`,
      headers: withToken(fixture.dmToken),
    });
    expect(originalEnd.statusCode).toBe(204);
  });

  it("mantiene los permisos de la mesa durante la sesión completa", async () => {
    const fixture = await makeFixture();
    const player = fixture.players[0];
    if (!player) throw new Error("Falta el jugador.");

    const openShop = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/shop/open`,
      headers: withToken(player.token),
      payload: { shopId: fixture.shopId },
    });
    expectError(openShop, 403, "dm_only");

    const startDungeon = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/start`,
      headers: withToken(player.token),
      payload: { dungeonId: fixture.dungeonId },
    });
    expectError(startDungeon, 403, "dm_only");

    await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/start`,
      headers: withToken(fixture.dmToken),
      payload: { dungeonId: fixture.dungeonId },
    });

    for (const action of ["encounter", "rest", "chest", "advance", "end"] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/sessions/${fixture.sessionCode}/dungeon/${action}`,
        headers: withToken(player.token),
      });
      expectError(response, 403, "dm_only");
    }

    // El DM sí puede terminar su propia run.
    const end = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/end`,
      headers: withToken(fixture.dmToken),
    });
    expect(end.statusCode).toBe(204);
  });
});
