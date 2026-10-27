import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Campaign,
  Character,
  JoinSessionResponse,
  SessionInfo,
  SessionStateResponse,
} from "@protocol-life/shared";
import { buildApp, type BuiltApp } from "./app";

/**
 * Fase 2 — sesiones, tokens y permisos de la mesa.
 * No prueba el transporte Socket.IO (eso se valida con dos navegadores);
 * sí prueba el ciclo HTTP completo y las reglas de autorización.
 */

let dir: string;
let built: BuiltApp;
let app: FastifyInstance;
let campaign: Campaign;
let playerCharacterId: string;
let otherCharacterId: string;
let enemyCharacterId: string;
let unlockedItemId: string;
let lockedItemId: string;
let unlockedSkillId: string;
let lockedSkillId: string;
let sessionCode: string;
let dmToken: string;
let playerToken: string;
let playerId: string;

const dmHeaders = () => ({ "x-session-token": dmToken });
const playerHeaders = () => ({ "x-session-token": playerToken });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "protocol-life-sessions-"));
  built = await buildApp({
    dbPath: join(dir, "sessions.sqlite"),
    uploadsDir: join(dir, "uploads"),
    webDistDir: join(dir, "no-web-dist"),
    seed: false,
    logger: false,
  });
  app = built.app;

  const created = await app.inject({
    method: "POST",
    url: "/api/campaigns",
    payload: { name: "Mesa de prueba", seed: false },
  });
  campaign = created.json() as Campaign;

  // PIN y permisos antes de abrir la sala.
  const patched = await app.inject({
    method: "PATCH",
    url: `/api/campaigns/${campaign.id}`,
    payload: {
      settings: {
        maxPlayers: 2,
        allowPlayerEdit: true,
        allowPlayerEditDuringCombat: false,
        requirePin: true,
        pin: "4321",
      },
    },
  });
  campaign = patched.json() as Campaign;
  expect(patched.statusCode).toBe(200);

  const baseCharacter = {
    name: "Jugador Uno",
    kind: "player",
    description: "Ficha de prueba",
    baseStats: { hpMax: 50, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2 },
    equipment: { horns: null, hand: null, armor: null, leg: null, utility: null },
    skills: [null, null, null],
    inventory: [],
    notes: "nota privada del DM",
  };

  const playerChar = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/characters`,
    payload: baseCharacter,
  });
  playerCharacterId = (playerChar.json() as Character).id;

  const otherChar = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/characters`,
    payload: { ...baseCharacter, name: "Jugador Dos" },
  });
  otherCharacterId = (otherChar.json() as Character).id;

  const enemyChar = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/characters`,
    payload: {
      ...baseCharacter,
      name: "Enemigo secreto",
      kind: "enemy",
      notes: "no debe verlo el jugador",
    },
  });
  enemyCharacterId = (enemyChar.json() as Character).id;

  const unlockedItem = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/items`,
    payload: { name: "Filo visible", slot: "hand", unlocked: true, stats: { atk: 2 } },
  });
  unlockedItemId = (unlockedItem.json() as { id: string }).id;

  const lockedItem = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/items`,
    payload: { name: "Filo oculto", slot: "hand", unlocked: false, stats: { atk: 99 } },
  });
  lockedItemId = (lockedItem.json() as { id: string }).id;

  const unlockedSkill = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/skills`,
    payload: {
      name: "Skill visible",
      coins: 1,
      baseClash: 1,
      coinClash: 1,
      baseDamage: 1,
      coinDamage: 1,
      unlocked: true,
    },
  });
  unlockedSkillId = (unlockedSkill.json() as { id: string }).id;

  const lockedSkill = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaign.id}/skills`,
    payload: {
      name: "Skill oculta",
      coins: 1,
      baseClash: 1,
      coinClash: 1,
      baseDamage: 1,
      coinDamage: 1,
      unlocked: false,
    },
  });
  lockedSkillId = (lockedSkill.json() as { id: string }).id;
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Fase 2 — sala en vivo", () => {
  it("abre una sala con código y token de DM", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/session`,
    });
    expect(response.statusCode).toBe(201);
    const payload = response.json() as {
      dmToken: string;
      lanIps: string[];
      session: { code: string; players: unknown[]; status: string };
    };
    dmToken = payload.dmToken;
    sessionCode = payload.session.code;
    expect(dmToken).toHaveLength(64);
    expect(sessionCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(payload.session.status).toBe("lobby");
    expect(payload.session.players).toEqual([]);
    expect(Array.isArray(payload.lanIps)).toBe(true);
  });

  it("la info pública no filtra tokens y marca PIN requerido", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionCode}`,
    });
    expect(response.statusCode).toBe(200);
    const info = response.json() as SessionInfo;
    expect(info.campaignName).toBe("Mesa de prueba");
    expect(info.requiresPin).toBe(true);
    expect(info.availableCharacters.map((entry) => entry.name).sort()).toEqual([
      "Jugador Dos",
      "Jugador Uno",
    ]);
    expect(response.body).not.toContain("dmToken");
    expect(response.body).not.toContain("playerToken");
  });

  it("rechaza una sala sin PIN o con PIN incorrecto", async () => {
    const withoutPin = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/join`,
      payload: { name: "Intruso" },
    });
    expect(withoutPin.statusCode).toBe(403);
    expect(withoutPin.json().error.code).toBe("invalid_pin");

    const wrongPin = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/join`,
      payload: { name: "Intruso", pin: "0000" },
    });
    expect(wrongPin.statusCode).toBe(403);
  });

  it("un jugador se une eligiendo una ficha y recibe estado saneado", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/join`,
      payload: { name: "Ana", pin: "4321", characterId: playerCharacterId },
    });
    expect(response.statusCode).toBe(201);
    const joined = response.json() as JoinSessionResponse;
    playerToken = joined.playerToken;
    playerId = joined.player.id;
    expect(joined.player.name).toBe("Ana");
    expect(joined.player.characterId).toBe(playerCharacterId);
    expect(joined.session.players).toHaveLength(1);
    expect(joined.character.notes).toBeUndefined();
    expect(joined.character.ownerId).toBeUndefined();

    const stateResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionCode}/state`,
      headers: playerHeaders(),
    });
    expect(stateResponse.statusCode).toBe(200);
    const state = stateResponse.json() as SessionStateResponse;
    expect(state.role).toBe("player");
    expect(state.character?.id).toBe(playerCharacterId);
    expect(state.campaign.settings.pin).toBeUndefined();
    expect(state.campaign.settings.baseCharacterImage).toBe(
      "/assets/base-character.png",
    );
    expect(state.campaign.content.characters).toHaveLength(2);
    expect(
      state.campaign.content.characters.some((character) => character.kind === "enemy"),
    ).toBe(false);
    expect(
      state.campaign.content.characters.every(
        (character) => character.notes === undefined && character.ownerId === undefined,
      ),
    ).toBe(true);
    expect(state.campaign.content.encounters).toEqual([]);
    expect(state.campaign.content.items.map((item) => item.id)).toContain(unlockedItemId);
    expect(state.campaign.content.items.map((item) => item.id)).not.toContain(lockedItemId);
    expect(state.campaign.content.skills.map((skill) => skill.id)).toContain(
      unlockedSkillId,
    );
    expect(state.campaign.content.skills.map((skill) => skill.id)).not.toContain(
      lockedSkillId,
    );
    expect(stateResponse.body).not.toContain(enemyCharacterId);
  });

  it("el jugador edita su ficha y el DM también puede editarla", async () => {
    const own = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${playerCharacterId}`,
      headers: playerHeaders(),
      payload: { name: "Jugador Uno (Ana)", description: "Editado por su jugador" },
    });
    expect(own.statusCode).toBe(200);
    expect((own.json() as Character).name).toBe("Jugador Uno (Ana)");

    const dmEdit = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${playerCharacterId}`,
      headers: dmHeaders(),
      payload: { notes: "El DM también edita" },
    });
    expect(dmEdit.statusCode).toBe(200);
  });

  it("el jugador no puede equipar contenido bloqueado", async () => {
    const lockedItemEquip = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${playerCharacterId}`,
      headers: playerHeaders(),
      payload: {
        equipment: {
          horns: null,
          hand: lockedItemId,
          armor: null,
          leg: null,
          utility: null,
        },
      },
    });
    expect(lockedItemEquip.statusCode).toBe(403);
    expect(lockedItemEquip.json().error.code).toBe("content_locked");

    const lockedSkillEquip = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${playerCharacterId}`,
      headers: playerHeaders(),
      payload: { skills: [lockedSkillId, null, null] },
    });
    expect(lockedSkillEquip.statusCode).toBe(403);
    expect(lockedSkillEquip.json().error.code).toBe("content_locked");

    const unlockedEquip = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${playerCharacterId}`,
      headers: playerHeaders(),
      payload: {
        equipment: {
          horns: null,
          hand: unlockedItemId,
          armor: null,
          leg: null,
          utility: null,
        },
        skills: [unlockedSkillId, null, null],
      },
    });
    expect(unlockedEquip.statusCode).toBe(200);
  });

  it("el DM desbloquea un objeto y el jugador lo recibe en vivo", async () => {
    const unlock = await app.inject({
      method: "PATCH",
      url: `/api/content/items/${lockedItemId}`,
      headers: dmHeaders(),
      payload: { unlocked: true },
    });
    expect(unlock.statusCode).toBe(200);

    const state = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionCode}/state`,
      headers: playerHeaders(),
    });
    expect(state.statusCode).toBe(200);
    expect(
      (state.json() as SessionStateResponse).campaign.content.items.map(
        (item) => item.id,
      ),
    ).toContain(lockedItemId);
  });

  it("el jugador no puede editar otra ficha ni el contenido", async () => {
    const other = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${otherCharacterId}`,
      headers: playerHeaders(),
      payload: { name: "Hackeado" },
    });
    expect(other.statusCode).toBe(403);
    expect(other.json().error.code).toBe("not_your_character");

    const enemy = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${enemyCharacterId}`,
      headers: playerHeaders(),
      payload: { name: "Hackeado" },
    });
    expect(enemy.statusCode).toBe(403);

    const item = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/items`,
      headers: playerHeaders(),
      payload: { name: "Item pirata", slot: "horns" },
    });
    expect(item.statusCode).toBe(403);

    const campaignPatch = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${campaign.id}`,
      headers: playerHeaders(),
      payload: { name: "Campaña pirata" },
    });
    expect(campaignPatch.statusCode).toBe(403);

    const deleteCharacter = await app.inject({
      method: "DELETE",
      url: `/api/content/characters/${playerCharacterId}`,
      headers: playerHeaders(),
    });
    expect(deleteCharacter.statusCode).toBe(403);

    const exportCampaign = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}/export`,
      headers: playerHeaders(),
    });
    expect(exportCampaign.statusCode).toBe(403);

    const forbiddenFields = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${playerCharacterId}`,
      headers: playerHeaders(),
      payload: { kind: "enemy" },
    });
    expect(forbiddenFields.statusCode).toBe(403);
    expect(forbiddenFields.json().error.code).toBe("forbidden_fields");
  });

  it("sin token no se puede mutar una campaña en vivo", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${playerCharacterId}`,
      payload: { name: "Sin token" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("session_required");
  });

  it("el DM puede editar y el jugador no puede cerrar la sala", async () => {
    const dmEdit = await app.inject({
      method: "PATCH",
      url: `/api/content/characters/${otherCharacterId}`,
      headers: dmHeaders(),
      payload: { name: "Editado por el DM" },
    });
    expect(dmEdit.statusCode).toBe(200);

    const closeAttempt = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/close`,
      headers: playerHeaders(),
    });
    expect(closeAttempt.statusCode).toBe(403);
  });

  it("un jugador que sale libera su ficha y puede volver a reclamarla", async () => {
    const leave = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/leave`,
      headers: playerHeaders(),
    });
    expect(leave.statusCode).toBe(200);
    expect((leave.json() as { players: unknown[] }).players).toHaveLength(0);

    const stateAfter = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionCode}/state`,
      headers: playerHeaders(),
    });
    expect(stateAfter.statusCode).toBe(401);

    const rejoin = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/join`,
      payload: { name: "Ana", pin: "4321", characterId: playerCharacterId },
    });
    expect(rejoin.statusCode).toBe(201);
    const joined = rejoin.json() as JoinSessionResponse;
    expect(joined.player.id).not.toBe(playerId);
    playerId = joined.player.id;
    playerToken = joined.playerToken;

    const state = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionCode}/state`,
      headers: playerHeaders(),
    });
    expect(state.statusCode).toBe(200);
    expect((state.json() as SessionStateResponse).character?.id).toBe(playerCharacterId);
  });

  it("respeta el límite de jugadores", async () => {
    const joinSecond = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/join`,
      payload: { name: "Beto", pin: "4321", characterId: otherCharacterId },
    });
    expect(joinSecond.statusCode).toBe(201);

    const joinThird = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/join`,
      payload: { name: "Caro", pin: "4321" },
    });
    expect(joinThird.statusCode).toBe(409);
    expect(joinThird.json().error.code).toBe("session_full");
  });

  it("cierra la sala, invalida tokens y libera fichas", async () => {
    const close = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionCode}/close`,
      headers: dmHeaders(),
    });
    expect(close.statusCode).toBe(204);

    const info = await app.inject({ method: "GET", url: `/api/sessions/${sessionCode}` });
    expect(info.statusCode).toBe(404);

    const state = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionCode}/state`,
      headers: playerHeaders(),
    });
    expect(state.statusCode).toBe(401);

    const campaignAfter = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}`,
    });
    const parsed = campaignAfter.json() as Campaign;
    expect(
      parsed.content.characters.filter((character) => character.kind === "player").every(
        (character) => !character.ownerId,
      ),
    ).toBe(true);
  });

  it("se puede volver a abrir una sala con el contenido intacto", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/session`,
    });
    expect(response.statusCode).toBe(201);
    const payload = response.json() as { session: { code: string }; dmToken: string };
    expect(payload.session.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(payload.dmToken).toHaveLength(64);
  });
});
