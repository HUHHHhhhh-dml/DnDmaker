import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { io as ioClient, type Socket } from "socket.io-client";
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
  Skill,
  StateFullPayload,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";

/**
 * Fase 4C — recorrido de la dungeon lineal+.
 *
 * SQLite temporal (`mkdtemp`), rutas HTTP reales, servicio de combate real y
 * un socket para comprobar `state:full`. No se toca `data/protocol-life.sqlite`.
 */

let dir: string;
let built: BuiltApp;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-dungeon-run-"));
  built = await buildApp({
    dbPath: join(dir, "dungeon-run.sqlite"),
    uploadsDir: join(dir, "uploads"),
    webDistDir: join(dir, "no-web-dist"),
    seed: false,
  });
  app = built.app;
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
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
  encounterId: string;
  skillId: string;
  dungeon: Dungeon;
  shortDungeon: Dungeon;
}

let fixtureCounter = 0;

async function createPlayerCharacter(
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

async function makeFixture(playerCount = 2): Promise<Fixture> {
  fixtureCounter += 1;
  const campaign = built.repository.createCampaign({
    name: `Dungeon run ${fixtureCounter}`,
    seed: false,
  });
  const campaignId = campaign.id;

  const itemA = built.repository.createContent("items", campaignId, {
    name: "Reliquia del trono",
    slot: "utility",
    unlocked: true,
    price: 10,
  }) as Item;
  const itemB = built.repository.createContent("items", campaignId, {
    name: "Cable de cobre",
    slot: "utility",
    unlocked: true,
    price: 3,
  }) as Item;

  const skill = built.repository.createContent("skills", campaignId, {
    name: "Golpe de prueba",
    coins: 1,
    baseClash: 100,
    coinClash: 0,
    baseDamage: 100,
    coinDamage: 0,
    target: "single",
  }) as Skill;

  const enemy = built.repository.createContent("characters", campaignId, {
    name: "Centinela de la cripta",
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
      name: "Guardia de la cripta",
      enemies: [{ characterId: enemy.id }],
    },
  ) as Encounter;

  const dungeon = built.repository.createDungeon(campaignId, {
    name: "Cripta del protocolo",
    description: "Una run de prueba de cuatro salas",
    entryRoomId: "room-1",
    rooms: [
      {
        id: "room-1",
        name: "Entrada",
        description: "La puerta de la cripta.",
        notes: "SECRETO-SOLO-DM",
        encounterId: encounter.id,
        background: "/uploads/cripta.png",
      },
      { id: "room-2", name: "Fogata", kind: "rest" },
      {
        id: "room-3",
        name: "Cofre",
        kind: "treasure",
        rewards: { itemIds: [itemA.id], currency: 25, notes: "Cofre antiguo" },
      },
      {
        id: "room-4",
        name: "Trono",
        kind: "boss",
        description: "El trono vacío.",
        encounterId: encounter.id,
      },
    ],
  });

  const shortDungeon = built.repository.createDungeon(campaignId, {
    name: "Sala única",
    entryRoomId: "short-1",
    rooms: [{ id: "short-1", name: "Fogata final", kind: "rest" }],
  });

  const characters: Character[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    characters.push(
      await createPlayerCharacter(
        campaignId,
        `Jugador ${index + 1}`,
        skill.id,
      ),
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
      payload: { name: `Jugador ${index + 1}`, characterId: character.id },
    });
    expect(joinedResponse.statusCode, joinedResponse.body).toBe(201);
    const joined = joinedResponse.json() as JoinSessionResponse;
    players.push({
      token: joined.playerToken,
      playerId: joined.player.id,
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
    itemA,
    itemB,
    encounterId: encounter.id,
    skillId: skill.id,
    dungeon,
    shortDungeon,
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

async function getDungeon(
  fixture: Fixture,
  token?: string,
): Promise<{ statusCode: number; run: PublicDungeonRun | null }> {
  const response = await app.inject({
    method: "GET",
    url: `/api/sessions/${fixture.sessionCode}/dungeon`,
    headers: withToken(token ?? fixture.dmToken),
  });
  expect(response.statusCode, response.body).toBe(200);
  return {
    statusCode: response.statusCode,
    run: response.json() as PublicDungeonRun | null,
  };
}

async function startRun(
  fixture: Fixture,
  input: { dungeonId?: string; entryRoomId?: string } = {},
): Promise<{ statusCode: number; body: unknown; run?: PublicDungeonRun }> {
  const response = await app.inject({
    method: "POST",
    url: `/api/sessions/${fixture.sessionCode}/dungeon/start`,
    headers: withToken(fixture.dmToken),
    payload: {
      dungeonId: input.dungeonId ?? fixture.dungeon.id,
      ...(input.entryRoomId ? { entryRoomId: input.entryRoomId } : {}),
    },
  });
  return {
    statusCode: response.statusCode,
    body: response.json(),
    run: response.statusCode === 201 ? (response.json() as PublicDungeonRun) : undefined,
  };
}

async function postAction(
  fixture: Fixture,
  action: "encounter" | "rest" | "chest" | "advance" | "end",
  token?: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: "POST",
    url: `/api/sessions/${fixture.sessionCode}/dungeon/${action}`,
    headers: withToken(token ?? fixture.dmToken),
  });
  return {
    statusCode: response.statusCode,
    body: response.body ? response.json() : null,
  };
}

async function getState(
  fixture: Fixture,
  token: string,
): Promise<SessionStateResponse> {
  const response = await app.inject({
    method: "GET",
    url: `/api/sessions/${fixture.sessionCode}/state`,
    headers: withToken(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as SessionStateResponse;
}

function winRound(fixture: Fixture, combatId: string): CombatState {
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

function characterById(campaignId: string, characterId: string): Character {
  const campaign = built.repository.getCampaign(campaignId);
  const character = campaign.content.characters.find(
    (entry) => entry.id === characterId,
  );
  if (!character) throw new Error(`No existe la ficha ${characterId}`);
  return character;
}

function itemQty(character: Character, itemId: string): number {
  return (
    character.inventory.find((entry) => entry.itemId === itemId)?.qty ?? 0
  );
}

function once<T>(socket: Socket, event: string, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event);
      reject(new Error(`Timeout esperando ${event}`));
    }, timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Inicio y escena                                                            */
/* -------------------------------------------------------------------------- */

describe("Fase 4C — inicio y escena de la run", () => {
  it("el DM inicia la run y el jugador recibe la sala sin notas privadas", async () => {
    const fixture = await makeFixture();
    const started = await startRun(fixture);
    expect(started.statusCode, JSON.stringify(started.body)).toBe(201);
    const run = started.run;
    if (!run) throw new Error("No se devolvió la run.");

    expect(run.id).toMatch(/^run/);
    expect(run.dungeonName).toBe("Cripta del protocolo");
    expect(run.currentRoomId).toBe("room-1");
    expect(run.rooms.map((room) => room.id)).toEqual([
      "room-1",
      "room-2",
      "room-3",
      "room-4",
    ]);
    expect(run.rooms.map((room) => room.kind)).toEqual([
      "encounter",
      "rest",
      "treasure",
      "boss",
    ]);
    expect(run.pendingAction).toBe("encounter");
    expect(run.canAdvance).toBe(false);
    expect(run.clearedRoomIds).toEqual([]);

    const serialized = JSON.stringify(run);
    expect(serialized).not.toContain("SECRETO-SOLO-DM");
    expect(run.rooms[0]?.background).toBe("/uploads/cripta.png");
    expect(run.rooms[0]?.hasEncounter).toBe(true);
    expect(run.rooms[2]?.hasRewards).toBe(true);

    // El jugador puede leer la escena, pero no dirigirla.
    const playerView = await getDungeon(fixture, fixture.players[0]?.token);
    expect(playerView.run?.id).toBe(run.id);
    const playerStart = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/start`,
      headers: withToken(fixture.players[0]?.token),
      payload: { dungeonId: fixture.dungeon.id },
    });
    expectError(playerStart, 403, "dm_only");

    // GET /state también incluye la run para reconexión.
    const state = await getState(fixture, fixture.players[0]?.token ?? "");
    expect(state.dungeonRun?.id).toBe(run.id);
  });

  it("valida la mazmorra y la sala de entrada", async () => {
    const fixture = await makeFixture();

    const missingDungeon = await startRun(fixture, { dungeonId: "dgn_nope" });
    expectError(
      { statusCode: missingDungeon.statusCode, json: () => missingDungeon.body },
      404,
      "dungeon_not_found",
    );

    const missingRoom = await startRun(fixture, { entryRoomId: "room-nope" });
    expectError(
      { statusCode: missingRoom.statusCode, json: () => missingRoom.body },
      404,
      "room_not_found",
    );

    // Empezar de nuevo reemplaza la run anterior (una por sesión).
    const first = await startRun(fixture);
    const second = await startRun(fixture, {
      dungeonId: fixture.shortDungeon.id,
    });
    expect(second.run?.dungeonId).toBe(fixture.shortDungeon.id);
    expect(second.run?.id).not.toBe(first.run?.id);
    const current = await getDungeon(fixture);
    expect(current.run?.dungeonId).toBe(fixture.shortDungeon.id);
    expect(current.run?.currentRoomId).toBe("short-1");
  });

  it("borrar la mazmorra activa termina la run", async () => {
    const fixture = await makeFixture();
    await startRun(fixture);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/campaigns/${fixture.campaignId}/dungeons/${fixture.dungeon.id}`,
      headers: withToken(fixture.dmToken),
    });
    expect(removed.statusCode, removed.body).toBe(204);

    expect((await getDungeon(fixture)).run).toBeNull();
    const state = await getState(fixture, fixture.players[0]?.token ?? "");
    expect(state.dungeonRun).toBeNull();
  });

  it("reconexión: state:full incluye la run activa", async () => {
    const fixture = await makeFixture();
    const started = await startRun(fixture);
    if (!started.run) throw new Error("No se devolvió la run.");

    const socket = ioClient(baseUrl, {
      auth: { code: fixture.sessionCode, token: fixture.dmToken },
      transports: ["websocket"],
      forceNew: true,
      autoConnect: false,
    });
    try {
      const fullPromise = once<StateFullPayload>(socket, "state:full");
      socket.connect();
      await once(socket, "connect");
      const full = await fullPromise;
      expect(full.role).toBe("dm");
      expect(full.dungeonRun?.id).toBe(started.run.id);

      // El evento `dungeon:state` llega a la sala al terminar la run.
      const ended = once<{ run: PublicDungeonRun | null }>(
        socket,
        "dungeon:state",
      );
      const end = await postAction(fixture, "end");
      expect(end.statusCode).toBe(204);
      expect((await ended).run).toBeNull();
    } finally {
      socket.disconnect();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Salas: encuentro, descanso y cofre                                         */
/* -------------------------------------------------------------------------- */

describe("Fase 4C — resolución de salas", () => {
  it("no avanza con la sala pendiente; ganar el combate la supera", async () => {
    const fixture = await makeFixture();
    await startRun(fixture);

    const blocked = await postAction(fixture, "advance");
    expectError(
      { statusCode: blocked.statusCode, json: () => blocked.body },
      409,
      "room_pending",
    );

    const encounter = await postAction(fixture, "encounter");
    expect(encounter.statusCode, JSON.stringify(encounter.body)).toBe(200);
    const withCombat = encounter.body as PublicDungeonRun;
    expect(withCombat.combatId).toMatch(/^cmb/);

    const state = await getState(fixture, fixture.players[0]?.token ?? "");
    expect(state.dungeonRun?.combatId).toBe(withCombat.combatId);

    const combatId = withCombat.combatId;
    if (!combatId) throw new Error("La run no guardó el combate.");
    winRound(fixture, combatId);

    const afterVictory = await getDungeon(fixture);
    expect(afterVictory.run?.clearedRoomIds).toContain("room-1");
    expect(afterVictory.run?.combatId).toBeUndefined();
    expect(afterVictory.run?.canAdvance).toBe(true);

    const advanced = await postAction(fixture, "advance");
    expect(advanced.statusCode, JSON.stringify(advanced.body)).toBe(200);
    const next = advanced.body as PublicDungeonRun;
    expect(next.currentRoomId).toBe("room-2");
    expect(next.pendingAction).toBe("rest");
  });

  it("sin victoria la sala no se supera, pero se puede reintentar", async () => {
    const fixture = await makeFixture();
    await startRun(fixture);

    const encounter = await postAction(fixture, "encounter");
    const run = encounter.body as PublicDungeonRun;
    const combatId = run.combatId;
    if (!combatId) throw new Error("La run no guardó el combate.");

    // El DM cierra el combate sin ganador: nadie ha ganado.
    built.combat.endEncounter(combatId, "dm");

    const after = await getDungeon(fixture);
    expect(after.run?.clearedRoomIds).toEqual([]);
    expect(after.run?.combatId).toBeUndefined();
    expect(after.run?.canAdvance).toBe(false);

    const blocked = await postAction(fixture, "advance");
    expectError(
      { statusCode: blocked.statusCode, json: () => blocked.body },
      409,
      "room_pending",
    );

    const retry = await postAction(fixture, "encounter");
    expect(retry.statusCode, JSON.stringify(retry.body)).toBe(200);
    expect((retry.body as PublicDungeonRun).combatId).toMatch(/^cmb/);
  });

  it("el descanso cura una vez y supera la sala", async () => {
    const fixture = await makeFixture();
    // La entrada explícita permite probar la sala de descanso sin combatir.
    await startRun(fixture, { entryRoomId: "room-2" });

    for (const player of fixture.players) {
      built.repository.setCharacterCurrentHp(player.character.id, 1);
    }

    const rest = await postAction(fixture, "rest");
    expect(rest.statusCode, JSON.stringify(rest.body)).toBe(200);
    const run = rest.body as PublicDungeonRun;
    expect(run.clearedRoomIds).toContain("room-2");
    expect(run.restedRoomIds).toContain("room-2");
    expect(run.pendingAction).toBeNull();
    expect(run.canAdvance).toBe(true);

    for (const player of fixture.players) {
      const healed = characterById(fixture.campaignId, player.character.id);
      expect(healed.hpCurrent).toBe(50);
    }

    const again = await postAction(fixture, "rest");
    expectError(
      { statusCode: again.statusCode, json: () => again.body },
      409,
      "room_already_resolved",
    );
  });

  it("el cofre entrega moneda y objetos una vez con shareLoot ON", async () => {
    const fixture = await makeFixture();
    await startRun(fixture, { entryRoomId: "room-3" });

    const chest = await postAction(fixture, "chest");
    expect(chest.statusCode, JSON.stringify(chest.body)).toBe(200);
    const result = chest.body as {
      run: PublicDungeonRun;
      rewards: { currency?: number; itemIds?: string[] } | null;
    };
    expect(result.run.openedRoomIds).toContain("room-3");
    expect(result.run.clearedRoomIds).toContain("room-3");
    expect(result.rewards?.currency).toBe(25);
    expect(result.rewards?.itemIds).toContain(fixture.itemA.id);

    const campaign = built.repository.getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(25);
    for (const player of fixture.players) {
      const character = characterById(fixture.campaignId, player.character.id);
      expect(itemQty(character, fixture.itemA.id)).toBe(1);
    }

    const again = await postAction(fixture, "chest");
    expectError(
      { statusCode: again.statusCode, json: () => again.body },
      409,
      "room_already_resolved",
    );

    // El cofre no se reabre al recargar la run.
    const current = await getDungeon(fixture);
    expect(current.run?.openedRoomIds).toContain("room-3");
  });

  it("con shareLoot OFF el cofre crea un reparto y no entrega objetos", async () => {
    const fixture = await makeFixture();
    built.repository.updateCampaign(fixture.campaignId, {
      settings: { shareLoot: false },
    });
    await startRun(fixture, { entryRoomId: "room-3" });

    const chest = await postAction(fixture, "chest");
    expect(chest.statusCode, JSON.stringify(chest.body)).toBe(200);
    const result = chest.body as {
      run: PublicDungeonRun;
      rewards: { currency?: number; pendingItemIds?: string[]; lootDraftId?: string } | null;
    };
    expect(result.rewards?.currency).toBe(25);
    expect(result.rewards?.pendingItemIds).toEqual([fixture.itemA.id]);
    expect(result.rewards?.lootDraftId).toBeDefined();

    const campaign = built.repository.getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(25);
    for (const player of fixture.players) {
      const character = characterById(fixture.campaignId, player.character.id);
      expect(itemQty(character, fixture.itemA.id)).toBe(0);
    }

    const state = await getState(fixture, fixture.dmToken);
    expect(state.lootDraft?.pool).toEqual([fixture.itemA.id]);
    expect(state.lootDraft?.status).toBe("active");
    expect(state.dungeonRun?.openedRoomIds).toContain("room-3");
  });

  it("una sala de ambientación no bloquea el avance", async () => {
    const fixture = await makeFixture();
    const ambient = built.repository.createDungeon(fixture.campaignId, {
      name: "Pasillo de ambientación",
      entryRoomId: "ambient-1",
      rooms: [
        { id: "ambient-1", name: "Pasillo" },
        { id: "ambient-2", name: "Fogata", kind: "rest" },
      ],
    });

    const started = await startRun(fixture, { dungeonId: ambient.id });
    expect(started.run?.pendingAction).toBeNull();
    expect(started.run?.canAdvance).toBe(true);

    const advance = await postAction(fixture, "advance");
    expect(advance.statusCode, JSON.stringify(advance.body)).toBe(200);
    expect((advance.body as PublicDungeonRun).currentRoomId).toBe("ambient-2");
  });

  it("con shareLoot OFF y un solo jugador entrega los objetos igual", async () => {
    const fixture = await makeFixture(1);
    built.repository.updateCampaign(fixture.campaignId, {
      settings: { shareLoot: false },
    });
    await startRun(fixture, { entryRoomId: "room-3" });

    const chest = await postAction(fixture, "chest");
    expect(chest.statusCode, JSON.stringify(chest.body)).toBe(200);
    const result = chest.body as {
      run: PublicDungeonRun;
      rewards: { pendingItemIds?: string[] } | null;
    };
    expect(result.rewards?.pendingItemIds).toBeUndefined();

    const campaign = built.repository.getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(25);
    const onlyPlayer = fixture.players[0];
    if (!onlyPlayer) throw new Error("Falta el jugador.");
    const character = characterById(fixture.campaignId, onlyPlayer.character.id);
    expect(itemQty(character, fixture.itemA.id)).toBe(1);

    const state = await getState(fixture, fixture.dmToken);
    expect(state.lootDraft).toBeNull();
  });

  it("un cofre con unlockRewards desbloquea para la campaña además de entregar", async () => {
    const fixture = await makeFixture();
    const locked = built.repository.createContent("items", fixture.campaignId, {
      name: "Plano prohibido",
      slot: "utility",
      unlocked: false,
      price: 50,
    }) as Item;
    const unlockDungeon = built.repository.createDungeon(fixture.campaignId, {
      name: "Cámara de planos",
      entryRoomId: "unlock-1",
      rooms: [
        {
          id: "unlock-1",
          name: "Plano sellado",
          kind: "treasure",
          unlockRewards: true,
          rewards: { itemIds: [locked.id], currency: 10 },
        },
      ],
    });

    // Antes de abrirlo, el objeto bloqueado no viaja al jugador.
    const before = await getState(fixture, fixture.players[0]?.token ?? "");
    expect(
      before.campaign.content.items.some((item) => item.id === locked.id),
    ).toBe(false);

    await startRun(fixture, { dungeonId: unlockDungeon.id });
    const chest = await postAction(fixture, "chest");
    expect(chest.statusCode, JSON.stringify(chest.body)).toBe(200);
    const result = chest.body as {
      run: PublicDungeonRun;
      rewards: {
        currency?: number;
        itemIds?: string[];
        unlockedItemIds?: string[];
      } | null;
    };
    expect(result.rewards?.currency).toBe(10);
    // A entrega el objeto y además lo desbloquea para la campaña.
    expect(result.rewards?.itemIds).toContain(locked.id);
    expect(result.rewards?.unlockedItemIds).toContain(locked.id);

    const campaign = built.repository.getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(10);
    expect(
      campaign.content.items.find((item) => item.id === locked.id)?.unlocked,
    ).toBe(true);
    for (const player of fixture.players) {
      const character = characterById(fixture.campaignId, player.character.id);
      expect(itemQty(character, locked.id)).toBe(1);
    }

    // Ya desbloqueado, el objeto aparece en la campaña saneada del jugador.
    const after = await getState(fixture, fixture.players[0]?.token ?? "");
    expect(
      after.campaign.content.items.some((item) => item.id === locked.id),
    ).toBe(true);

    const again = await postAction(fixture, "chest");
    expectError(
      { statusCode: again.statusCode, json: () => again.body },
      409,
      "room_already_resolved",
    );
  });

  it("unlockRewards desbloquea también con shareLoot OFF y loot draft", async () => {
    const fixture = await makeFixture();
    built.repository.updateCampaign(fixture.campaignId, {
      settings: { shareLoot: false },
    });
    const locked = built.repository.createContent("items", fixture.campaignId, {
      name: "Plano compartido",
      slot: "utility",
      unlocked: false,
      price: 50,
    }) as Item;
    const unlockDungeon = built.repository.createDungeon(fixture.campaignId, {
      name: "Cámara compartida",
      entryRoomId: "unlock-shared-1",
      rooms: [
        {
          id: "unlock-shared-1",
          name: "Plano",
          kind: "treasure",
          unlockRewards: true,
          rewards: { itemIds: [locked.id] },
        },
      ],
    });

    await startRun(fixture, { dungeonId: unlockDungeon.id });
    const chest = await postAction(fixture, "chest");
    expect(chest.statusCode, JSON.stringify(chest.body)).toBe(200);
    const result = chest.body as {
      rewards: {
        pendingItemIds?: string[];
        lootDraftId?: string;
        unlockedItemIds?: string[];
      } | null;
    };
    expect(result.rewards?.pendingItemIds).toEqual([locked.id]);
    expect(result.rewards?.lootDraftId).toBeDefined();
    expect(result.rewards?.unlockedItemIds).toEqual([locked.id]);

    const campaign = built.repository.getCampaign(fixture.campaignId);
    expect(
      campaign.content.items.find((item) => item.id === locked.id)?.unlocked,
    ).toBe(true);
    // No se entrega todavía: está pendiente del reparto.
    for (const player of fixture.players) {
      const character = characterById(fixture.campaignId, player.character.id);
      expect(itemQty(character, locked.id)).toBe(0);
    }
    const state = await getState(fixture, fixture.dmToken);
    expect(state.lootDraft?.pool).toEqual([locked.id]);
  });

  it("el cofre desbloquea skills para la campaña sin tocar el inventario", async () => {
    const fixture = await makeFixture();
    const lockedSkill = built.repository.createContent(
      "skills",
      fixture.campaignId,
      {
        name: "Técnica sellada",
        coins: 2,
        baseClash: 5,
        coinClash: 1,
        baseDamage: 10,
        coinDamage: 2,
        target: "single",
        unlocked: false,
      },
    ) as Skill;
    const dungeon = built.repository.createDungeon(fixture.campaignId, {
      name: "Cámara de técnicas",
      entryRoomId: "skill-1",
      rooms: [
        {
          id: "skill-1",
          name: "Técnica",
          kind: "treasure",
          rewards: { skillIds: [lockedSkill.id], currency: 4 },
        },
      ],
    });

    // La skill está referenciada por el cofre: no se puede borrar.
    const blockedDelete = await app.inject({
      method: "DELETE",
      url: `/api/content/skills/${lockedSkill.id}`,
      headers: withToken(fixture.dmToken),
    });
    expectError(blockedDelete, 409, "content_referenced");

    const before = await getState(fixture, fixture.players[0]?.token ?? "");
    expect(
      before.campaign.content.skills.some(
        (skill) => skill.id === lockedSkill.id,
      ),
    ).toBe(false);

    await startRun(fixture, { dungeonId: dungeon.id });
    const chest = await postAction(fixture, "chest");
    expect(chest.statusCode, JSON.stringify(chest.body)).toBe(200);
    const result = chest.body as {
      rewards: {
        currency?: number;
        unlockedSkillIds?: string[];
      } | null;
    };
    expect(result.rewards?.currency).toBe(4);
    expect(result.rewards?.unlockedSkillIds).toEqual([lockedSkill.id]);

    const campaign = built.repository.getCampaign(fixture.campaignId);
    expect(campaign.wallet.cleanShards).toBe(4);
    expect(
      campaign.content.skills.find((skill) => skill.id === lockedSkill.id)
        ?.unlocked,
    ).toBe(true);
    // Las skills no entran en el inventario ni se equipan solas.
    const player = fixture.players[0];
    if (!player) throw new Error("Falta el jugador.");
    expect(characterById(fixture.campaignId, player.character.id).skills).toEqual(
      [fixture.skillId, null, null],
    );

    const after = await getState(fixture, player.token);
    expect(
      after.campaign.content.skills.some(
        (skill) => skill.id === lockedSkill.id,
      ),
    ).toBe(true);

    const again = await postAction(fixture, "chest");
    expectError(
      { statusCode: again.statusCode, json: () => again.body },
      409,
      "room_already_resolved",
    );
  });

  it("sin unlockRewards el cofre entrega pero no desbloquea", async () => {
    const fixture = await makeFixture();
    const locked = built.repository.createContent("items", fixture.campaignId, {
      name: "Reliquia oculta",
      slot: "utility",
      unlocked: false,
      price: 50,
    }) as Item;
    const lootDungeon = built.repository.createDungeon(fixture.campaignId, {
      name: "Cofre de botín",
      entryRoomId: "loot-1",
      rooms: [
        {
          id: "loot-1",
          name: "Cofre",
          kind: "treasure",
          rewards: { itemIds: [locked.id] },
        },
      ],
    });

    await startRun(fixture, { dungeonId: lootDungeon.id });
    const chest = await postAction(fixture, "chest");
    expect(chest.statusCode, JSON.stringify(chest.body)).toBe(200);
    const result = chest.body as {
      rewards: { unlockedItemIds?: string[] } | null;
    };
    expect(result.rewards?.unlockedItemIds).toBeUndefined();

    const campaign = built.repository.getCampaign(fixture.campaignId);
    expect(
      campaign.content.items.find((item) => item.id === locked.id)?.unlocked,
    ).not.toBe(true);
    for (const player of fixture.players) {
      const character = characterById(fixture.campaignId, player.character.id);
      expect(itemQty(character, locked.id)).toBe(1);
    }
  });

  it("avanzar desde la última sala termina la run", async () => {
    const fixture = await makeFixture();
    await startRun(fixture, {
      dungeonId: fixture.shortDungeon.id,
    });
    const rest = await postAction(fixture, "rest");
    expect(rest.statusCode).toBe(200);

    const advance = await postAction(fixture, "advance");
    expect(advance.statusCode, JSON.stringify(advance.body)).toBe(200);
    expect(advance.body).toBeNull();

    const current = await getDungeon(fixture);
    expect(current.run).toBeNull();
    const state = await getState(fixture, fixture.dmToken);
    expect(state.dungeonRun).toBeNull();
  });

  it("el DM puede terminar la run y los jugadores vuelven a su hoja", async () => {
    const fixture = await makeFixture();
    await startRun(fixture);

    const end = await postAction(fixture, "end");
    expect(end.statusCode).toBe(204);
    expect((await getDungeon(fixture)).run).toBeNull();
    expect((await getDungeon(fixture, fixture.players[0]?.token)).run).toBeNull();

    const again = await postAction(fixture, "end");
    expectError(
      { statusCode: again.statusCode, json: () => again.body },
      404,
      "no_active_run",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Combate y permisos                                                         */
/* -------------------------------------------------------------------------- */

describe("Fase 4C — combate, permisos y exclusividad", () => {
  it("empezar un combate normal cierra la run", async () => {
    const fixture = await makeFixture();
    await startRun(fixture);
    expect((await getDungeon(fixture)).run).not.toBeNull();

    built.combat.startEncounter(
      fixture.campaignId,
      fixture.encounterId,
      fixture.sessionId,
      { seed: "seed-dungeon-normal", speedRoll: false },
    );

    expect((await getDungeon(fixture)).run).toBeNull();
    const state = await getState(fixture, fixture.dmToken);
    expect(state.dungeonRun).toBeNull();
  });

  it("no se inicia ni se actúa durante el combate", async () => {
    const fixture = await makeFixture();
    built.combat.startEncounter(
      fixture.campaignId,
      fixture.encounterId,
      fixture.sessionId,
      { seed: "seed-dungeon-lock", speedRoll: false },
    );

    const start = await startRun(fixture);
    expectError(
      { statusCode: start.statusCode, json: () => start.body },
      423,
      "combat_lock",
    );

    // Con la run ya activa, las acciones también quedan bloqueadas.
    const fixture2 = await makeFixture();
    await startRun(fixture2);
    const encounter = await postAction(fixture2, "encounter");
    expect(encounter.statusCode).toBe(200);
    for (const action of ["rest", "chest", "advance", "end"] as const) {
      const blocked = await postAction(fixture2, action);
      expectError(
        { statusCode: blocked.statusCode, json: () => blocked.body },
        423,
        "combat_lock",
      );
    }
  });

  it("un jugador no dirige la mazmorra", async () => {
    const fixture = await makeFixture();
    await startRun(fixture);
    const playerToken = fixture.players[0]?.token;

    for (const action of [
      "encounter",
      "rest",
      "chest",
      "advance",
      "end",
    ] as const) {
      const blocked = await postAction(fixture, action, playerToken);
      expectError(
        { statusCode: blocked.statusCode, json: () => blocked.body },
        403,
        "dm_only",
      );
    }

    const playerStart = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dungeon/start`,
      headers: withToken(playerToken),
      payload: { dungeonId: fixture.dungeon.id },
    });
    expectError(playerStart, 403, "dm_only");
  });

  it("tienda y mazmorra no conviven en la mesa", async () => {
    const fixture = await makeFixture();
    const shop = built.repository.createShop(fixture.campaignId, {
      name: "Tienda de la cripta",
      items: [{ itemId: fixture.itemB.id, price: 3 }],
    }) as Shop;

    const openShop = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/shop/open`,
      headers: withToken(fixture.dmToken),
      payload: { shopId: shop.id },
    });
    expect(openShop.statusCode, openShop.body).toBe(200);
    expect((await getShop(fixture))?.shopId).toBe(shop.id);

    await startRun(fixture);
    expect(await getShop(fixture)).toBeNull();
    expect((await getDungeon(fixture)).run).not.toBeNull();

    const reopen = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/shop/open`,
      headers: withToken(fixture.dmToken),
      payload: { shopId: shop.id },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    expect((await getDungeon(fixture)).run).toBeNull();
    expect((await getShop(fixture))?.shopId).toBe(shop.id);
  });
});

async function getShop(
  fixture: Fixture,
): Promise<{ shopId: string } | null> {
  const response = await app.inject({
    method: "GET",
    url: `/api/sessions/${fixture.sessionCode}/shop`,
    headers: withToken(fixture.dmToken),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as { shopId: string } | null;
}
