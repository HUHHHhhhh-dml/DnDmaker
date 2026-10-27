import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SPECIAL_USED,
  type Campaign,
  type Character,
  type CombatEvent,
  type CombatState,
  type EffectDefinition,
  type Encounter,
  type Item,
  type PublicCombatState,
  type SessionPlayer,
  type Skill,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";
import type { CombatActor, DeclaredActionInput } from "./combat/service";
import { HttpError } from "./repository";

/**
 * Fase 3C — declaraciones, lock y resolución de ronda.
 *
 * Usa una SQLite temporal (nunca `data/protocol-life.sqlite`), el servicio
 * real y el motor puro. No hay rutas HTTP de combate todavía: 3D conectará
 * estos métodos a WebSocket.
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
  players: SessionPlayer[];
  playerOne: Character;
  playerTwo: Character;
  enemyOne: Character;
  enemyTwo: Character | null;
  skillId: string;
  otherSkillId: string;
  effectId: string;
  utilityId: string;
  domainId?: string;
}

interface ScenarioOptions {
  /** La campaña semilla trae dominios/hábitats; se usa para el test de dominio. */
  seedContent?: boolean;
  enemyCount?: 1 | 2;
  playerHp?: number;
  playerTwoHp?: number;
  enemyHp?: number;
  enemyTwoHp?: number;
  playerAtk?: number;
  playerSpd?: number;
  playerTwoSpd?: number;
  enemySpd?: number;
  enemyTwoSpd?: number;
  enemySkills?: boolean;
  utilityUses?: number;
  equipUtility?: boolean;
  withDomain?: boolean;
  /** Override de HP inicial para probar objetivos ya derrotados. */
  enemyTwoHpCurrent?: number;
}

async function setupScenario(
  options: ScenarioOptions = {},
): Promise<Scenario> {
  scenarioCounter += 1;
  const enemyCount = options.enemyCount ?? 2;
  const campaign = built.repository.createCampaign({
    name: `Ronda 3C ${scenarioCounter}`,
    seed: options.seedContent ?? false,
  });
  const campaignId = campaign.id;
  const domain = options.withDomain ? campaign.content.specials[0] : undefined;
  if (options.withDomain) expect(domain).toBeDefined();

  const effect = built.repository.createContent(
    "effects",
    campaignId,
    {
      name: "Marca de ronda",
      maxStacks: 3,
      stackMode: "add",
      duration: { type: "turns", default: 2 },
      triggers: [],
    },
  ) as EffectDefinition;

  const skill = built.repository.createContent(
    "skills",
    campaignId,
    {
      name: "Golpe de ronda",
      unlocked: true,
      coins: 2,
      baseClash: 5,
      coinClash: 2,
      baseDamage: 5,
      coinDamage: 1,
      effects: [{ effectId: effect.id, chance: 1, stacks: 1 }],
    },
  ) as Skill;

  const otherSkill = built.repository.createContent(
    "skills",
    campaignId,
    {
      name: "Golpe no equipado",
      unlocked: true,
      coins: 1,
      baseClash: 1,
      coinClash: 1,
      baseDamage: 1,
      coinDamage: 1,
    },
  ) as Skill;

  const utility = built.repository.createContent(
    "items",
    campaignId,
    {
      name: "Inyección de ronda",
      slot: "utility",
      uses: options.utilityUses ?? 2,
      unlocked: true,
      useEffect: [{ type: "heal", base: 5 }],
    },
  ) as Item;

  const playerOne = built.repository.createContent(
    "characters",
    campaignId,
    {
      name: "Ronda Uno",
      kind: "player",
      baseStats: {
        hpMax: 200,
        def: 0,
        atk: options.playerAtk ?? 10,
        spd: options.playerSpd ?? 20,
        luck: 0,
        skillSlots: 2,
      },
      hpCurrent: options.playerHp ?? 200,
      equipment: {
        horns: null,
        hand: null,
        armor: null,
        leg: null,
        utility: options.equipUtility === false ? null : utility.id,
      },
      skills: [skill.id, null, null],
      ...(domain ? { special: { domainId: domain.id } } : {}),
      inventory: [],
    },
  ) as Character;

  const playerTwo = built.repository.createContent(
    "characters",
    campaignId,
    {
      name: "Ronda Dos",
      kind: "player",
      baseStats: {
        hpMax: 200,
        def: 0,
        atk: 10,
        spd: options.playerTwoSpd ?? 10,
        luck: 0,
        skillSlots: 2,
      },
      hpCurrent: options.playerTwoHp ?? 200,
      equipment: {
        horns: null,
        hand: null,
        armor: null,
        leg: null,
        utility: null,
      },
      skills: [skill.id, null, null],
      inventory: [],
    },
  ) as Character;

  const enemySkills = options.enemySkills === false ? [null, null, null] : [skill.id, null, null];

  const enemyOne = built.repository.createContent(
    "characters",
    campaignId,
    {
      name: "Eco Uno",
      kind: "enemy",
      baseStats: {
        hpMax: options.enemyHp ?? 200,
        def: 0,
        atk: 10,
        spd: options.enemySpd ?? 5,
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
      skills: enemySkills,
      inventory: [],
    },
  ) as Character;

  const enemyTwo =
    enemyCount >= 2
      ? (built.repository.createContent(
          "characters",
          campaignId,
          {
            name: "Eco Dos",
            kind: "enemy",
            baseStats: {
              hpMax: options.enemyTwoHp ?? 200,
              def: 0,
              atk: 10,
              spd: options.enemyTwoSpd ?? 8,
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
            skills: enemySkills,
            inventory: [],
          },
        ) as Character)
      : null;

  const enemies: Encounter["enemies"] = [
    { characterId: enemyOne.id, count: 1 },
  ];
  if (enemyTwo) {
    enemies.push({
      characterId: enemyTwo.id,
      count: 1,
      ...(options.enemyTwoHpCurrent === undefined
        ? {}
        : { overrides: { hpCurrent: options.enemyTwoHpCurrent } }),
    });
  }

  const encounter = built.repository.createContent(
    "encounters",
    campaignId,
    {
      name: "Protocolo de ronda",
      enemies,
    },
  ) as Encounter;

  const hosted = built.sessions.host(campaignId);
  built.sessions.join(hosted.session.code, {
    name: "Ana",
    characterId: playerOne.id,
  });
  built.sessions.join(hosted.session.code, {
    name: "Beto",
    characterId: playerTwo.id,
  });
  const sessionRow = built.sessions.getById(hosted.session.id);
  if (!sessionRow) throw new Error("La sesión de prueba no se creó.");

  return {
    campaign: built.repository.getCampaign(campaignId),
    campaignId,
    encounterId: encounter.id,
    sessionId: hosted.session.id,
    sessionCode: hosted.session.code,
    dmToken: hosted.dmToken,
    players: sessionRow.players,
    playerOne,
    playerTwo,
    enemyOne,
    enemyTwo,
    skillId: skill.id,
    otherSkillId: otherSkill.id,
    effectId: effect.id,
    utilityId: utility.id,
    domainId: domain?.id,
  };
}

function playerActorFor(
  scenario: Scenario,
  characterId: string,
): CombatActor {
  const player = scenario.players.find(
    (entry) => entry.characterId === characterId,
  );
  if (!player) {
    throw new Error(`No hay jugador para la ficha ${characterId}.`);
  }
  return { role: "player", player };
}

function dmActor(unitId?: string): CombatActor {
  return { role: "dm", unitId };
}

function unitOf(
  state: CombatState,
  characterId: string,
): CombatState["units"][number] {
  const unit = state.units.find(
    (entry) => entry.characterId === characterId,
  );
  if (!unit) throw new Error(`La ficha ${characterId} no está en el combate.`);
  return unit;
}

interface MainRoundUnits {
  p1: CombatState["units"][number];
  p2: CombatState["units"][number];
  e1: CombatState["units"][number];
  e2: CombatState["units"][number];
}

function mainRoundUnits(state: CombatState): MainRoundUnits {
  const players = state.units.filter((unit) => unit.team === "players");
  const enemies = state.units.filter((unit) => unit.team === "enemies");
  const [p1, p2] = players;
  const [e1, e2] = enemies;
  if (!p1 || !p2 || !e1 || !e2) {
    throw new Error("El escenario principal necesita 2 jugadores y 2 enemigos.");
  }
  return { p1, p2, e1, e2 };
}

/**
 * Plan de ronda con clash cruzado (P1 slot 1 vs E1 slot 2), one-sided
 * (P1 slot 2), redirección (P2 intercepta a E2) y efectos de skill.
 */
function declareMainRound(
  scenario: Scenario,
  state: CombatState,
): MainRoundUnits {
  const { p1, p2, e1, e2 } = mainRoundUnits(state);
  const skillId = scenario.skillId;

  built.combat.declareActions(playerActorFor(scenario, p1.characterId), state.id, [
    { slot: 1, skillId, targetId: e1.id },
    { slot: 2, skillId, targetId: e1.id },
  ]);
  built.combat.declareActions(playerActorFor(scenario, p2.characterId), state.id, [
    { slot: 1, skillId, targetId: e2.id, redirectFor: p1.id },
    { slot: 2, skillId, targetId: e1.id },
  ]);
  built.combat.declareActions(dmActor(e1.id), state.id, [
    { slot: 1, skillId, targetId: p2.id },
    { slot: 2, skillId, targetId: p1.id },
  ]);
  built.combat.declareActions(dmActor(e2.id), state.id, [
    { slot: 1, skillId, targetId: p1.id },
    { slot: 2, skillId, targetId: p2.id },
  ]);
  return { p1, p2, e1, e2 };
}

function lockAllLiving(scenario: Scenario, state: CombatState): CombatState {
  let current = state;
  for (const unit of current.units) {
    if (unit.team !== "players") continue;
    if (unit.defeated || unit.hpCurrent <= 0) continue;
    current = built.combat.lockActions(
      state.id,
      playerActorFor(scenario, unit.characterId),
    );
  }
  return built.combat.lockActions(state.id, dmActor());
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

/**
 * Normaliza IDs propios de cada combate para comparar dos ejecuciones con la
 * misma seed. Los nombres son estables; los IDs no.
 */
function normalizeEvents(
  scenario: Scenario,
  state: CombatState,
  events: CombatEvent[],
): unknown[] {
  const labels = new Map<string, string>();
  labels.set(state.id, "combat");
  const teamCounters = new Map<string, number>();
  for (const unit of state.units) {
    const key = `${unit.team}:${unit.name}`;
    const index = teamCounters.get(key) ?? 0;
    teamCounters.set(key, index + 1);
    labels.set(unit.id, `unit:${unit.team}:${index}:${unit.name}`);
    labels.set(unit.characterId, `char:${unit.name}`);
  }
  for (const entry of scenario.campaign.content.skills) {
    labels.set(entry.id, `skill:${entry.name}`);
  }
  for (const entry of scenario.campaign.content.effects) {
    labels.set(entry.id, `effect:${entry.name}`);
  }
  for (const entry of scenario.campaign.content.items) {
    labels.set(entry.id, `item:${entry.name}`);
  }
  for (const entry of scenario.campaign.content.specials) {
    labels.set(entry.id, `special:${entry.name}`);
  }

  const replacements = [...labels.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  );

  const normalize = (value: unknown): unknown => {
    if (typeof value === "string") {
      let result = value;
      for (const [id, label] of replacements) {
        result = result.split(id).join(label);
      }
      return result;
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return value;
  };

  return events.map((event) =>
    normalize({
      id: event.id,
      round: event.round,
      type: event.type,
      actorId: event.actorId,
      targetId: event.targetId,
      message: event.message,
      data: event.data,
    }),
  );
}

/**
 * Espera el primer `combat:state` que cumpla el predicado. Evita depender de
 * que no queden estados antiguos en vuelo al encadenar declarar/bloquear.
 */
function waitForCombatState(
  socket: Socket,
  predicate: (combat: PublicCombatState) => boolean,
  timeout = 4000,
): Promise<PublicCombatState> {
  return new Promise((resolve, reject) => {
    let handler: (payload: { combat: PublicCombatState }) => void;
    const timer = setTimeout(() => {
      socket.off("combat:state", handler);
      reject(new Error("Timeout esperando un combat:state que cumpla el predicado"));
    }, timeout);
    handler = (payload) => {
      if (!predicate(payload.combat)) return;
      clearTimeout(timer);
      socket.off("combat:state", handler);
      resolve(payload.combat);
    };
    socket.on("combat:state", handler);
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-round-"));
  built = await buildApp({
    dbPath: join(dir, "round.sqlite"),
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

describe("Fase 3C — declaraciones, lock y ronda", () => {
  it("declara, bloquea y resuelve con clash cruzado, one-sided, redirección y efecto", async () => {
    const scenario = await setupScenario();
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "round-main" },
    );
    expect(started.phase).toBe("declaring");
    expect(started.round).toBe(1);
    expect(Object.keys(started.actions)).toHaveLength(4);

    const { p1, p2, e1, e2 } = mainRoundUnits(started);

    const declared = built.combat.declareActions(
      playerActorFor(scenario, p1.characterId),
      started.id,
      [
        { slot: 2, skillId: scenario.skillId, targetId: e1.id },
        { slot: 1, skillId: scenario.skillId, targetId: e1.id },
      ],
    );
    expect(declared.actions[p1.id]).toEqual([
      {
        unitId: p1.id,
        slot: 1,
        skillId: scenario.skillId,
        targetId: e1.id,
        locked: false,
      },
      {
        unitId: p1.id,
        slot: 2,
        skillId: scenario.skillId,
        targetId: e1.id,
        locked: false,
      },
    ]);
    // Reemplazo: declarar de nuevo sustituye, no acumula.
    const replaced = built.combat.declareActions(
      playerActorFor(scenario, p1.characterId),
      started.id,
      [{ slot: 1, skillId: scenario.skillId, targetId: e1.id }],
    );
    expect(replaced.actions[p1.id]).toHaveLength(1);

    declareMainRound(scenario, started);
    const afterPlayers = built.combat.lockActions(
      started.id,
      playerActorFor(scenario, p1.characterId),
    );
    expect(afterPlayers.phase).toBe("declaring");
    expect(afterPlayers.lockedUnits?.[p1.id]).toBe(true);
    expect(afterPlayers.actions[p1.id]?.every((action) => action.locked)).toBe(
      true,
    );

    const afterP2 = built.combat.lockActions(
      started.id,
      playerActorFor(scenario, p2.characterId),
    );
    expect(afterP2.phase).toBe("declaring");
    const afterDm = built.combat.lockActions(started.id, dmActor());
    expect(afterDm.phase).toBe("resolving");
    expect(afterDm.lockedUnits?.[e1.id]).toBe(true);
    expect(afterDm.lockedUnits?.[e2.id]).toBe(true);

    const resolved = built.combat.resolveCombatRound(started.id);
    expect(resolved.round).toBe(2);
    expect(resolved.phase).toBe("declaring");
    expect(resolved.actions[p1.id]).toEqual([]);
    expect(resolved.actions[e1.id]).toEqual([]);
    expect(resolved.lockedUnits).toEqual({});
    expect(resolved.winner).toBeUndefined();

    const events = resolved.log.slice(1);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "redirect")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "clash" &&
          event.data?.attackerSlot === 1 &&
          event.data?.defenderSlot === 2,
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "clash" && event.data?.oneSided === true,
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "effectApplied")).toBe(true);
    expect(events.some((event) => event.type === "damage")).toBe(true);

    // Persistencia y log append-only.
    expect(built.combatStore.getState(started.id)).toEqual(resolved);
    expect(
      built.combatStore.listEvents(started.id).map((event) => event.id),
    ).toEqual(resolved.log.map((event) => event.id));
    expect(built.sessions.getById(scenario.sessionId)?.status).toBe("combat");
  });

  it("espera a todos los vivos y permite lock de unidades con 0 acciones", async () => {
    const scenario = await setupScenario({ enemyCount: 1, enemySkills: false });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "lock-empty" },
    );
    // El escenario tiene 3 unidades; seleccionamos explícitamente.
    const playerOne = unitOf(started, scenario.playerOne.id);
    const playerTwo = unitOf(started, scenario.playerTwo.id);
    const enemyOne = unitOf(started, scenario.enemyOne.id);

    let locked = built.combat.lockActions(
      started.id,
      playerActorFor(scenario, playerOne.characterId),
    );
    expect(locked.phase).toBe("declaring");
    expect(locked.lockedUnits?.[playerOne.id]).toBe(true);
    expect(locked.actions[playerOne.id]).toEqual([]);

    locked = built.combat.lockActions(started.id, dmActor());
    expect(locked.phase).toBe("declaring");
    expect(locked.lockedUnits?.[enemyOne.id]).toBe(true);
    expect(locked.lockedUnits?.[playerTwo.id]).not.toBe(true);

    locked = built.combat.lockActions(
      started.id,
      playerActorFor(scenario, playerTwo.characterId),
    );
    expect(locked.phase).toBe("resolving");

    const resolved = built.combat.resolveCombatRound(started.id);
    expect(resolved.round).toBe(2);
    expect(resolved.phase).toBe("declaring");
    expect(resolved.actions[playerOne.id]).toEqual([]);
    expect(resolved.lockedUnits).toEqual({});
  });

  it("no cuenta a las unidades derrotadas para el lock global", async () => {
    const scenario = await setupScenario({
      enemyHp: 5,
      enemySkills: false,
    });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "lock-dead" },
    );
    const { p1, p2, e1, e2 } = mainRoundUnits(started);

    built.combat.declareActions(
      playerActorFor(scenario, p1.characterId),
      started.id,
      [{ slot: 1, skillId: scenario.skillId, targetId: e1.id }],
    );
    lockAllLiving(scenario, started);
    const resolved = built.combat.resolveCombatRound(started.id);

    expect(resolved.phase).toBe("declaring");
    expect(
      resolved.units.find((unit) => unit.id === e1.id)?.defeated,
    ).toBe(true);
    expect(resolved.winner).toBeUndefined();

    // Ronda 2: E1 está derrotada y no debe bloquearse ni contar.
    let locked = built.combat.lockActions(
      started.id,
      playerActorFor(scenario, p1.characterId),
    );
    locked = built.combat.lockActions(
      started.id,
      playerActorFor(scenario, p2.characterId),
    );
    expect(locked.phase).toBe("declaring");
    locked = built.combat.lockActions(started.id, dmActor());
    expect(locked.phase).toBe("resolving");
    expect(locked.lockedUnits?.[e1.id]).not.toBe(true);
    expect(locked.lockedUnits?.[e2.id]).toBe(true);
  });

  it("termina el combate, persiste HP y devuelve la sesión a playing", async () => {
    const scenario = await setupScenario({
      enemyCount: 1,
      enemyHp: 5,
      enemySkills: false,
      playerHp: 37,
    });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "end-round" },
    );
    const p1 = unitOf(started, scenario.playerOne.id);
    const e1 = unitOf(started, scenario.enemyOne.id);

    built.combat.declareActions(
      playerActorFor(scenario, p1.characterId),
      started.id,
      [{ slot: 1, skillId: scenario.skillId, targetId: e1.id }],
    );
    lockAllLiving(scenario, started);

    const ended = built.combat.resolveCombatRound(started.id);
    expect(ended.phase).toBe("ended");
    expect(ended.winner).toBe("players");
    expect(ended.log.at(-1)).toMatchObject({ type: "combatEnd", round: 1 });
    expect(
      ended.log.some(
        (event) => event.type === "defeated" && event.targetId === e1.id,
      ),
    ).toBe(true);

    expect(built.sessions.getById(scenario.sessionId)?.status).toBe("playing");
    expect(
      built.repository.getContent("characters", scenario.playerOne.id)
        .hpCurrent,
    ).toBe(37);
    expect(built.combatStore.getState(started.id)?.phase).toBe("ended");
    expect(built.combatStore.listEvents(started.id)).toHaveLength(
      ended.log.length,
    );

    // Reintento idempotente: ni eventos ni HP duplicados.
    const again = built.combat.resolveCombatRound(started.id);
    expect(again.log).toHaveLength(ended.log.length);
    expect(built.combatStore.listEvents(started.id)).toHaveLength(
      ended.log.length,
    );
  });

  it("reintentar resolver una ronda no duplica daño ni eventos", async () => {
    const scenario = await setupScenario();
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "idempotent" },
    );
    declareMainRound(scenario, started);
    lockAllLiving(scenario, started);
    const resolved = built.combat.resolveCombatRound(started.id);

    const hpBefore = resolved.units.map((unit) => unit.hpCurrent);
    const logLength = resolved.log.length;

    expectHttpError(
      () => built.combat.resolveCombatRound(started.id),
      "round_not_ready",
    );

    const after = built.combat.getState(started.id);
    expect(after.log).toHaveLength(logLength);
    expect(after.units.map((unit) => unit.hpCurrent)).toEqual(hpBefore);
    expect(built.combatStore.listEvents(started.id)).toHaveLength(logLength);
  });

  it("resuelve el dominio una vez por combate y rechaza repetirlo", async () => {
    const scenario = await setupScenario({
      seedContent: true,
      withDomain: true,
      enemyCount: 1,
      // El dominio suma ATK y las dos caras pueden duplicar el daño; el
      // enemigo debe sobrevivir para comprobar la segunda ronda.
      enemyHp: 900,
      enemySkills: false,
    });
    expect(scenario.domainId).toBeDefined();
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "domain" },
    );
    const p1 = unitOf(started, scenario.playerOne.id);
    const e1 = unitOf(started, scenario.enemyOne.id);

    built.combat.declareActions(
      playerActorFor(scenario, p1.characterId),
      started.id,
      [
        { slot: 1, special: "domain" },
        { slot: 2, skillId: scenario.skillId, targetId: e1.id },
      ],
    );
    lockAllLiving(scenario, started);
    const resolved = built.combat.resolveCombatRound(started.id);

    expect(resolved.phase).toBe("declaring");
    expect(resolved.specialCooldowns[p1.id]?.[scenario.domainId!]).toBe(
      SPECIAL_USED,
    );
    const events = resolved.log.slice(1);
    expect(
      events.some(
        (event) =>
          event.type === "special" &&
          event.data?.specialId === scenario.domainId,
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "effectApplied")).toBe(true);

    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [{ slot: 1, special: "domain" }],
        ),
      "special_unavailable",
    );
  });

  it("consume usos de utilidad y rechaza declarar sin usos", async () => {
    const scenario = await setupScenario({
      enemyCount: 1,
      enemySkills: false,
      utilityUses: 2,
    });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "utility" },
    );
    const p1 = unitOf(started, scenario.playerOne.id);

    built.combat.declareActions(
      playerActorFor(scenario, p1.characterId),
      started.id,
      [
        { slot: 1, utilityId: scenario.utilityId, targetId: p1.id },
        { slot: 2, utilityId: scenario.utilityId, targetId: p1.id },
      ],
    );
    lockAllLiving(scenario, started);
    const resolved = built.combat.resolveCombatRound(started.id);
    expect(
      resolved.units.find((unit) => unit.id === p1.id)?.utilityUses,
    ).toBe(0);

    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [{ slot: 1, utilityId: scenario.utilityId, targetId: p1.id }],
        ),
      "utility_no_uses",
    );
  });

  it("valida propiedad, existencia y estado de los objetivos", async () => {
    const scenario = await setupScenario({
      enemyTwoHpCurrent: 0,
      enemySkills: false,
    });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "validation-targets" },
    );
    const p1 = unitOf(started, scenario.playerOne.id);
    const p2 = unitOf(started, scenario.playerTwo.id);
    const e1 = unitOf(started, scenario.enemyOne.id);
    const deadEnemy = unitOf(started, scenario.enemyTwo!.id);

    // El DM no puede declarar por un jugador.
    expectHttpError(
      () =>
        built.combat.declareActions(dmActor(p1.id), started.id, [
          { slot: 1, skillId: scenario.skillId, targetId: e1.id },
        ]),
      "dm_only_enemies",
    );

    // Un jugador no puede suplantar a otro: manda el token de la sesión.
    const forged: CombatActor = {
      role: "player",
      player: {
        ...scenario.players.find(
          (entry) => entry.characterId === scenario.playerOne.id,
        )!,
        characterId: scenario.playerTwo.id,
      },
    };
    const forgedState = built.combat.declareActions(forged, started.id, [
      { slot: 1, skillId: scenario.skillId, targetId: e1.id },
    ]);
    expect(forgedState.actions[p1.id]).toHaveLength(1);
    expect(forgedState.actions[p2.id]).toEqual([]);

    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [{ slot: 1, skillId: scenario.skillId, targetId: "missing" }],
        ),
      "target_not_found",
    );

    expect(deadEnemy.defeated).toBe(true);
    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [{ slot: 1, skillId: scenario.skillId, targetId: deadEnemy.id }],
        ),
      "target_defeated",
    );

    expectHttpError(
      () =>
        built.combat.declareActions(dmActor(deadEnemy.id), started.id, [
          { slot: 1, skillId: scenario.skillId, targetId: p1.id },
        ]),
      "unit_defeated",
    );
  });

  it("valida slots duplicados, fuera de rango y acciones mal formadas", async () => {
    const scenario = await setupScenario({ enemyCount: 1 });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "validation-slots" },
    );
    const p1 = unitOf(started, scenario.playerOne.id);
    const e1 = unitOf(started, scenario.enemyOne.id);
    const actor = playerActorFor(scenario, p1.characterId);

    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          { slot: 1, skillId: scenario.skillId, targetId: e1.id },
          { slot: 1, skillId: scenario.skillId, targetId: e1.id },
        ]),
      "duplicate_slot",
    );
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          { slot: 3, skillId: scenario.skillId, targetId: e1.id },
        ]),
      "slot_out_of_range",
    );
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          { slot: 0, skillId: scenario.skillId, targetId: e1.id },
        ]),
      "slot_out_of_range",
    );
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          { slot: 1, targetId: e1.id },
        ] as DeclaredActionInput[]),
      "invalid_action",
    );
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          {
            slot: 1,
            skillId: scenario.skillId,
            utilityId: scenario.utilityId,
            targetId: e1.id,
          },
        ]),
      "invalid_action",
    );
  });

  it("valida skill/utilidad equipadas y usos declarados en la ronda", async () => {
    const scenario = await setupScenario({
      enemyCount: 1,
      utilityUses: 1,
    });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "validation-equipment" },
    );
    const p1 = unitOf(started, scenario.playerOne.id);
    const p2 = unitOf(started, scenario.playerTwo.id);
    const e1 = unitOf(started, scenario.enemyOne.id);

    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [
            {
              slot: 1,
              skillId: scenario.otherSkillId,
              targetId: e1.id,
            },
          ],
        ),
      "skill_not_equipped",
    );

    // Una utilidad con 1 uso no se puede declarar dos veces en la misma ronda.
    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [
            { slot: 1, utilityId: scenario.utilityId, targetId: p1.id },
            { slot: 2, utilityId: scenario.utilityId, targetId: p1.id },
          ],
        ),
      "utility_no_uses",
    );

    // P2 no lleva utilidad equipada.
    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p2.characterId),
          started.id,
          [{ slot: 1, utilityId: scenario.utilityId, targetId: p2.id }],
        ),
      "utility_not_equipped",
    );

    // La redirección exige una skill.
    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [
            {
              slot: 1,
              utilityId: scenario.utilityId,
              targetId: e1.id,
              redirectFor: p2.id,
            },
          ],
        ),
      "redirect_requires_skill",
    );

    // Sin dominio equipado no se puede declarar "domain".
    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [{ slot: 1, special: "domain" }],
        ),
      "special_not_equipped",
    );
  });

  it("valida la coherencia de la redirección (aliado, atacante y SPD)", async () => {
    const scenario = await setupScenario({
      playerSpd: 10,
      playerTwoSpd: 5,
      enemySpd: 10,
      enemyTwoSpd: 12,
      enemySkills: false,
    });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "validation-redirect" },
    );
    const p1 = unitOf(started, scenario.playerOne.id);
    const p2 = unitOf(started, scenario.playerTwo.id);
    const e1 = unitOf(started, scenario.enemyOne.id);
    const e2 = unitOf(started, scenario.enemyTwo!.id);
    const actor = playerActorFor(scenario, p1.characterId);

    // SPD igual: inválida.
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          {
            slot: 1,
            skillId: scenario.skillId,
            targetId: e1.id,
            redirectFor: p2.id,
          },
        ]),
      "redirect_speed",
    );
    // SPD menor: inválida.
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          {
            slot: 1,
            skillId: scenario.skillId,
            targetId: e2.id,
            redirectFor: p2.id,
          },
        ]),
      "redirect_speed",
    );
    // No se puede proteger a un enemigo.
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          {
            slot: 1,
            skillId: scenario.skillId,
            targetId: e2.id,
            redirectFor: e1.id,
          },
        ]),
      "redirect_not_ally",
    );
    // El objetivo de una redirección debe ser enemigo.
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          {
            slot: 1,
            skillId: scenario.skillId,
            targetId: p2.id,
            redirectFor: p2.id,
          },
        ]),
      "redirect_target_not_enemy",
    );
    // No puedes redirigir hacia ti mismo.
    expectHttpError(
      () =>
        built.combat.declareActions(actor, started.id, [
          {
            slot: 1,
            skillId: scenario.skillId,
            targetId: e1.id,
            redirectFor: p1.id,
          },
        ]),
      "redirect_invalid_ally",
    );
  });

  it("rechaza declarar si el combate ya no está en declaring", async () => {
    const scenario = await setupScenario({ enemyCount: 1, enemySkills: false });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "phase" },
    );
    const p1 = unitOf(started, scenario.playerOne.id);
    const e1 = unitOf(started, scenario.enemyOne.id);

    // Sin acciones, los locks pasan la fase a resolving.
    lockAllLiving(scenario, started);
    expect(built.combat.getState(started.id).phase).toBe("resolving");

    expectHttpError(
      () =>
        built.combat.declareActions(
          playerActorFor(scenario, p1.characterId),
          started.id,
          [{ slot: 1, skillId: scenario.skillId, targetId: e1.id }],
        ),
      "invalid_phase",
    );
  });

  it("misma seed y mismas acciones producen el mismo log normalizado", async () => {
    const first = await setupScenario();
    const second = await setupScenario();
    const firstState = built.combat.startEncounter(
      first.campaignId,
      first.encounterId,
      first.sessionId,
      { seed: "determinism" },
    );
    const secondState = built.combat.startEncounter(
      second.campaignId,
      second.encounterId,
      second.sessionId,
      { seed: "determinism" },
    );

    declareMainRound(first, firstState);
    declareMainRound(second, secondState);
    lockAllLiving(first, firstState);
    lockAllLiving(second, secondState);
    const firstResolved = built.combat.resolveCombatRound(firstState.id);
    const secondResolved = built.combat.resolveCombatRound(secondState.id);

    const firstEvents = normalizeEvents(
      first,
      firstResolved,
      firstResolved.log.slice(1),
    );
    const secondEvents = normalizeEvents(
      second,
      secondResolved,
      secondResolved.log.slice(1),
    );
    expect(firstEvents).toEqual(secondEvents);
  });

  it("recupera un combate ya decidido que quedó en declaring", async () => {
    const scenario = await setupScenario({
      enemyCount: 1,
      enemyHp: 5,
      enemySkills: false,
    });
    const started = built.combat.startEncounter(
      scenario.campaignId,
      scenario.encounterId,
      scenario.sessionId,
      { seed: "recovery" },
    );
    const e1 = unitOf(started, scenario.enemyOne.id);
    const broken = structuredClone(started);
    broken.winner = "players";
    broken.units = broken.units.map((unit) =>
      unit.id === e1.id
        ? { ...unit, hpCurrent: 0, defeated: true }
        : unit,
    );
    built.combatStore.save(broken);

    const ended = built.combat.resolveCombatRound(started.id);
    expect(ended.phase).toBe("ended");
    expect(ended.winner).toBe("players");
    expect(built.sessions.getById(scenario.sessionId)?.status).toBe("playing");
  });

  it("emite combat:state y combat:event sin seed por socket", async () => {
    const scenario = await setupScenario();
    const socket = ioClient(baseUrl, {
      auth: { code: scenario.sessionCode, token: scenario.dmToken },
      transports: ["websocket"],
      forceNew: true,
    });

    try {
      const ready = once<{ role: string }>(socket, "session:state");
      await once(socket, "connect");
      expect((await ready).role).toBe("dm");

      const startedPromise = once<{ combat: PublicCombatState }>(
        socket,
        "combat:started",
      );
      const started = built.combat.startEncounter(
        scenario.campaignId,
        scenario.encounterId,
        scenario.sessionId,
        { seed: "socket" },
      );
      const startedPayload = await startedPromise;
      expect(startedPayload.combat).not.toHaveProperty("seed");

      const { p1, p2, e1 } = mainRoundUnits(started);
      const declaredPromise = waitForCombatState(
        socket,
        (combat) => (combat.actions[p1.id]?.length ?? 0) === 1,
      );
      built.combat.declareActions(
        playerActorFor(scenario, p1.characterId),
        started.id,
        [{ slot: 1, skillId: scenario.skillId, targetId: e1.id }],
      );
      const declared = await declaredPromise;
      expect(declared.actions[p1.id]).toHaveLength(1);
      expect(declared).not.toHaveProperty("seed");

      declareMainRound(scenario, started);
      // Espera a que el último estado con las declaraciones de todos llegue
      // antes de bloquear; así no compiten estados antiguos en vuelo.
      await waitForCombatState(
        socket,
        (combat) =>
          (combat.actions[p2.id]?.length ?? 0) === 2 &&
          (combat.actions[e1.id]?.length ?? 0) === 2,
      );

      const lockedPromise = waitForCombatState(
        socket,
        (combat) => combat.phase === "resolving",
      );
      built.combat.lockActions(
        started.id,
        playerActorFor(scenario, p1.characterId),
      );
      built.combat.lockActions(
        started.id,
        playerActorFor(scenario, p2.characterId),
      );
      built.combat.lockActions(started.id, dmActor());
      const locked = await lockedPromise;
      expect(locked.phase).toBe("resolving");

      const received: CombatEvent[] = [];
      socket.on("combat:event", (payload: { event: CombatEvent }) => {
        received.push(payload.event);
      });
      const finalPromise = waitForCombatState(
        socket,
        (combat) => combat.round === 2,
      );
      built.combat.resolveCombatRound(started.id);
      const finalState = await finalPromise;

      expect(received.length).toBeGreaterThan(0);
      expect(received.some((event) => event.type === "clash")).toBe(true);
      expect(finalState).not.toHaveProperty("seed");
      expect(finalState.id).toBe(started.id);
      expect(finalState.round).toBe(2);
    } finally {
      socket.disconnect();
    }
  });

  it("emite combat:ended con ganador y log al cerrar por victoria", async () => {
    const scenario = await setupScenario({
      enemyCount: 1,
      enemyHp: 5,
      enemySkills: false,
    });
    const socket = ioClient(baseUrl, {
      auth: { code: scenario.sessionCode, token: scenario.dmToken },
      transports: ["websocket"],
      forceNew: true,
    });

    try {
      const ready = once<{ role: string }>(socket, "session:state");
      await once(socket, "connect");
      await ready;

      const startedPromise = once<{ combat: PublicCombatState }>(
        socket,
        "combat:started",
      );
      const started = built.combat.startEncounter(
        scenario.campaignId,
        scenario.encounterId,
        scenario.sessionId,
        { seed: "socket-ended" },
      );
      await startedPromise;

      const p1 = unitOf(started, scenario.playerOne.id);
      const e1 = unitOf(started, scenario.enemyOne.id);
      built.combat.declareActions(
        playerActorFor(scenario, p1.characterId),
        started.id,
        [{ slot: 1, skillId: scenario.skillId, targetId: e1.id }],
      );
      lockAllLiving(scenario, started);

      const endedPromise = once<{
        winner?: string;
        log: CombatEvent[];
      }>(socket, "combat:ended");
      built.combat.resolveCombatRound(started.id);
      const ended = await endedPromise;

      expect(ended.winner).toBe("players");
      expect(ended.log.at(-1)?.type).toBe("combatEnd");
      expect(ended.log.at(-1)?.data).toMatchObject({ winner: "players" });
    } finally {
      socket.disconnect();
    }
  });
});
