import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  Character,
  JoinSessionResponse,
  PublicSession,
} from "@protocol-life/shared";
import { buildApp } from "./app";

/**
 * Prueba de transporte en vivo: dos clientes (DM y jugador) en una sala real
 * con Socket.IO. Complementa los tests HTTP de sesiones.
 */

let dir: string;
let app: FastifyInstance;
let baseUrl: string;
let campaign: Campaign;
let characterId: string;
let code: string;
let dmToken: string;
let playerToken: string;
let dmSocket: Socket | null = null;
let playerSocket: Socket | null = null;

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

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-realtime-"));
  const built = await buildApp({
    dbPath: join(dir, "realtime.sqlite"),
    uploadsDir: join(dir, "uploads"),
    webDistDir: join(dir, "no-web-dist"),
    seed: false,
    logger: false,
  });
  app = built.app;
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });

  const created = await app.inject({
    method: "POST",
    url: "/api/campaigns",
    payload: { name: "Mesa en vivo", seed: false },
  });
  campaign = created.json() as Campaign;

  const character = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/characters`,
    payload: {
      name: "Ficha viva",
      kind: "player",
      baseStats: { hpMax: 50, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2 },
      equipment: { horns: null, hand: null, armor: null, leg: null, utility: null },
      skills: [null, null, null],
      inventory: [],
    },
  });
  characterId = (character.json() as Character).id;

  const hosted = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/session`,
  });
  const payload = hosted.json() as {
    dmToken: string;
    session: { code: string };
  };
  dmToken = payload.dmToken;
  code = payload.session.code;

  const joined = await app.inject({
    method: "POST",
    url: `/api/sessions/${code}/join`,
    payload: { name: "Jugador vivo", characterId },
  });
  playerToken = (joined.json() as JoinSessionResponse).playerToken;

  dmSocket = ioClient(baseUrl, {
    auth: { code, token: dmToken },
    transports: ["websocket"],
    forceNew: true,
  });
  const dmState = once<{ role: string; session: PublicSession }>(
    dmSocket,
    "session:state",
  );
  await once(dmSocket, "connect");
  expect((await dmState).role).toBe("dm");
});

afterAll(async () => {
  dmSocket?.disconnect();
  playerSocket?.disconnect();
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Fase 2 — Socket.IO", () => {
  it("el jugador conecta y el DM ve la presencia en vivo", async () => {
    const playersEvent = once<{
      players: Array<{ name: string; connected: boolean }>;
      dmConnected?: boolean;
    }>(dmSocket!, "session:players");

    playerSocket = ioClient(baseUrl, {
      auth: { code, token: playerToken },
      transports: ["websocket"],
      forceNew: true,
    });
    const playerState = once<{ role: string; session: PublicSession }>(
      playerSocket,
      "session:state",
    );
    await once(playerSocket, "connect");
    expect((await playerState).role).toBe("player");

    const presence = await playersEvent;
    const player = presence.players.find((entry) => entry.name === "Jugador vivo");
    expect(player?.connected).toBe(true);
    expect(presence.dmConnected).toBe(true);
  });

  it("un cambio de ficha del jugador refresca la mesa del DM", async () => {
    const refresh = once<Record<string, never>>(dmSocket!, "campaign:refresh");
    const update = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${characterId}`,
      headers: { "x-session-token": playerToken },
      payload: { name: "Ficha editada en vivo" },
    });
    expect(update.statusCode).toBe(200);
    await refresh;

    const playerRefresh = once<Record<string, never>>(
      playerSocket!,
      "campaign:refresh",
    );
    const dmUpdate = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${characterId}`,
      headers: { "x-session-token": dmToken },
      payload: { description: "Cambio del DM" },
    });
    expect(dmUpdate.statusCode).toBe(200);
    await playerRefresh;
  });

  it("cerrar la sala avisa y desconecta a los clientes", async () => {
    const dmClosed = once(dmSocket!, "session:closed");
    const playerClosed = once(playerSocket!, "session:closed");
    const close = await app.inject({
      method: "POST",
      url: `/api/sessions/${code}/close`,
      headers: { "x-session-token": dmToken },
    });
    expect(close.statusCode).toBe(204);
    await Promise.all([dmClosed, playerClosed]);
    expect(dmSocket?.connected).toBe(false);
    expect(playerSocket?.connected).toBe(false);
  });
});
