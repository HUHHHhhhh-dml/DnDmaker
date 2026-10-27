import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  Character,
  EffectDefinition,
  Encounter,
  HostSessionResponse,
  Item,
  JoinSessionResponse,
  PublicCombatState,
  Skill,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";
import { RECENT_COMBAT_TTL_MS } from "./combat/service";
import { HttpError } from "./repository";

/**
 * Fase 3A — dominio de combate y snapshot.
 *
 * No hay motor todavía: se valida que iniciar un encuentro copia fichas,
 * visuales y efectos, instancia enemigos con count/overrides, persiste el
 * estado/eventos y termina guardando el HP de la party.
 */

let dir: string;
let built: BuiltApp;
let app: FastifyInstance;
let baseUrl: string;
let scenarioCounter = 0;

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

interface Scenario {
  campaign: Campaign;
  campaignId: string;
  encounterId: string;
  sessionId: string;
  sessionCode: string;
  dmToken: string;
  playerToken: string;
  playerOne: Character;
  playerTwo: Character;
  enemy: Character;
  itemId: string;
  utilityId: string;
  skillId: string;
  effectId: string;
}

interface ScenarioOptions {
  enemyCount?: number;
  playerHp?: number;
  rules?: Partial<Campaign["rules"]>;
  joinPlayers?: boolean;
  emptyEncounter?: boolean;
  /** Usa overrides anidados parciales (hpMax y un slot de equipo). */
  partialOverrides?: boolean;
}

async function createContent<T>(
  campaignId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/${type}`,
    payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as T;
}

async function setupScenario(options: ScenarioOptions = {}): Promise<Scenario> {
  scenarioCounter += 1;
  const createdCampaign = await app.inject({
    method: "POST",
    url: "/api/campaigns",
    payload: {
      name: `Combate ${scenarioCounter}`,
      seed: false,
      rules: options.rules,
    },
  });
  expect(createdCampaign.statusCode, createdCampaign.body).toBe(201);
  const campaign = createdCampaign.json() as Campaign;
  const campaignId = campaign.id;

  const effect = await createContent<EffectDefinition>(campaignId, "effects", {
    name: "Protección de prueba",
    maxStacks: 3,
    stackMode: "add",
    duration: { type: "turns", default: 3 },
    triggers: [
      {
        when: "roundStart",
        actions: [
          { type: "modifyStat", stat: "def", mode: "flat", amount: 0, perStack: 5 },
        ],
      },
    ],
  });

  const item = await createContent<Item>(campaignId, "items", {
    name: "Cuernos de prueba",
    slot: "horns",
    image: "/assets/items/civil.png",
    unlocked: true,
    stats: { hpMax: 5, def: 3, atk: 2 },
    effects: [{ effectId: effect.id, stacks: 1 }],
  });

  const utility = await createContent<Item>(campaignId, "items", {
    name: "Inyección de prueba",
    slot: "utility",
    uses: 3,
    unlocked: true,
    useEffect: [{ type: "heal", base: 5 }],
  });

  const skill = await createContent<Skill>(campaignId, "skills", {
    name: "Filo visual",
    unlocked: true,
    coins: 3,
    baseClash: 5,
    coinClash: 7,
    baseDamage: 20,
    coinDamage: 5,
    weaponImage: "/assets/weapons/test-blade.png",
  });

  const playerPayload = {
    name: "Jugador Uno",
    kind: "player",
    portrait: "/assets/portrait-player.png",
    description: "Ficha de prueba de party.",
    visualMode: "layered",
    battleSprite: "/assets/battle-player.png",
    bodyImage: "/assets/base-character.png",
    baseStats: { hpMax: 50, def: 2, atk: 5, spd: 10, luck: 0, skillSlots: 2 },
    equipment: {
      horns: item.id,
      hand: null,
      armor: null,
      leg: null,
      utility: utility.id,
    },
    skills: [skill.id, null, null],
    inventory: [],
    ...(options.playerHp === undefined ? {} : { hpCurrent: options.playerHp }),
  };

  const playerOne = await createContent<Character>(campaignId, "characters", {
    ...playerPayload,
    name: "Jugador Uno",
  });
  const playerTwo = await createContent<Character>(campaignId, "characters", {
    ...playerPayload,
    name: "Jugador Dos",
  });

  const enemy = await createContent<Character>(campaignId, "characters", {
    name: "Enemigo base",
    kind: "enemy",
    description: "Enemigo de prueba.",
    visualMode: "portrait",
    portrait: "/assets/portrait-enemy.png",
    battleSprite: "/assets/enemy.png",
    baseStats: { hpMax: 40, def: 10, atk: 5, spd: 12, luck: 0, skillSlots: 2 },
    equipment: {
      horns: null,
      hand: null,
      armor: null,
      leg: null,
      utility: null,
    },
    skills: [skill.id, null, null],
    inventory: [],
  });

  const encounter = await createContent<Encounter>(campaignId, "encounters", {
    name: "Protocolo de prueba",
    description: "Una copia por defecto.",
    enemies: options.emptyEncounter
      ? []
      : [
          {
            characterId: enemy.id,
            count: options.enemyCount ?? 1,
            overrides: options.partialOverrides
              ? {
                  name: "Eco parcial",
                  baseStats: { hpMax: 25 },
                  equipment: { hand: null },
                }
              : {
                  name: "Eco sombrío",
                  // El tipo no debe poder cambiar por override.
                  kind: "player",
                  visualMode: "layered",
                  battleSprite: "/assets/enemy-override.png",
                  bodyImage: "/assets/enemy-body.png",
                  baseStats: {
                    hpMax: 30,
                    def: 4,
                    atk: 8,
                    spd: 9,
                    luck: 0,
                    skillSlots: 2,
                  },
                },
          },
        ],
  });

  const hostedResponse = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/session`,
    payload: {},
  });
  expect(hostedResponse.statusCode, hostedResponse.body).toBe(201);
  const hosted = hostedResponse.json() as HostSessionResponse;

  let playerToken = "";
  if (options.joinPlayers !== false) {
    const joinedOne = await app.inject({
      method: "POST",
      url: `/api/sessions/${hosted.session.code}/join`,
      payload: { name: "Ana", characterId: playerOne.id },
    });
    expect(joinedOne.statusCode, joinedOne.body).toBe(201);
    const joinedTwo = await app.inject({
      method: "POST",
      url: `/api/sessions/${hosted.session.code}/join`,
      payload: { name: "Beto", characterId: playerTwo.id },
    });
    expect(joinedTwo.statusCode, joinedTwo.body).toBe(201);
    playerToken = (joinedOne.json() as JoinSessionResponse).playerToken;
  }

  return {
    campaign: {
      ...campaign,
      rules: { ...campaign.rules, ...(options.rules ?? {}) },
    },
    campaignId,
    encounterId: encounter.id,
    sessionId: hosted.session.id,
    sessionCode: hosted.session.code,
    dmToken: hosted.dmToken,
    playerToken,
    playerOne,
    playerTwo,
    enemy,
    itemId: item.id,
    utilityId: utility.id,
    skillId: skill.id,
    effectId: effect.id,
  };
}

function expectHttpError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe(code);
    return;
  }
  throw new Error(`Se esperaba un HttpError con código ${code}.`);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-combat-"));
  built = await buildApp({
    dbPath: join(dir, "combat.sqlite"),
    uploadsDir: join(dir, "uploads"),
    webDistDir: join(dir, "no-web-dist"),
    seed: false,
    logger: false,
  });
  app = built.app;
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Fase 3A — snapshot y dominio", () => {
  it("hace snapshot de stats, equipo, skills, efectos y visuales", async () => {
    const scenario = await setupScenario({ playerHp: 30, enemyCount: 1 });
    const state = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "seed-3a" },
    );

    expect(state.phase).toBe("declaring");
    expect(state.round).toBe(1);
    expect(state.seed).toBe("seed-3a");
    expect(state.units).toHaveLength(3);
    expect(state.winner).toBeUndefined();

    const playerUnit = state.units.find(
      (unit) => unit.characterId === scenario.playerOne.id,
    )!;
    expect(playerUnit).toMatchObject({
      team: "players",
      kind: "player",
      name: "Jugador Uno",
      visualMode: "layered",
      battleSprite: "/assets/battle-player.png",
      bodyImage: "/assets/base-character.png",
      portrait: "/assets/portrait-player.png",
      hpCurrent: 30,
      utilityUses: 3,
      defeated: false,
    });
    expect(playerUnit.stats).toEqual({
      hpMax: 55,
      def: 10,
      atk: 7,
      spd: 10,
      luck: 0,
      skillSlots: 2,
    });
    expect(playerUnit.baseStats).toEqual({
      hpMax: 50,
      def: 2,
      atk: 5,
      spd: 10,
      luck: 0,
      skillSlots: 2,
    });
    expect(playerUnit.equipment.horns).toBe(scenario.itemId);
    expect(playerUnit.equipment.utility).toBe(scenario.utilityId);
    expect(playerUnit.skills).toEqual([scenario.skillId, null, null]);
    expect(playerUnit.effects).toEqual([
      {
        effectId: scenario.effectId,
        stacks: 1,
        sourceId: scenario.itemId,
        passive: true,
      },
    ]);

    const enemyUnit = state.units.find((unit) => unit.team === "enemies")!;
    expect(enemyUnit).toMatchObject({
      characterId: scenario.enemy.id,
      kind: "enemy",
      name: "Eco sombrío",
      visualMode: "layered",
      battleSprite: "/assets/enemy-override.png",
      bodyImage: "/assets/enemy-body.png",
      hpCurrent: 30,
      utilityUses: 0,
    });
    expect(enemyUnit.stats).toMatchObject({ hpMax: 30, def: 4, atk: 8, spd: 9 });

    expect(state.actions[playerUnit.id]).toEqual([]);
    expect(state.specialCooldowns[playerUnit.id]).toEqual({});
    expect(state.log).toHaveLength(1);
    expect(state.log[0]?.type).toBe("roundStart");

    expect(built.sessions.getById(scenario.sessionId)?.status).toBe("combat");
    expect(built.combatStore.get(state.id)?.state).toEqual(state);
    expect(built.combatStore.listEvents(state.id)).toHaveLength(1);

    // El snapshot es inmutable: editar la ficha viva no cambia la unidad.
    built.repository.updateContent("characters", scenario.playerOne.id, {
      baseStats: { hpMax: 50, def: 2, atk: 999, spd: 10, luck: 0, skillSlots: 2 },
    });
    const reloaded = built.combatStore.getState(state.id)!;
    expect(
      reloaded.units.find((unit) => unit.characterId === scenario.playerOne.id)
        ?.stats.atk,
    ).toBe(7);
  });

  it("emite combat:started a la sala al iniciar", async () => {
    const scenario = await setupScenario({ enemyCount: 1 });
    const socket = ioClient(baseUrl, {
      auth: { code: scenario.sessionCode, token: scenario.dmToken },
      transports: ["websocket"],
      forceNew: true,
    });

    try {
      const ready = once<{ role: string }>(socket, "session:state");
      await once(socket, "connect");
      expect((await ready).role).toBe("dm");

      const started = once<{ combat: PublicCombatState }>(
        socket,
        "combat:started",
      );
      const state = built.combat.startEncounter(
        scenario.campaignId,
        scenario.encounterId,
        scenario.sessionId,
        { seed: "socket" },
      );
      const payload = await started;
      expect(payload.combat.id).toBe(state.id);
      expect(payload.combat.phase).toBe("declaring");
      expect(payload.combat.units).toHaveLength(3);
      expect(payload.combat).not.toHaveProperty("seed");
    } finally {
      socket.disconnect();
    }
  });

  it("instancia count copias y aplica overrides sin cambiar el bando", async () => {
    const scenario = await setupScenario({ enemyCount: 3 });
    const state = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "overrides" },
    );

    const enemies = state.units.filter((unit) => unit.team === "enemies");
    expect(enemies).toHaveLength(3);
    expect(new Set(enemies.map((unit) => unit.id)).size).toBe(3);
    for (const enemy of enemies) {
      expect(enemy).toMatchObject({
        characterId: scenario.enemy.id,
        team: "enemies",
        kind: "enemy",
        name: "Eco sombrío",
        visualMode: "layered",
        battleSprite: "/assets/enemy-override.png",
        bodyImage: "/assets/enemy-body.png",
      });
      expect(enemy.stats).toMatchObject({
        hpMax: 30,
        def: 4,
        atk: 8,
        spd: 9,
      });
    }

    // La ficha base no se muta con los overrides de la aparición.
    const base = built.repository.getContent("characters", scenario.enemy.id);
    expect(base.name).toBe("Enemigo base");
    expect(base.baseStats.hpMax).toBe(40);
    expect(base.visualMode).toBe("portrait");
  });

  it("acepta overrides anidados parciales de stats y equipo", async () => {
    const scenario = await setupScenario({
      enemyCount: 1,
      partialOverrides: true,
    });
    const state = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "partial" },
    );
    const enemy = state.units.find((unit) => unit.team === "enemies")!;

    expect(enemy.name).toBe("Eco parcial");
    // Solo se pisa hpMax; el resto de stats base se conserva.
    expect(enemy.stats).toMatchObject({
      hpMax: 25,
      def: 10,
      atk: 5,
      spd: 12,
      luck: 0,
      skillSlots: 2,
    });
    expect(enemy.hpCurrent).toBe(25);
    expect(enemy.equipment.hand).toBeNull();
    expect(enemy.visualMode).toBe("portrait");

    // El remapeo de import no rellena los slots que el override no toca.
    const imported = built.repository.importCampaign(
      built.repository.exportCampaign(scenario.campaignId),
    );
    const importedEnemy = imported.content.encounters[0]?.enemies[0];
    expect(importedEnemy?.overrides).toEqual({
      name: "Eco parcial",
      baseStats: { hpMax: 25 },
      equipment: { hand: null },
    });
  });

  it("persiste el estado, recarga desde SQLite y guarda el HP al terminar", async () => {
    const scenario = await setupScenario({ playerHp: 30, enemyCount: 1 });
    const state = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "fin" },
    );

    const playerUnit = state.units.find(
      (unit) => unit.characterId === scenario.playerOne.id,
    )!;
    const enemyUnit = state.units.find((unit) => unit.team === "enemies")!;
    playerUnit.hpCurrent = 17;
    enemyUnit.hpCurrent = 0;
    enemyUnit.defeated = true;
    built.combatStore.save(state);

    expect(built.combatStore.getState(state.id)?.units).toHaveLength(3);
    const ended = built.combat.endEncounter(state.id, "victory");

    expect(ended.phase).toBe("ended");
    expect(ended.winner).toBe("players");
    expect(ended.log.at(-1)?.type).toBe("combatEnd");
    expect(built.sessions.getById(scenario.sessionId)?.status).toBe("playing");
    expect(
      built.repository.getContent("characters", scenario.playerOne.id).hpCurrent,
    ).toBe(17);
    expect(
      built.repository.getContent("characters", scenario.playerTwo.id).hpCurrent,
    ).toBe(30);
    // Los enemigos no arrastran HP persistente.
    expect(
      built.repository.getContent("characters", scenario.enemy.id).hpCurrent,
    ).toBeUndefined();

    const events = built.combatStore.listEvents(state.id);
    expect(events.map((event) => event.type)).toEqual([
      "roundStart",
      "combatEnd",
    ]);

    // Idempotente: no duplica evento ni vuelve a escribir HP.
    const again = built.combat.endEncounter(state.id, "otra vez");
    expect(again.phase).toBe("ended");
    expect(built.combatStore.listEvents(state.id)).toHaveLength(2);
  });

  it("respeta hpPersistence restore al terminar", async () => {
    const scenario = await setupScenario({
      playerHp: 20,
      enemyCount: 1,
      rules: { hpPersistence: "restore" },
    });
    const state = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "restore" },
    );
    const playerUnit = state.units.find(
      (unit) => unit.characterId === scenario.playerOne.id,
    )!;
    playerUnit.hpCurrent = 5;
    built.combatStore.save(state);

    built.combat.endEncounter(state.id, "dm");

    expect(
      built.repository.getContent("characters", scenario.playerOne.id).hpCurrent,
    ).toBe(55);
  });

  it("Rest party cura fuera de combate y se bloquea durante el combate", async () => {
    const scenario = await setupScenario({ enemyCount: 1 });
    built.repository.setCharacterCurrentHp(scenario.playerOne.id, 3);
    built.repository.setCharacterCurrentHp(scenario.playerTwo.id, 0);

    const dmHeaders = { "x-session-token": scenario.dmToken };
    const response = await app.inject({
      method: "POST",
      url: `/api/campaigns/${scenario.campaignId}/rest-party`,
      headers: dmHeaders,
    });
    expect(response.statusCode, response.body).toBe(200);
    const healed = response.json() as Campaign;
    expect(
      healed.content.characters.find(
        (character) => character.id === scenario.playerOne.id,
      )?.hpCurrent,
    ).toBe(55);
    expect(
      healed.content.characters.find(
        (character) => character.id === scenario.playerTwo.id,
      )?.hpCurrent,
    ).toBe(55);
    // Los enemigos no tienen HP persistente que curar.
    expect(
      healed.content.characters.find(
        (character) => character.id === scenario.enemy.id,
      )?.hpCurrent,
    ).toBeUndefined();

    const playerAttempt = await app.inject({
      method: "POST",
      url: `/api/campaigns/${scenario.campaignId}/rest-party`,
      headers: { "x-session-token": scenario.playerToken },
    });
    expect(playerAttempt.statusCode).toBe(403);
    expect(playerAttempt.json().error.code).toBe("dm_only");

    built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "rest-lock" },
    );
    const blocked = await app.inject({
      method: "POST",
      url: `/api/campaigns/${scenario.campaignId}/rest-party`,
      headers: dmHeaders,
    });
    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().error.code).toBe("combat_lock");
  });

  it("actualiza visualMode/battleSprite/bodyImage y el snapshot de combate los usa", async () => {
    const scenario = await setupScenario({ enemyCount: 1 });
    const dmHeaders = { "x-session-token": scenario.dmToken };
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${scenario.playerOne.id}`,
      headers: dmHeaders,
      payload: {
        visualMode: "portrait",
        battleSprite: "/assets/changed-battle.png",
        bodyImage: "/assets/changed-body.png",
      },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({
      visualMode: "portrait",
      battleSprite: "/assets/changed-battle.png",
      bodyImage: "/assets/changed-body.png",
    });

    const state = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "visual-change" },
    );
    const unit = state.units.find(
      (entry) => entry.characterId === scenario.playerOne.id,
    )!;
    expect(unit).toMatchObject({
      visualMode: "portrait",
      battleSprite: "/assets/changed-battle.png",
      bodyImage: "/assets/changed-body.png",
    });

    const exported = built.repository.exportCampaign(scenario.campaignId);
    const imported = built.repository.importCampaign(exported);
    expect(
      imported.content.characters.find(
        (character) => character.name === "Jugador Uno",
      ),
    ).toMatchObject({
      visualMode: "portrait",
      battleSprite: "/assets/changed-battle.png",
      bodyImage: "/assets/changed-body.png",
    });
  });

  it("export/import conserva visuales, hpCurrent y weaponImage", async () => {
    const scenario = await setupScenario({ playerHp: 30, enemyCount: 1 });
    const exportResponse = await app.inject({
      method: "GET",
      url: `/api/campaigns/${scenario.campaignId}/export`,
      headers: { "x-session-token": scenario.dmToken },
    });
    expect(exportResponse.statusCode, exportResponse.body).toBe(200);
    const exported = JSON.parse(exportResponse.body) as Campaign;

    const exportedPlayer = exported.content.characters.find(
      (character) => character.id === scenario.playerOne.id,
    )!;
    expect(exportedPlayer).toMatchObject({
      visualMode: "layered",
      battleSprite: "/assets/battle-player.png",
      bodyImage: "/assets/base-character.png",
      hpCurrent: 30,
    });
    expect(
      exported.content.skills.find((skill) => skill.id === scenario.skillId)
        ?.weaponImage,
    ).toBe("/assets/weapons/test-blade.png");

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/campaigns/import",
      payload: exported,
    });
    expect(importResponse.statusCode, importResponse.body).toBe(201);
    const imported = importResponse.json() as Campaign;

    const importedPlayer = imported.content.characters.find(
      (character) => character.name === "Jugador Uno",
    )!;
    expect(importedPlayer).toMatchObject({
      visualMode: "layered",
      battleSprite: "/assets/battle-player.png",
      bodyImage: "/assets/base-character.png",
      hpCurrent: 30,
    });
    const importedSkill = imported.content.skills.find(
      (skill) => skill.name === "Filo visual",
    )!;
    expect(importedSkill.weaponImage).toBe("/assets/weapons/test-blade.png");

    const importedEncounter = imported.content.encounters.find(
      (encounter) => encounter.name === "Protocolo de prueba",
    )!;
    expect(importedEncounter.enemies[0]?.overrides).toMatchObject({
      visualMode: "layered",
      battleSprite: "/assets/enemy-override.png",
      bodyImage: "/assets/enemy-body.png",
    });
  });

  it("bloquea ediciones de contenido y fichas durante el combate", async () => {
    const scenario = await setupScenario({ enemyCount: 1 });
    built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "lock" },
    );

    const dmHeaders = { "x-session-token": scenario.dmToken };
    const playerHeaders = { "x-session-token": scenario.playerToken };

    const dmPatch = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${scenario.playerOne.id}`,
      headers: dmHeaders,
      payload: { name: "No debería" },
    });
    expect(dmPatch.statusCode).toBe(423);
    expect(dmPatch.json().error.code).toBe("combat_lock");

    const playerPatch = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${scenario.playerOne.id}`,
      headers: playerHeaders,
      payload: { name: "Tampoco" },
    });
    expect(playerPatch.statusCode).toBe(423);
    expect(playerPatch.json().error.code).toBe("combat_lock");

    const itemCreate = await app.inject({
      method: "POST",
      url: `/api/campaigns/${scenario.campaignId}/items`,
      headers: dmHeaders,
      payload: { name: "Objeto en combate", slot: "horns" },
    });
    expect(itemCreate.statusCode).toBe(423);

    const campaignPatch = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${scenario.campaignId}`,
      headers: dmHeaders,
      payload: { name: "Campaña en combate" },
    });
    expect(campaignPatch.statusCode).toBe(423);

    const reopen = await app.inject({
      method: "POST",
      url: `/api/campaigns/${scenario.campaignId}/session`,
      payload: {},
    });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json().error.code).toBe("combat_in_progress");

    const close = await app.inject({
      method: "POST",
      url: `/api/sessions/${scenario.sessionCode}/close`,
      headers: dmHeaders,
    });
    expect(close.statusCode).toBe(409);
    expect(close.json().error.code).toBe("combat_in_progress");

    const leave = await app.inject({
      method: "POST",
      url: `/api/sessions/${scenario.sessionCode}/leave`,
      headers: playerHeaders,
    });
    expect(leave.statusCode).toBe(409);
    expect(leave.json().error.code).toBe("combat_in_progress");

    const state = built.combat.getLiveCombat(scenario.campaignId)!;
    built.combat.endEncounter(state.id, "dm");

    const afterEnd = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${scenario.playerOne.id}`,
      headers: dmHeaders,
      payload: { name: "Ahora sí" },
    });
    expect(afterEnd.statusCode, afterEnd.body).toBe(200);

    const playerHp = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${scenario.playerOne.id}`,
      headers: playerHeaders,
      payload: { hpCurrent: 1 },
    });
    expect(playerHp.statusCode).toBe(403);
    expect(playerHp.json().error.code).toBe("forbidden_fields");
  });

  it("recarga el combate desde SQLite tras reiniciar el servidor", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "protocol-life-combat-reload-"));
    const dbFile = join(otherDir, "reload.sqlite");
    const first = await buildApp({
      dbPath: dbFile,
      uploadsDir: join(otherDir, "uploads"),
      webDistDir: join(otherDir, "no-web-dist"),
      seed: false,
      logger: false,
    });

    try {
      const campaign = first.repository.createCampaign({
        name: "Recarga",
        seed: false,
      });
      const player = first.repository.createContent(
        "characters",
        campaign.id,
        {
          name: "Persistente",
          kind: "player",
          visualMode: "layered",
          bodyImage: "/assets/base-character.png",
          baseStats: { hpMax: 30, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2 },
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
      const enemy = first.repository.createContent(
        "characters",
        campaign.id,
        {
          name: "Enemigo persistente",
          kind: "enemy",
          baseStats: { hpMax: 20, def: 0, atk: 0, spd: 5, luck: 0, skillSlots: 2 },
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
      const encounter = first.repository.createContent(
        "encounters",
        campaign.id,
        {
          name: "Recarga",
          enemies: [{ characterId: enemy.id, count: 1 }],
        },
      ) as Encounter;
      const hosted = first.sessions.host(campaign.id);
      first.sessions.join(hosted.session.code, {
        name: "Ana",
        characterId: player.id,
      });
      const state = first.combat.startEncounter(
        campaign.id,
        encounter.id,
        hosted.session.id,
        { seed: "reload" },
      );

      await first.app.close();

      const second = await buildApp({
        dbPath: dbFile,
        uploadsDir: join(otherDir, "uploads"),
        webDistDir: join(otherDir, "no-web-dist"),
        seed: false,
        logger: false,
      });
      try {
        const reloaded = second.combat.getState(state.id);
        expect(reloaded.seed).toBe("reload");
        expect(reloaded.phase).toBe("declaring");
        expect(reloaded.units).toHaveLength(2);
        expect(reloaded.units[0]).toMatchObject({
          name: "Persistente",
          visualMode: "layered",
          bodyImage: "/assets/base-character.png",
        });
        expect(reloaded.log).toHaveLength(1);
        expect(second.combatStore.listEvents(state.id)).toHaveLength(1);
      } finally {
        await second.app.close();
      }
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  it("getRecentCombat respeta TTL y solo se envía a quien participó", async () => {
    const scenario = await setupScenario({ enemyCount: 1 });
    const state = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "recent" },
    );
    built.combat.endEncounter(state.id, "dm");

    expect(built.combatStore.findLatestByCampaign(scenario.campaignId)?.id).toBe(
      state.id,
    );
    expect(
      built.combat.getRecentCombat(scenario.campaignId, { role: "dm" })?.id,
    ).toBe(state.id);
    expect(
      built.combat.getRecentCombat(scenario.campaignId, {
        role: "player",
        characterId: scenario.playerOne.id,
      })?.id,
    ).toBe(state.id);
    expect(
      built.combat.getRecentCombat(scenario.campaignId, {
        role: "player",
        characterId: "chr_no_participo",
      }),
    ).toBeNull();
    expect(
      built.combat.getRecentCombat(scenario.campaignId, {
        role: "player",
      }),
    ).toBeNull();
    expect(
      built.combat.getRecentCombat(
        scenario.campaignId,
        { role: "dm" },
        { now: new Date(Date.now() + RECENT_COMBAT_TTL_MS + 60_000) },
      ),
    ).toBeNull();
  });

  it("rechaza iniciar sin jugadores, sin enemigos o con combate activo", async () => {
    const noPlayers = await setupScenario({ joinPlayers: false });
    expectHttpError(
      () =>
        built.combat.startEncounter(
          noPlayers.campaignId,
          noPlayers.encounterId,
          noPlayers.sessionId,
        ),
      "no_players",
    );

    const noEnemies = await setupScenario({ emptyEncounter: true });
    expectHttpError(
      () =>
        built.combat.startEncounter(
          noEnemies.campaignId,
          noEnemies.encounterId,
          noEnemies.sessionId,
        ),
      "no_enemies",
    );

    const scenario = await setupScenario({ enemyCount: 1 });
    built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "doble" },
    );
    expectHttpError(
      () =>
        built.combat.startEncounter(
          scenario.campaignId,
          scenario.encounterId,
          scenario.sessionId,
        ),
      "combat_in_progress",
    );
  });
});
