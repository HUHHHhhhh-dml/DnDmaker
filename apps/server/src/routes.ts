import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CONTENT_SCHEMAS,
  CONTENT_TYPES,
  campaignCreateSchema,
  campaignPatchSchema,
  campaignSchema,
  diceRollInputSchema,
  dungeonStartInputSchema,
  hostSessionSchema,
  shopBuyInputSchema,
  shopOpenInputSchema,
  sessionJoinSchema,
  type ContentType,
} from "@protocol-life/shared";
import type { CombatService } from "./combat/service";
import type { DiceService } from "./dice";
import type { DungeonRunService } from "./dungeon-run";
import { getLanIps } from "./network";
import type { LootService } from "./loot";
import type { ShopSceneService } from "./shop-scene";
import type { RealtimeService } from "./realtime";
import type { Repository } from "./repository";
import { HttpError } from "./repository";
import type { SessionService } from "./sessions";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function parseContentType(value: string): ContentType {
  if ((CONTENT_TYPES as readonly string[]).includes(value)) {
    return value as ContentType;
  }
  throw new HttpError(
    400,
    "invalid_content_type",
    `Tipo de contenido inválido. Usa: ${CONTENT_TYPES.join(", ")}.`,
  );
}

function getSessionToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || null;
  }
  const header = request.headers["x-session-token"];
  if (typeof header === "string") return header.trim() || null;
  return null;
}

export interface RouteOptions {
  repo: Repository;
  uploadsDir: string;
  sessions: SessionService;
  realtime: RealtimeService;
  combat: CombatService;
  loot: LootService;
  shopScene: ShopSceneService;
  dungeonRuns: DungeonRunService;
  dice: DiceService;
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const { repo, uploadsDir, sessions, realtime, combat, loot, shopScene, dungeonRuns, dice } =
    options;

  /* ---------------------------------------------------------------------- */
  /* Autorización de la mesa                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Si la campaña tiene una sala abierta, exige DM para mutar contenido.
   * Si no hay sala, se mantiene el modo local de Fase 1.
   */
  function requireDmIfLive(campaignId: string, request: FastifyRequest): boolean {
    const session = sessions.getByCampaignId(campaignId);
    if (!session) return true;
    const token = getSessionToken(request);
    if (!token) {
      throw new HttpError(
        401,
        "session_required",
        "La campaña está en vivo. Necesitas el token de DM para editar.",
      );
    }
    const identity = sessions.authenticate(session.code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
    }
    if (identity.role !== "dm") {
      throw new HttpError(403, "dm_only", "Solo el DM puede hacer esta acción.");
    }
    return true;
  }

  /**
   * En combate nadie edita fichas ni contenido: el estado es un snapshot y
   * cambiar reglas/equipo a mitad de ronda rompería el log.
   */
  function assertNotInCombat(campaignId: string): void {
    if (combat.getLiveCombat(campaignId)) {
      throw new HttpError(
        423,
        "combat_lock",
        "No se puede editar contenido ni fichas durante el combate.",
      );
    }
  }

  /**
   * Valida una escritura de ficha cuando la campaña está en vivo:
   * el DM puede todo; el jugador solo su propia ficha y según permisos.
   */
  function authorizeCharacterWrite(
    campaignId: string,
    characterId: string,
    request: FastifyRequest,
    patch: Record<string, unknown>,
  ): void {
    const session = sessions.getByCampaignId(campaignId);
    if (!session) return;
    const token = getSessionToken(request);
    if (!token) {
      throw new HttpError(401, "session_required", "Necesitas el token de tu sesión.");
    }
    const identity = sessions.authenticate(session.code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
    }
    if (combat.getLiveCombat(campaignId)) {
      throw new HttpError(
        423,
        "combat_lock",
        "No se pueden editar fichas durante el combate.",
      );
    }
    if (identity.role === "dm") return;

    if (identity.player.characterId !== characterId) {
      throw new HttpError(
        403,
        "not_your_character",
        "Solo puedes editar tu propio personaje.",
      );
    }
    if ("kind" in patch || "ownerId" in patch) {
      throw new HttpError(
        403,
        "forbidden_fields",
        "No puedes cambiar el tipo ni el dueño de la ficha.",
      );
    }
    if ("hpCurrent" in patch) {
      throw new HttpError(
        403,
        "forbidden_fields",
        "Solo el DM puede ajustar el HP actual de una ficha.",
      );
    }
    const campaign = repo.getCampaign(campaignId);
    if (!campaign.settings.allowPlayerEdit) {
      throw new HttpError(
        403,
        "player_edit_disabled",
        "El DM no permite que los jugadores editen su ficha.",
      );
    }

    // Los jugadores solo pueden elegir objetos/skills desbloqueados. Se
    // permite conservar lo que ya lleva su ficha aunque el DM lo haya vuelto
    // a bloquear, para no romper stats existentes.
    const current = campaign.content.characters.find(
      (character) => character.id === characterId,
    );
    const allowedItems = new Set(
      campaign.content.items
        .filter((item) => item.unlocked === true)
        .map((item) => item.id),
    );
    const allowedSkills = new Set(
      campaign.content.skills
        .filter((skill) => skill.unlocked === true)
        .map((skill) => skill.id),
    );
    if (current) {
      for (const itemId of Object.values(current.equipment ?? {})) {
        if (itemId) allowedItems.add(itemId);
      }
      for (const entry of current.inventory) allowedItems.add(entry.itemId);
      for (const skillId of current.skills) {
        if (skillId) allowedSkills.add(skillId);
      }
    }

    const requestedItems: string[] = [];
    if (patch.equipment && typeof patch.equipment === "object") {
      for (const itemId of Object.values(
        patch.equipment as Record<string, unknown>,
      )) {
        if (typeof itemId === "string") requestedItems.push(itemId);
      }
    }
    if (Array.isArray(patch.inventory)) {
      for (const entry of patch.inventory as Array<{ itemId?: unknown }>) {
        if (typeof entry?.itemId === "string") requestedItems.push(entry.itemId);
      }
    }
    if (requestedItems.some((itemId) => !allowedItems.has(itemId))) {
      throw new HttpError(
        403,
        "content_locked",
        "Ese objeto todavía no está desbloqueado para los jugadores.",
      );
    }

    const requestedSkills: string[] = [];
    if (Array.isArray(patch.skills)) {
      for (const skillId of patch.skills as unknown[]) {
        if (typeof skillId === "string") requestedSkills.push(skillId);
      }
    }
    if (requestedSkills.some((skillId) => !allowedSkills.has(skillId))) {
      throw new HttpError(
        403,
        "content_locked",
        "Esa skill todavía no está desbloqueada para los jugadores.",
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Rate limit simple para join                                             */
  /* ---------------------------------------------------------------------- */

  const joinAttempts = new Map<string, { count: number; resetAt: number }>();

  function throttleJoin(request: FastifyRequest, code: string): void {
    const key = `${request.ip}:${code.toUpperCase()}`;
    const now = Date.now();
    const current = joinAttempts.get(key);
    if (!current || current.resetAt <= now) {
      joinAttempts.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    current.count += 1;
    if (current.count > 20) {
      throw new HttpError(
        429,
        "too_many_attempts",
        "Demasiados intentos. Espera un minuto antes de volver a intentarlo.",
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Salud                                                                   */
  /* ---------------------------------------------------------------------- */

  app.get("/api/health", async () => ({
    ok: true,
    app: "PROTOCOL LIFE",
    version: "0.2.0",
    time: new Date().toISOString(),
  }));

  app.get("/api/network", async () => ({
    lanIps: getLanIps(),
  }));

  /* ---------------------------------------------------------------------- */
  /* Sesiones (Fase 2)                                                       */
  /* ---------------------------------------------------------------------- */

  app.post<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/session",
    async (request, reply) => {
      const { campaignId } = request.params;
      if (combat.getLiveCombat(campaignId)) {
        throw new HttpError(
          409,
          "combat_in_progress",
          "Termina el combate antes de reabrir la sala.",
        );
      }
      const input = hostSessionSchema.parse(request.body ?? {});

      // El host puede fijar el PIN en el mismo gesto de abrir la sala. Es la
      // única escritura de campaña permitida sin token: reemplaza la sala
      // anterior (si existía), así el DM puede recuperarse desde otro navegador.
      if (input.requirePin !== undefined || input.pin !== undefined) {
        const campaign = repo.getCampaign(campaignId);
        const nextSettings = {
          ...campaign.settings,
          ...(input.requirePin !== undefined ? { requirePin: input.requirePin } : {}),
          ...(input.pin !== undefined ? { pin: input.pin } : {}),
        };
        if (nextSettings.requirePin && !nextSettings.pin?.trim()) {
          throw new HttpError(
            422,
            "pin_not_configured",
            "Activa el PIN y escribe uno antes de abrir la sala.",
          );
        }
        const previous = sessions.getByCampaignId(campaignId);
        if (previous) realtime.emitClosed(previous.code);
        repo.updateCampaign(campaignId, { settings: nextSettings });
      } else {
        const previous = sessions.getByCampaignId(campaignId);
        if (previous) realtime.emitClosed(previous.code);
      }

      const hosted = sessions.host(campaignId);
      return reply.code(201).send({
        ...hosted,
        lanIps: getLanIps(),
      });
    },
  );

  app.get<{ Params: { code: string } }>(
    "/api/sessions/:code",
    async (request) => sessions.getInfo(request.params.code),
  );

  app.get<{ Params: { code: string } }>(
    "/api/sessions/:code/state",
    async (request) => {
      const code = request.params.code;
      const state = sessions.getState(code, getSessionToken(request));
      // Fase 4A-2: el estado de la mesa incluye el reparto de botín activo.
      const session = sessions.getByCode(code);
      return {
        ...state,
        lootDraft: session ? loot.getBySession(session.id) : null,
        activeShop: session ? shopScene.getBySession(session.id) : null,
        dungeonRun: session ? dungeonRuns.getBySession(session.id) : null,
      };
    },
  );

  /**
   * Tirada compartida (Fase 4E+). El servidor decide el resultado y la emite a
   * toda la sala; no se persiste. El cooldown evita spam de pops.
   */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/dice",
    async (request) => {
      const { code } = request.params;
      const input = diceRollInputSchema.parse(request.body ?? {});
      const roll = dice.roll(
        code,
        getSessionToken(request),
        input.sides,
        input.count ?? 1,
        input.throw,
      );
      realtime.emitDice(code, roll);
      return roll;
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/join",
    async (request, reply) => {
      const { code } = request.params;
      throttleJoin(request, code);
      const input = sessionJoinSchema.parse(request.body ?? {});
      const joined = sessions.join(code, input);
      realtime.emitPlayers(code);
      realtime.emitRefresh(joined.session.campaignId);
      return reply.code(201).send(joined);
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/leave",
    async (request) => {
      const { code } = request.params;
      const token = getSessionToken(request);
      const session = sessions.getByCode(code);
      if (session && combat.getLiveCombat(session.campaignId)) {
        const identity = sessions.authenticate(code, token);
        if (identity?.role === "player") {
          throw new HttpError(
            409,
            "combat_in_progress",
            "No puedes salir de la mesa durante el combate.",
          );
        }
      }
      const result = sessions.leave(code, token);
      realtime.emitPlayers(code);
      realtime.emitRefresh(result.campaignId);
      return result;
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/close",
    async (request, reply) => {
      const { code } = request.params;
      const token = getSessionToken(request);
      const session = sessions.getByCode(code);
      if (
        session &&
        combat.getLiveCombat(session.campaignId) &&
        sessions.isDmToken(code, token)
      ) {
        throw new HttpError(
          409,
          "combat_in_progress",
          "Termina el combate antes de cerrar la sala.",
        );
      }
      const result = sessions.close(code, token);
      realtime.emitClosed(code);
      realtime.emitRefresh(result.campaignId);
      return reply.code(204).send();
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Campañas                                                               */
  /* ---------------------------------------------------------------------- */

  app.get("/api/campaigns", async () => repo.listCampaigns());

  app.post("/api/campaigns", async (request, reply) => {
    const input = campaignCreateSchema.parse(request.body ?? {});
    const campaign = repo.createCampaign(input);
    return reply.code(201).send(campaign);
  });

  app.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId",
    async (request) => repo.getCampaign(request.params.campaignId),
  );

  app.patch<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId",
    async (request) => {
      const { campaignId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const patch = campaignPatchSchema.parse(request.body ?? {});
      const campaign = repo.updateCampaign(campaignId, patch);
      realtime.emitRefresh(campaignId);
      return campaign;
    },
  );

  app.delete<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId",
    async (request, reply) => {
      const { campaignId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const session = sessions.getByCampaignId(campaignId);
      if (session) realtime.emitClosed(session.code);
      repo.deleteCampaign(campaignId);
      return reply.code(204).send();
    },
  );

  /**
   * Cura a la party fuera de combate (Fase 3F). En combate nadie escribe HP:
   * el cierre del combate persistente es la única otra escritura.
   */
  app.post<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/rest-party",
    async (request) => {
      const { campaignId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const campaign = repo.restParty(campaignId);
      realtime.emitRefresh(campaignId);
      return campaign;
    },
  );

  app.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/export",
    async (request, reply) => {
      const { campaignId } = request.params;
      requireDmIfLive(campaignId, request);
      const campaign = repo.exportCampaign(campaignId);
      const safeName = campaign.name
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      reply.header(
        "content-disposition",
        `attachment; filename="protocol-life-${safeName || "campana"}.json"`,
      );
      return campaign;
    },
  );

  app.post("/api/campaigns/import", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const candidate = (body.campaign ?? body) as unknown;
    const campaign = campaignSchema.parse(candidate);
    const imported = repo.importCampaign(campaign);
    return reply.code(201).send(imported);
  });

  /* ---------------------------------------------------------------------- */
  /* Tiendas y bolsa de party (Fase 4A)                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Fase 4A-3: si la campaña tiene una tienda abierta en la mesa, reemite su
   * escena tras editar la tienda (precio, stock, borrado...). El DM ve el
   * cambio en vivo sin recargar.
   */
  function emitShopIfActive(campaignId: string): void {
    const session = sessions.getByCampaignId(campaignId);
    if (!session) return;
    realtime.emitShop(session.code, shopScene.getBySession(session.id));
  }

  app.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/shops",
    async (request) => repo.listShops(request.params.campaignId),
  );

  app.post<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/shops",
    async (request, reply) => {
      const { campaignId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const shop = repo.createShop(campaignId, request.body ?? {});
      realtime.emitRefresh(campaignId);
      emitShopIfActive(campaignId);
      return reply.code(201).send(shop);
    },
  );

  app.patch<{ Params: { campaignId: string; shopId: string } }>(
    "/api/campaigns/:campaignId/shops/:shopId",
    async (request) => {
      const { campaignId, shopId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const shop = repo.updateShop(campaignId, shopId, request.body ?? {});
      realtime.emitRefresh(campaignId);
      emitShopIfActive(campaignId);
      return shop;
    },
  );

  app.delete<{ Params: { campaignId: string; shopId: string } }>(
    "/api/campaigns/:campaignId/shops/:shopId",
    async (request, reply) => {
      const { campaignId, shopId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      repo.deleteShop(campaignId, shopId);
      realtime.emitRefresh(campaignId);
      emitShopIfActive(campaignId);
      return reply.code(204).send();
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Mazmorras lineales+ (Fase 4B)                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Las mazmorras llevan notas privadas del DM: el listado es solo DM cuando
   * la campaña está en vivo. Sin sala abierta se mantiene el modo local.
   */
  app.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/dungeons",
    async (request) => {
      const { campaignId } = request.params;
      requireDmIfLive(campaignId, request);
      return repo.listDungeons(campaignId);
    },
  );

  app.post<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/dungeons",
    async (request, reply) => {
      const { campaignId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const dungeon = repo.createDungeon(campaignId, request.body ?? {});
      realtime.emitRefresh(campaignId);
      return reply.code(201).send(dungeon);
    },
  );

  app.patch<{ Params: { campaignId: string; dungeonId: string } }>(
    "/api/campaigns/:campaignId/dungeons/:dungeonId",
    async (request) => {
      const { campaignId, dungeonId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const dungeon = repo.updateDungeon(campaignId, dungeonId, request.body ?? {});
      realtime.emitRefresh(campaignId);
      // Si la run activa usaba esta mazmorra, reemite su estado (o la cierra
      // si la sala actual desapareció).
      const session = sessions.getByCampaignId(campaignId);
      if (session) {
        realtime.emitDungeon(
          session.code,
          dungeonRuns.getBySession(session.id),
        );
      }
      return dungeon;
    },
  );

  app.delete<{ Params: { campaignId: string; dungeonId: string } }>(
    "/api/campaigns/:campaignId/dungeons/:dungeonId",
    async (request, reply) => {
      const { campaignId, dungeonId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      repo.deleteDungeon(campaignId, dungeonId);
      dungeonRuns.closeForDungeon(campaignId, dungeonId);
      realtime.emitRefresh(campaignId);
      const session = sessions.getByCampaignId(campaignId);
      if (session) realtime.emitDungeon(session.code, null);
      return reply.code(204).send();
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Escena de tienda (Fase 4A-3)                                          */
  /* ---------------------------------------------------------------------- */

  app.get<{ Params: { code: string } }>(
    "/api/sessions/:code/shop",
    async (request) => {
      const identity = sessions.authenticate(
        request.params.code,
        getSessionToken(request),
      );
      if (!identity) {
        throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
      }
      return shopScene.getBySession(identity.session.id);
    },
  );

  /** Abrir una tienda en la mesa: el DM y solo fuera de combate. */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/shop/open",
    async (request) => {
      const { code } = request.params;
      const input = shopOpenInputSchema.parse(request.body ?? {});
      const identity = sessions.authenticate(code, getSessionToken(request));
      if (!identity) {
        throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
      }
      if (combat.getLiveCombat(identity.session.campaignId)) {
        throw new HttpError(
          423,
          "combat_lock",
          "Termina el combate antes de abrir una tienda.",
        );
      }
      const scene = shopScene.open(code, getSessionToken(request), input.shopId);
      // Fase 4C: tienda y mazmorra no conviven en la mesa.
      const shopSession = sessions.getByCode(code);
      if (shopSession) {
        dungeonRuns.closeForSession(shopSession.id);
        realtime.emitDungeon(code, null);
      }
      realtime.emitShop(code, scene);
      return scene;
    },
  );

  /** Cerrar la tienda: devuelve a los jugadores a su hoja. */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/shop/close",
    async (request, reply) => {
      const { code } = request.params;
      shopScene.close(code, getSessionToken(request));
      realtime.emitShop(code, null);
      return reply.code(204).send();
    },
  );

  /**
   * Comprar en la tienda abierta: paga el precio y desbloquea el objeto para
   * la campaña. No lo añade al inventario.
   */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/shop/buy",
    async (request) => {
      const { code } = request.params;
      const input = shopBuyInputSchema.parse(request.body ?? {});
      const identity = sessions.authenticate(code, getSessionToken(request));
      if (!identity) {
        throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
      }
      if (combat.getLiveCombat(identity.session.campaignId)) {
        throw new HttpError(
          423,
          "combat_lock",
          "No se puede comprar durante el combate.",
        );
      }

      const result = shopScene.buy(code, getSessionToken(request), input);
      realtime.emitShop(code, result.shop);
      realtime.emitRefresh(identity.session.campaignId);
      return result;
    },
  );

  /** Ajuste manual de la bolsa por el DM (sumar/restar, nunca por debajo de 0). */
  app.post<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/wallet",
    async (request) => {
      const { campaignId } = request.params;
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const campaign = repo.adjustWallet(campaignId, request.body ?? {});
      realtime.emitRefresh(campaignId);
      return campaign;
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Run de mazmorra (Fase 4C)                                             */
  /* ---------------------------------------------------------------------- */

  app.get<{ Params: { code: string } }>(
    "/api/sessions/:code/dungeon",
    async (request) =>
      dungeonRuns.getByCode(request.params.code, getSessionToken(request)),
  );

  /** El DM inicia la run; la tienda abierta se cierra. */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/dungeon/start",
    async (request, reply) => {
      const { code } = request.params;
      const input = dungeonStartInputSchema.parse(request.body ?? {});
      const run = dungeonRuns.start(code, getSessionToken(request), input);
      const session = sessions.getByCode(code);
      if (session) {
        shopScene.closeForSession(session.id);
        realtime.emitShop(code, null);
        realtime.emitRefresh(session.campaignId);
      }
      realtime.emitDungeon(code, run);
      return reply.code(201).send(run);
    },
  );

  /** Lanza el encuentro vinculado a la sala actual. */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/dungeon/encounter",
    async (request) => {
      const { code } = request.params;
      const run = dungeonRuns.startRoomEncounter(code, getSessionToken(request));
      realtime.emitDungeon(code, run);
      return run;
    },
  );

  /** Descansa una vez en la sala actual y cura a la party. */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/dungeon/rest",
    async (request) => {
      const { code } = request.params;
      const run = dungeonRuns.rest(code, getSessionToken(request));
      realtime.emitDungeon(code, run);
      const session = sessions.getByCode(code);
      if (session) realtime.emitRefresh(session.campaignId);
      return run;
    },
  );

  /** Abre el cofre de la sala actual una sola vez. */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/dungeon/chest",
    async (request) => {
      const { code } = request.params;
      const result = dungeonRuns.openChest(code, getSessionToken(request));
      realtime.emitDungeon(code, result.run);
      const session = sessions.getByCode(code);
      if (session) {
        realtime.emitRefresh(session.campaignId);
        realtime.emitLoot(code, loot.getBySession(session.id));
      }
      return result;
    },
  );

  /** Pasa a la siguiente sala; en la última termina la run. */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/dungeon/advance",
    async (request) => {
      const { code } = request.params;
      const run = dungeonRuns.advance(code, getSessionToken(request));
      realtime.emitDungeon(code, run);
      return run;
    },
  );

  /** Termina la run y devuelve a los jugadores a su hoja. */
  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/dungeon/end",
    async (request, reply) => {
      const { code } = request.params;
      dungeonRuns.end(code, getSessionToken(request));
      realtime.emitDungeon(code, null);
      return reply.code(204).send();
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Reparto de botín por turnos (Fase 4A-2)                                */
  /* ---------------------------------------------------------------------- */

  app.get<{ Params: { code: string } }>(
    "/api/sessions/:code/loot",
    async (request) => {
      const identity = sessions.authenticate(
        request.params.code,
        getSessionToken(request),
      );
      if (!identity) {
        throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
      }
      return loot.getBySession(identity.session.id);
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/loot/pick",
    async (request) => {
      const code = request.params.code;
      const body = (request.body ?? {}) as { itemIndex?: unknown };
      const itemIndex = Number(body.itemIndex);
      if (!Number.isInteger(itemIndex)) {
        throw new HttpError(
          400,
          "invalid_payload",
          "Indica el índice del objeto que quieres coger.",
        );
      }
      const result = loot.pick(code, getSessionToken(request), itemIndex);
      realtime.emitLoot(code, result.draft);
      realtime.emitRefresh(result.draft.campaignId);
      return result;
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/loot/skip",
    async (request) => {
      const code = request.params.code;
      const draft = loot.skip(code, getSessionToken(request));
      realtime.emitLoot(code, draft);
      return draft;
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/loot/close",
    async (request) => {
      const code = request.params.code;
      const draft = loot.close(code, getSessionToken(request));
      realtime.emitLoot(code, draft);
      return draft;
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Ficha de personaje                                                     */
  /* ---------------------------------------------------------------------- */

  app.get<{ Params: { campaignId: string; characterId: string } }>(
    "/api/campaigns/:campaignId/characters/:characterId/sheet",
    async (request) =>
      repo.getCharacterSheet(
        request.params.campaignId,
        request.params.characterId,
      ),
  );

  /* ---------------------------------------------------------------------- */
  /* Contenido (items, skills, effects, characters, encounters)             */
  /* ---------------------------------------------------------------------- */

  app.get<{ Params: { campaignId: string; type: string } }>(
    "/api/campaigns/:campaignId/:type",
    async (request) => {
      const type = parseContentType(request.params.type);
      return repo.listContent(type, request.params.campaignId);
    },
  );

  app.post<{ Params: { campaignId: string; type: string } }>(
    "/api/campaigns/:campaignId/:type",
    async (request, reply) => {
      const { campaignId } = request.params;
      const type = parseContentType(request.params.type);
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      const input = CONTENT_SCHEMAS[type].input.parse(request.body ?? {});
      const entity = repo.createContent(type, campaignId, input);
      realtime.emitRefresh(campaignId);
      return reply.code(201).send(entity);
    },
  );

  app.get<{ Params: { type: string; id: string } }>(
    "/api/content/:type/:id",
    async (request) => {
      const type = parseContentType(request.params.type);
      return repo.getContent(type, request.params.id);
    },
  );

  app.patch<{ Params: { type: string; id: string } }>(
    "/api/content/:type/:id",
    async (request) => {
      const type = parseContentType(request.params.type);
      const { id } = request.params;
      const campaignId = repo.getContentCampaignId(type, id);
      assertNotInCombat(campaignId);
      const patch = CONTENT_SCHEMAS[type].patch.parse(request.body ?? {}) as Record<
        string,
        unknown
      >;

      if (type === "characters") {
        authorizeCharacterWrite(campaignId, id, request, patch);
      } else {
        requireDmIfLive(campaignId, request);
      }

      const entity = repo.updateContent(type, id, patch);
      realtime.emitRefresh(campaignId);
      return entity;
    },
  );

  app.delete<{ Params: { type: string; id: string } }>(
    "/api/content/:type/:id",
    async (request, reply) => {
      const type = parseContentType(request.params.type);
      const { id } = request.params;
      const campaignId = repo.getContentCampaignId(type, id);
      requireDmIfLive(campaignId, request);
      assertNotInCombat(campaignId);
      repo.deleteContent(type, id);
      realtime.emitRefresh(campaignId);
      return reply.code(204).send();
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Subida de imágenes                                                     */
  /* ---------------------------------------------------------------------- */

  app.post("/api/uploads", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new HttpError(400, "missing_file", "Adjunta un archivo en el campo 'file'.");
    }

    const extension = IMAGE_TYPES[file.mimetype];
    if (!extension) {
      throw new HttpError(
        415,
        "invalid_mime",
        "Formato no permitido. Usa PNG, JPG, WEBP o GIF.",
      );
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, "file_too_large", "La imagen supera los 5 MB.");
    }
    if (file.file.truncated) {
      throw new HttpError(413, "file_too_large", "La imagen supera los 5 MB.");
    }

    const filename = `${randomUUID()}${extension}`;
    await writeFile(join(uploadsDir, filename), buffer);

    return reply.code(201).send({
      url: `/uploads/${filename}`,
      size: buffer.byteLength,
      mime: file.mimetype,
    });
  });

  app.get<{ Params: { file: string } }>("/uploads/:file", async (request, reply) => {
    const name = request.params.file;
    if (!/^[a-f0-9-]{20,64}\.(png|jpe?g|webp|gif)$/i.test(name)) {
      throw new HttpError(404, "not_found", "Archivo no encontrado.");
    }
    const fullPath = join(uploadsDir, name);
    if (!existsSync(fullPath)) {
      throw new HttpError(404, "not_found", "Archivo no encontrado.");
    }
    const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.type(MIME_BY_EXT[extension] ?? "application/octet-stream");
    return reply.send(createReadStream(fullPath));
  });
}

/** Esquema de error uniforme para clientes. */
export function errorPayload(
  code: string,
  message: string,
  issues?: unknown,
): { error: { code: string; message: string; issues?: unknown } } {
  return { error: issues === undefined ? { code, message } : { code, message, issues } };
}

export const uploadLimits = {
  fileSize: MAX_UPLOAD_BYTES,
  files: 1,
} as const;
