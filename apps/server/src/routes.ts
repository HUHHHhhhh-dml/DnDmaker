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
  hostSessionSchema,
  sessionJoinSchema,
  type ContentType,
} from "@protocol-life/shared";
import { getLanIps } from "./network";
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
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const { repo, uploadsDir, sessions, realtime } = options;

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
    const campaign = repo.getCampaign(campaignId);
    if (!campaign.settings.allowPlayerEdit) {
      throw new HttpError(
        403,
        "player_edit_disabled",
        "El DM no permite que los jugadores editen su ficha.",
      );
    }
    if (session.status === "combat") {
      throw new HttpError(
        403,
        "combat_lock",
        "No se pueden editar fichas durante el combate.",
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
    async (request) =>
      sessions.getState(request.params.code, getSessionToken(request)),
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
      const result = sessions.leave(code, getSessionToken(request));
      realtime.emitPlayers(code);
      realtime.emitRefresh(result.campaignId);
      return result;
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/close",
    async (request, reply) => {
      const { code } = request.params;
      const result = sessions.close(code, getSessionToken(request));
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
      const session = sessions.getByCampaignId(campaignId);
      if (session) realtime.emitClosed(session.code);
      repo.deleteCampaign(campaignId);
      return reply.code(204).send();
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
