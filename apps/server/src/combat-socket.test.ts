import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  Character,
  CombatEvent,
  Encounter,
  PublicCombatState,
  SessionPlayer,
  Skill,
  StateFullPayload,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";

/**
 * Fase 3D — Socket.IO de combate.
 *
 * Dos clientes reales (DM + jugadores) sobre una SQLite temporal. Valida
 * permisos por token, declaraciones, auto-resolución al bloquear todos,
 * cierre del DM, reconexión con `state:full` y payloads Zod.
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

/**
 * Espera el primer `combat:state` que cumpla el predicado. Evita que estados
 * antiguos en vuelo hagan fallar una aserción sobre la fase/ronda esperada.
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

interface SocketScenario {
  campaign: Campaign;
  campaignId: string;
  encounterId: string;
  sessionId: string;
  sessionCode: string;
  dmToken: string;
  players: SessionPlayer[];
  playerOne: Character;
  playerTwo: Character;
  enemy: Character;
  skillId: string;
  enemySkillId: string;
}

async function setupScenario(): Promise<SocketScenario> {
  scenarioCounter += 1;
  const campaign = built.repository.createCampaign({
    name: `Socket 3D ${scenarioCounter}`,
    seed: false,
  });

  const skill = built.repository.createContent(
    "skills",
    campaign.id,
    {
      name: "Golpe de socket",
      unlocked: true,
      coins: 2,
      baseClash: 5,
      coinClash: 2,
      baseDamage: 5,
      coinDamage: 1,
    },
  ) as Skill;

  const playerPayload = {
    kind: "player",
    baseStats: { hpMax: 200, def: 0, atk: 10, spd: 10, luck: 0, skillSlots: 2 },
    equipment: {
      horns: null,
      hand: null,
      armor: null,
      leg: null,
      utility: null,
    },
    skills: [skill.id, null, null],
    inventory: [],
  };

  const playerOne = built.repository.createContent(
    "characters",
    campaign.id,
    {
      ...playerPayload,
      name: "Socket Uno",
      baseStats: { ...playerPayload.baseStats, spd: 20 },
    },
  ) as Character;

  const playerTwo = built.repository.createContent(
    "characters",
    campaign.id,
    { ...playerPayload, name: "Socket Dos" },
  ) as Character;

  // Skill bloqueada solo para enemigos: no debe llegar al jugador fuera de
  // combate, pero sí durante el combate para que la UI pueda nombrarla.
  const enemySkill = built.repository.createContent(
    "skills",
    campaign.id,
    {
      name: "Golpe enemigo oculto",
      unlocked: false,
      coins: 1,
      baseClash: 1,
      coinClash: 1,
      baseDamage: 1,
      coinDamage: 1,
    },
  ) as Skill;

  const enemy = built.repository.createContent(
    "characters",
    campaign.id,
    {
      name: "Eco Socket",
      kind: "enemy",
      baseStats: { hpMax: 200, def: 0, atk: 10, spd: 5, luck: 0, skillSlots: 2 },
      equipment: {
        horns: null,
        hand: null,
        armor: null,
        leg: null,
        utility: null,
      },
      skills: [skill.id, enemySkill.id, null],
      inventory: [],
    },
  ) as Character;

  const encounter = built.repository.createContent(
    "encounters",
    campaign.id,
    {
      name: "Protocolo de socket",
      enemies: [{ characterId: enemy.id, count: 1 }],
    },
  ) as Encounter;

  const hosted = built.sessions.host(campaign.id);
  built.sessions.join(hosted.session.code, {
    name: "Ana",
    characterId: playerOne.id,
  });
  built.sessions.join(hosted.session.code, {
    name: "Beto",
    characterId: playerTwo.id,
  });
  const session = built.sessions.getById(hosted.session.id);
  if (!session) throw new Error("La sesión de prueba no se creó.");

  return {
    campaign: built.repository.getCampaign(campaign.id),
    campaignId: campaign.id,
    encounterId: encounter.id,
    sessionId: hosted.session.id,
    sessionCode: hosted.session.code,
    dmToken: hosted.dmToken,
    players: session.players,
    playerOne,
    playerTwo,
    enemy,
    skillId: skill.id,
    enemySkillId: enemySkill.id,
  };
}

async function connect(code: string, token: string): Promise<Socket> {
  const socket = ioClient(baseUrl, {
    auth: { code, token },
    transports: ["websocket"],
    forceNew: true,
    autoConnect: false,
  });
  const connected = once(socket, "connect");
  const sessionState = once<{ role: string }>(socket, "session:state");
  socket.connect();
  await connected;
  await sessionState;
  return socket;
}

function playerToken(scenario: SocketScenario, characterId: string): string {
  const player = scenario.players.find(
    (entry) => entry.characterId === characterId,
  );
  if (!player) throw new Error("El jugador no pertenece a la sesión.");
  return player.token;
}

function unitOf(
  combat: PublicCombatState,
  characterId: string,
): PublicCombatState["units"][number] {
  const unit = combat.units.find(
    (entry) => entry.characterId === characterId,
  );
  if (!unit) throw new Error("La ficha no está en el combate.");
  return unit;
}

async function startCombat(
  dm: Socket,
  scenario: SocketScenario,
  also: Socket[] = [],
  encounterId = scenario.encounterId,
): Promise<PublicCombatState> {
  const dmStarted = once<{ combat: PublicCombatState }>(
    dm,
    "combat:started",
  );
  const others = also.map((socket) =>
    once<{ combat: PublicCombatState }>(socket, "combat:started"),
  );
  dm.emit("combat:start", { encounterId });
  const [payload] = await Promise.all([dmStarted, ...others]);
  return payload.combat;
}

function expectSocketError(error: { code: string; message: string }, code: string): void {
  expect(error.code).toBe(code);
  expect(error.message.length).toBeGreaterThan(0);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-socket-"));
  built = await buildApp({
    dbPath: join(dir, "socket.sqlite"),
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

describe("Fase 3D — Socket.IO de combate", () => {
  it("DM inicia; una jugadora declara y el otro ve el estado; la ronda se resuelve al bloquear todos", async () => {
    const scenario = await setupScenario();
    const dm = await connect(scenario.sessionCode, scenario.dmToken);
    const p1 = await connect(
      scenario.sessionCode,
      playerToken(scenario, scenario.playerOne.id),
    );
    const p2 = await connect(
      scenario.sessionCode,
      playerToken(scenario, scenario.playerTwo.id),
    );

    try {
      const combat = await startCombat(dm, scenario, [p1, p2]);
      const p1Unit = unitOf(combat, scenario.playerOne.id);
      const p2Unit = unitOf(combat, scenario.playerTwo.id);
      const enemyUnit = unitOf(combat, scenario.enemy.id);

      // P1 declara 2 acciones y el otro cliente ve el estado con esas acciones.
      const seesP1 = waitForCombatState(
        p2,
        (state) => (state.actions[p1Unit.id]?.length ?? 0) === 2,
      );
      p1.emit("combat:declare", {
        round: 1,
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
          { slot: 2, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      const seenP1 = await seesP1;
      expect(seenP1.actions[p1Unit.id]).toHaveLength(2);
      expect(seenP1).not.toHaveProperty("seed");

      // P2 declara; P1 ve el estado actualizado.
      const seesP2 = waitForCombatState(
        p1,
        (state) => (state.actions[p2Unit.id]?.length ?? 0) === 2,
      );
      p2.emit("combat:declare", {
        round: 1,
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
          { slot: 2, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      await seesP2;

      // DM declara el enemigo.
      const seesEnemy = waitForCombatState(
        dm,
        (state) => (state.actions[enemyUnit.id]?.length ?? 0) === 2,
      );
      dm.emit("combat:declare", {
        round: 1,
        actions: [
          {
            unitId: enemyUnit.id,
            slot: 1,
            skillId: scenario.skillId,
            targetId: p1Unit.id,
          },
          {
            unitId: enemyUnit.id,
            slot: 2,
            skillId: scenario.skillId,
            targetId: p2Unit.id,
          },
        ],
      });
      await seesEnemy;

      const events: CombatEvent[] = [];
      p1.on("combat:event", (payload: { event: CombatEvent }) => {
        events.push(payload.event);
      });

      // El último lock dispara la resolución automática de la ronda.
      const finalP1 = waitForCombatState(p1, (state) => state.round === 2);
      const finalP2 = waitForCombatState(p2, (state) => state.round === 2);
      p1.emit("combat:lock", { round: 1 });
      p2.emit("combat:lock", { round: 1 });
      dm.emit("combat:lock", { round: 1 });

      const [state1, state2] = await Promise.all([finalP1, finalP2]);
      expect(state1.round).toBe(2);
      expect(state2.round).toBe(2);
      expect(state1.phase).toBe("declaring");
      expect(state2.phase).toBe("declaring");
      expect(state1.units).toEqual(state2.units);
      expect(state1.actions).toEqual(state2.actions);
      expect(state1.lockedUnits).toEqual({});
      expect(events.some((event) => event.type === "clash")).toBe(true);
      expect(events.some((event) => event.type === "damage")).toBe(true);

      // Un lock de la ronda anterior no debe bloquear la ronda nueva.
      const staleLockState = waitForCombatState(
        p1,
        (state) =>
          state.round === 2 && state.lockedUnits?.[p1Unit.id] !== true,
      );
      p1.emit("combat:lock", { round: 1 });
      const afterStaleLock = await staleLockState;
      expect(afterStaleLock.round).toBe(2);
      expect(afterStaleLock.lockedUnits?.[p1Unit.id]).not.toBe(true);

      // Declarar con la ronda vieja devuelve stale_round y no toca el estado.
      const staleError = once<{ code: string; message: string }>(p1, "error");
      p1.emit("combat:declare", {
        round: 1,
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      expectSocketError(await staleError, "stale_round");

      // La misma ronda en otro combate tampoco debe colarse por un lock viejo.
      const wrongCombatState = waitForCombatState(
        p1,
        (state) =>
          state.round === 2 && state.lockedUnits?.[p1Unit.id] !== true,
      );
      p1.emit("combat:lock", { combatId: "cmb_otro", round: 2 });
      const afterWrongCombat = await wrongCombatState;
      expect(afterWrongCombat.lockedUnits?.[p1Unit.id]).not.toBe(true);

      const wrongCombatError = once<{ code: string; message: string }>(
        p1,
        "error",
      );
      p1.emit("combat:declare", {
        combatId: "cmb_otro",
        round: 2,
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      expectSocketError(await wrongCombatError, "stale_round");

      // DM termina el combate; ambos clientes reciben el cierre.
      const endedP1 = once<{ winner?: string; log: CombatEvent[] }>(
        p1,
        "combat:ended",
      );
      const endedP2 = once<{ winner?: string; log: CombatEvent[] }>(
        p2,
        "combat:ended",
      );
      dm.emit("combat:end", {});
      const [ended1, ended2] = await Promise.all([endedP1, endedP2]);
      expect(ended1.log.at(-1)?.type).toBe("combatEnd");
      expect(ended2.log.at(-1)?.type).toBe("combatEnd");
      expect(ended1.winner).toBe(ended2.winner);
      expect(built.sessions.getById(scenario.sessionId)?.status).toBe("playing");
    } finally {
      dm.disconnect();
      p1.disconnect();
      p2.disconnect();
    }
  });

  it("un jugador no puede declarar por otro ni iniciar/terminar; el DM solo declara enemigos", async () => {
    const scenario = await setupScenario();
    const dm = await connect(scenario.sessionCode, scenario.dmToken);
    const p1 = await connect(
      scenario.sessionCode,
      playerToken(scenario, scenario.playerOne.id),
    );
    const p2 = await connect(
      scenario.sessionCode,
      playerToken(scenario, scenario.playerTwo.id),
    );

    try {
      const combat = await startCombat(dm, scenario);
      const p1Unit = unitOf(combat, scenario.playerOne.id);
      const p2Unit = unitOf(combat, scenario.playerTwo.id);
      const enemyUnit = unitOf(combat, scenario.enemy.id);

      // Aunque P2 mande el unitId de P1, el servidor usa su token: declara P2.
      const p2Declared = waitForCombatState(
        dm,
        (state) => (state.actions[p2Unit.id]?.length ?? 0) === 1,
      );
      p2.emit("combat:declare", {
        unitId: p1Unit.id,
        actions: [
          {
            unitId: p1Unit.id,
            slot: 1,
            skillId: scenario.skillId,
            targetId: enemyUnit.id,
          },
        ],
      });
      const after = await p2Declared;
      expect(after.actions[p2Unit.id]).toHaveLength(1);
      expect(after.actions[p1Unit.id] ?? []).toEqual([]);

      // Una vez bloqueada, la unidad no puede cambiar sus acciones.
      const p2Locked = waitForCombatState(
        dm,
        (state) => state.lockedUnits?.[p2Unit.id] === true,
      );
      p2.emit("combat:lock", {});
      await p2Locked;
      let error = once<{ code: string; message: string }>(p2, "error");
      p2.emit("combat:declare", {
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      expectSocketError(await error, "unit_locked");

      error = once<{ code: string; message: string }>(p2, "error");
      p2.emit("combat:start", { encounterId: scenario.encounterId });
      expectSocketError(await error, "dm_only");

      error = once<{ code: string; message: string }>(p2, "error");
      p2.emit("combat:end", {});
      expectSocketError(await error, "dm_only");

      error = once<{ code: string; message: string }>(dm, "error");
      dm.emit("combat:declare", {
        unitId: p1Unit.id,
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      expectSocketError(await error, "dm_only_enemies");

      expect(
        built.combat.getState(combat.id).actions[p1Unit.id] ?? [],
      ).toEqual([]);
    } finally {
      dm.disconnect();
      p1.disconnect();
      p2.disconnect();
    }
  });

  it("el DM inicia, declara enemigos, bloquea y termina el combate", async () => {
    const scenario = await setupScenario();
    const dm = await connect(scenario.sessionCode, scenario.dmToken);
    const p1 = await connect(
      scenario.sessionCode,
      playerToken(scenario, scenario.playerOne.id),
    );

    try {
      // El DM crea el encuentro por la API (token de DM), no por DB directa.
      const createdEncounter = await app.inject({
        method: "POST",
        url: `/api/campaigns/${scenario.campaignId}/encounters`,
        headers: { "x-session-token": scenario.dmToken },
        payload: {
          name: "Emboscada del DM",
          description: "Creado desde la consola.",
          enemies: [{ characterId: scenario.enemy.id, count: 1 }],
        },
      });
      expect(createdEncounter.statusCode, createdEncounter.body).toBe(201);
      const encounter = createdEncounter.json() as Encounter;

      const combat = await startCombat(dm, scenario, [p1], encounter.id);
      const p1Unit = unitOf(combat, scenario.playerOne.id);
      const enemyUnit = unitOf(combat, scenario.enemy.id);

      const declared = waitForCombatState(
        dm,
        (state) => (state.actions[enemyUnit.id]?.length ?? 0) === 2,
      );
      dm.emit("combat:declare", {
        combatId: combat.id,
        round: 1,
        unitId: enemyUnit.id,
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: p1Unit.id },
          { slot: 2, skillId: scenario.skillId, targetId: p1Unit.id },
        ],
      });
      const afterDeclare = await declared;
      expect(afterDeclare.actions[enemyUnit.id]).toHaveLength(2);

      const locked = waitForCombatState(
        dm,
        (state) => state.lockedUnits?.[enemyUnit.id] === true,
      );
      dm.emit("combat:lock", { combatId: combat.id, round: 1 });
      const afterLock = await locked;
      expect(afterLock.lockedUnits?.[enemyUnit.id]).toBe(true);
      // El lock del DM no bloquea a los jugadores ni resuelve la ronda.
      expect(afterLock.lockedUnits?.[p1Unit.id]).not.toBe(true);
      expect(afterLock.phase).toBe("declaring");

      const ended = once<{ log: CombatEvent[] }>(p1, "combat:ended");
      dm.emit("combat:end", {});
      const closure = await ended;
      expect(closure.log.at(-1)?.type).toBe("combatEnd");
      expect(built.combat.getLiveCombat(scenario.campaignId)).toBeNull();
      expect(built.sessions.getById(scenario.sessionId)?.status).toBe("playing");
      expect(
        built.combat.getState(combat.id).phase,
      ).toBe("ended");
    } finally {
      dm.disconnect();
      p1.disconnect();
    }
  });

  it("al reconectar tras el fin envía recentCombat (TTL) y no el combate vivo", async () => {
    const scenario = await setupScenario();
    const dm = await connect(scenario.sessionCode, scenario.dmToken);
    const p1 = await connect(
      scenario.sessionCode,
      playerToken(scenario, scenario.playerOne.id),
    );
    let reconnected: Socket | null = null;

    try {
      const combat = await startCombat(dm, scenario, [p1]);
      const ended = once<{ log: CombatEvent[] }>(p1, "combat:ended");
      dm.emit("combat:end", {});
      await ended;
      p1.disconnect();

      reconnected = ioClient(baseUrl, {
        auth: {
          code: scenario.sessionCode,
          token: playerToken(scenario, scenario.playerOne.id),
        },
        transports: ["websocket"],
        forceNew: true,
        autoConnect: false,
      });
      const fullPromise = once<StateFullPayload>(reconnected, "state:full");
      reconnected.connect();
      await once(reconnected, "connect");
      const full = await fullPromise;

      expect(full.role).toBe("player");
      expect(full.combat).toBeNull();
      expect(full.recentCombat?.id).toBe(combat.id);
      expect(full.recentCombat?.phase).toBe("ended");
      expect(full.recentCombat?.log.at(-1)?.type).toBe("combatEnd");
      expect(full.recentCombat).not.toHaveProperty("seed");

      // Un jugador ajeno al snapshot no recibe el resultado.
      expect(
        built.combat.getRecentCombat(scenario.campaignId, {
          role: "player",
          characterId: "chr_ajeno",
        }),
      ).toBeNull();
    } finally {
      dm.disconnect();
      p1.disconnect();
      reconnected?.disconnect();
    }
  });

  it("al reconectar envía state:full con el combate actual, sin seed", async () => {
    const scenario = await setupScenario();
    const dm = await connect(scenario.sessionCode, scenario.dmToken);
    const p1 = await connect(
      scenario.sessionCode,
      playerToken(scenario, scenario.playerOne.id),
    );
    let reconnected: Socket | null = null;

    try {
      const combat = await startCombat(dm, scenario);
      const p1Unit = unitOf(combat, scenario.playerOne.id);
      const enemyUnit = unitOf(combat, scenario.enemy.id);

      const declared = waitForCombatState(
        dm,
        (state) => (state.actions[p1Unit.id]?.length ?? 0) === 2,
      );
      p1.emit("combat:declare", {
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
          { slot: 2, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      await declared;
      p1.disconnect();

      reconnected = ioClient(baseUrl, {
        auth: {
          code: scenario.sessionCode,
          token: playerToken(scenario, scenario.playerOne.id),
        },
        transports: ["websocket"],
        forceNew: true,
        autoConnect: false,
      });
      const fullPromise = once<StateFullPayload>(reconnected, "state:full");
      const sessionState = once<{ role: string }>(
        reconnected,
        "session:state",
      );
      reconnected.connect();
      await once(reconnected, "connect");
      await sessionState;

      const full = await fullPromise;
      expect(full.role).toBe("player");
      expect(full.combat?.id).toBe(combat.id);
      expect(full.combat?.phase).toBe("declaring");
      expect(full.combat?.actions[p1Unit.id]).toHaveLength(2);
      expect(full.combat).not.toHaveProperty("seed");
    } finally {
      dm.disconnect();
      p1.disconnect();
      reconnected?.disconnect();
    }
  });

  it("incluye skills de enemigos en la campaña saneada solo durante el combate", async () => {
    const scenario = await setupScenario();
    const token = playerToken(scenario, scenario.playerOne.id);
    const outside = built.sessions.getState(scenario.sessionCode, token);
    expect(outside.campaign.content.skills.map((skill) => skill.id)).not.toContain(
      scenario.enemySkillId,
    );

    const dm = await connect(scenario.sessionCode, scenario.dmToken);
    try {
      const combat = await startCombat(dm, scenario);
      const inside = built.sessions.getState(scenario.sessionCode, token);
      expect(inside.campaign.content.skills.map((skill) => skill.id)).toContain(
        scenario.enemySkillId,
      );
      built.combat.endEncounter(combat.id, "test");
    } finally {
      dm.disconnect();
    }
  });

  it("valida payloads con Zod y rechaza declarar fuera de fase o sin combate", async () => {
    const scenario = await setupScenario();
    const dm = await connect(scenario.sessionCode, scenario.dmToken);
    const p1 = await connect(
      scenario.sessionCode,
      playerToken(scenario, scenario.playerOne.id),
    );

    try {
      let error = once<{ code: string; message: string }>(dm, "error");
      dm.emit("combat:start", {});
      expectSocketError(await error, "invalid_payload");
      expect(built.combat.getLiveCombat(scenario.campaignId)).toBeNull();

      const combat = await startCombat(dm, scenario);
      const p1Unit = unitOf(combat, scenario.playerOne.id);
      const enemyUnit = unitOf(combat, scenario.enemy.id);

      error = once<{ code: string; message: string }>(p1, "error");
      p1.emit("combat:declare", {
        actions: [
          { slot: 0, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      expectSocketError(await error, "invalid_payload");

      error = once<{ code: string; message: string }>(dm, "error");
      dm.emit("combat:declare", {
        unitId: enemyUnit.id,
        actions: [{ slot: 1, targetId: p1Unit.id }],
      });
      expectSocketError(await error, "invalid_payload");

      // Fase no declarante: el servicio la rechaza aunque el payload sea válido.
      const state = built.combat.getState(combat.id);
      built.combatStore.save({ ...state, phase: "resolving" });
      error = once<{ code: string; message: string }>(p1, "error");
      p1.emit("combat:declare", {
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      expectSocketError(await error, "invalid_phase");

      const ended = once<{ log: CombatEvent[] }>(p1, "combat:ended");
      dm.emit("combat:end", {});
      await ended;

      error = once<{ code: string; message: string }>(p1, "error");
      p1.emit("combat:declare", {
        actions: [
          { slot: 1, skillId: scenario.skillId, targetId: enemyUnit.id },
        ],
      });
      expectSocketError(await error, "no_live_combat");
    } finally {
      dm.disconnect();
      p1.disconnect();
    }
  });
});
