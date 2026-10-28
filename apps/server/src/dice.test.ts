import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DICE_SIDES,
  type Character,
  type DiceRoll,
  type HostSessionResponse,
  type JoinSessionResponse,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";
import { DiceService } from "./dice";
import { simulateD20Throw } from "./dicePhysics";

/**
 * Dados de mesa compartidos: ruta, permisos, cooldown, resultados en rango,
 * física del d20 y evento `dice:rolled` a la sala. SQLite temporal y sockets
 * reales.
 */

let dir: string;
let built: BuiltApp;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-dice-"));
  built = await buildApp({
    dbPath: join(dir, "dice.sqlite"),
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

interface Fixture {
  campaignId: string;
  sessionCode: string;
  dmToken: string;
  playerToken: string;
  playerName: string;
}

let counter = 0;

async function makeFixture(): Promise<Fixture> {
  counter += 1;
  const campaign = built.repository.createCampaign({
    name: `Dados ${counter}`,
    seed: false,
  });
  const character = built.repository.createContent(
    "characters",
    campaign.id,
    {
      name: "Tiradora",
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
    },
  ) as Character;

  const hostedResponse = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/session`,
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
  built.sessions.markPlayerConnected(
    hosted.session.code,
    joined.player.id,
    true,
  );

  return {
    campaignId: campaign.id,
    sessionCode: hosted.session.code,
    dmToken: hosted.dmToken,
    playerToken: joined.playerToken,
    playerName: joined.player.name,
  };
}

function withToken(token?: string): Record<string, string> {
  return token ? { "x-session-token": token } : {};
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

async function roll(
  fixture: Fixture,
  token: string | undefined,
  sides: number,
) {
  return app.inject({
    method: "POST",
    url: `/api/sessions/${fixture.sessionCode}/dice`,
    headers: withToken(token),
    payload: { sides },
  });
}

describe("Dados de mesa compartidos", () => {
  it("un d20 único simula la tirada y devuelve la trayectoria", async () => {
    const fixture = await makeFixture();
    const response = await roll(fixture, fixture.playerToken, 20);
    expect(response.statusCode, response.body).toBe(200);
    const dice = response.json() as DiceRoll;
    expect(dice.id).toMatch(/^dice/);
    expect(dice.sides).toBe(20);
    expect(dice.count).toBe(1);
    expect(dice.results).toHaveLength(1);
    expect(dice.result).toBeGreaterThanOrEqual(1);
    expect(dice.result).toBeLessThanOrEqual(20);
    expect(dice.result).toBe(dice.results[0]);
    expect(dice.roller).toEqual({ role: "player", name: fixture.playerName });
    expect(Number.isFinite(Date.parse(dice.at))).toBe(true);

    expect(dice.trajectory).toBeDefined();
    const trajectory = dice.trajectory!;
    expect(trajectory.face).toBe(dice.result);
    expect(trajectory.frames.length).toBeGreaterThan(10);
    expect(trajectory.durationMs).toBeGreaterThan(500);
    expect(trajectory.impacts.length).toBeGreaterThan(0);
    const final = trajectory.frames[trajectory.frames.length - 1]!;
    expect(final.p[1]).toBeGreaterThan(0.1);
  });

  it("el DM también puede tirar", async () => {
    const fixture = await makeFixture();
    const response = await roll(fixture, fixture.dmToken, 100);
    expect(response.statusCode, response.body).toBe(200);
    const dice = response.json() as DiceRoll;
    expect(dice.sides).toBe(100);
    expect(dice.result).toBeGreaterThanOrEqual(1);
    expect(dice.result).toBeLessThanOrEqual(100);
    expect(dice.roller).toEqual({ role: "dm", name: "DM" });
    // Solo el d20 único lleva simulación.
    expect(dice.trajectory).toBeUndefined();
  });

  it("tira varios dados del mismo tipo y suma sus resultados", async () => {
    const fixture = await makeFixture();
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dice`,
      headers: withToken(fixture.playerToken),
      payload: { sides: 6, count: 3 },
    });
    expect(response.statusCode, response.body).toBe(200);
    const dice = response.json() as DiceRoll;
    expect(dice.count).toBe(3);
    expect(dice.results).toHaveLength(3);
    for (const value of dice.results) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
    expect(dice.result).toBe(
      dice.results.reduce((sum, value) => sum + value, 0),
    );
    expect(dice.trajectory).toBeUndefined();
  });

  it("acepta un lanzamiento opcional y sigue devolviendo una tirada válida", async () => {
    const fixture = await makeFixture();
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dice`,
      headers: withToken(fixture.playerToken),
      payload: {
        sides: 20,
        throw: {
          velocity: [1.2, -2.4, -0.8],
          angular: [3, -2, 4],
          start: [0.4, -0.2],
        },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const dice = response.json() as DiceRoll;
    expect(dice.trajectory).toBeDefined();
    expect(dice.result).toBe(dice.trajectory!.face);
  });

  it("rechaza lados o cantidades que no son de la mesa y tokens ausentes", async () => {
    const fixture = await makeFixture();

    const invalid = await roll(fixture, fixture.playerToken, 7);
    expect(invalid.statusCode, invalid.body).toBe(400);
    expect((invalid.json() as { error?: { code?: string } }).error?.code).toBe(
      "invalid_payload",
    );

    for (const count of [0, 21]) {
      const invalidCount = await app.inject({
        method: "POST",
        url: `/api/sessions/${fixture.sessionCode}/dice`,
        headers: withToken(fixture.playerToken),
        payload: { sides: 20, count },
      });
      expect(invalidCount.statusCode, invalidCount.body).toBe(400);
      expect(
        (invalidCount.json() as { error?: { code?: string } }).error?.code,
      ).toBe("invalid_payload");
    }

    const invalidThrow = await app.inject({
      method: "POST",
      url: `/api/sessions/${fixture.sessionCode}/dice`,
      headers: withToken(fixture.playerToken),
      payload: { sides: 20, throw: { velocity: [999, 0, 0] } },
    });
    expect(invalidThrow.statusCode, invalidThrow.body).toBe(400);

    const noToken = await roll(fixture, undefined, 20);
    expect(noToken.statusCode, noToken.body).toBe(401);
    expect((noToken.json() as { error?: { code?: string } }).error?.code).toBe(
      "invalid_token",
    );
  });

  it("aplica un cooldown por jugador", async () => {
    const fixture = await makeFixture();
    const first = await roll(fixture, fixture.playerToken, 20);
    expect(first.statusCode).toBe(200);
    const second = await roll(fixture, fixture.playerToken, 6);
    expect(second.statusCode, second.body).toBe(429);
    expect((second.json() as { error?: { code?: string } }).error?.code).toBe(
      "dice_cooldown",
    );

    // El DM tiene su propio cooldown.
    const dm = await roll(fixture, fixture.dmToken, 20);
    expect(dm.statusCode, dm.body).toBe(200);
  });

  it("devuelve resultados en rango para todos los dados", async () => {
    const ready = await makeFixture();
    // Test puro del servicio, sin el cooldown de la ruta.
    const service = new DiceService(built.sessions, 0);
    for (const sides of DICE_SIDES) {
      for (let index = 0; index < 5; index += 1) {
        const dice = service.roll(
          ready.sessionCode,
          ready.playerToken,
          sides,
          index + 1,
        );
        expect(dice.count).toBe(index + 1);
        expect(dice.results).toHaveLength(index + 1);
        for (const value of dice.results) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(sides);
        }
        expect(dice.result).toBe(
          dice.results.reduce((sum, value) => sum + value, 0),
        );
        if (sides === 20 && index === 0) {
          expect(dice.trajectory).toBeDefined();
          expect(dice.result).toBe(dice.trajectory!.face);
        } else {
          expect(dice.trajectory).toBeUndefined();
        }
      }
    }
  });

  it("la simulación es determinista para la misma semilla", () => {
    const a = simulateD20Throw({ seed: 123456 });
    const b = simulateD20Throw({ seed: 123456 });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.face).toBe(b!.face);
    expect(a!.frames.length).toBe(b!.frames.length);
    expect(a!.frames[0]).toEqual(b!.frames[0]);
    expect(a!.frames[a!.frames.length - 1]).toEqual(
      b!.frames[b!.frames.length - 1],
    );
  });

  it("emite dice:rolled a toda la sala", async () => {
    const fixture = await makeFixture();
    const socket = ioClient(baseUrl, {
      auth: { code: fixture.sessionCode, token: fixture.dmToken },
      transports: ["websocket"],
      forceNew: true,
      autoConnect: false,
    });
    try {
      const full = once<{ role?: string }>(socket, "state:full");
      socket.connect();
      await once(socket, "connect");
      await full;

      const rolled = once<{ roll: DiceRoll }>(socket, "dice:rolled");
      const response = await roll(fixture, fixture.playerToken, 20);
      expect(response.statusCode, response.body).toBe(200);
      const event = await rolled;
      expect(event.roll.id).toBe((response.json() as DiceRoll).id);
      expect(event.roll.sides).toBe(20);
      expect(event.roll.count).toBe(1);
      expect(event.roll.results).toHaveLength(1);
      expect(event.roll.roller.role).toBe("player");
      expect(event.roll.trajectory?.face).toBe(event.roll.result);
    } finally {
      socket.disconnect();
    }
  });
});
