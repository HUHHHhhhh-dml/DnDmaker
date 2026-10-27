import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  CONTENT_SCHEMAS,
  CONTENT_TYPES,
  campaignCreateSchema,
  campaignPatchSchema,
  campaignSchema,
  type ContentType,
} from "@protocol-life/shared";
import type { Repository } from "./repository";
import { HttpError } from "./repository";

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

function parsePatchBody(type: ContentType, body: unknown): unknown {
  return CONTENT_SCHEMAS[type].patch.parse(body);
}

export interface RouteOptions {
  repo: Repository;
  uploadsDir: string;
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const { repo, uploadsDir } = options;

  app.get("/api/health", async () => ({
    ok: true,
    app: "PROTOCOL LIFE",
    version: "0.1.0",
    time: new Date().toISOString(),
  }));

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
      const patch = campaignPatchSchema.parse(request.body ?? {});
      return repo.updateCampaign(request.params.campaignId, patch);
    },
  );

  app.delete<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId",
    async (request, reply) => {
      repo.deleteCampaign(request.params.campaignId);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/export",
    async (request, reply) => {
      const campaign = repo.exportCampaign(request.params.campaignId);
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
      const type = parseContentType(request.params.type);
      const input = CONTENT_SCHEMAS[type].input.parse(request.body ?? {});
      const entity = repo.createContent(type, request.params.campaignId, input);
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
      return repo.updateContent(type, request.params.id, parsePatchBody(type, request.body ?? {}));
    },
  );

  app.delete<{ Params: { type: string; id: string } }>(
    "/api/content/:type/:id",
    async (request, reply) => {
      const type = parseContentType(request.params.type);
      repo.deleteContent(type, request.params.id);
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
