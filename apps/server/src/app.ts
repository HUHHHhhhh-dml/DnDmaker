import { existsSync } from "node:fs";
import { join } from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { toPublicCombatState } from "./combat/public";
import { CombatService } from "./combat/service";
import { registerCombatSocket } from "./combat/socket";
import { CombatStore } from "./combat/store";
import { dbPath as defaultDbPath, uploadsDir as defaultUploadsDir, webDistDir as defaultWebDistDir } from "./config";
import { openDatabase } from "./db";
import { DiceService } from "./dice";
import { DungeonRunService } from "./dungeon-run";
import { LootService } from "./loot";
import { ShopSceneService } from "./shop-scene";
import { createRealtime, type RealtimeService } from "./realtime";
import { HttpError, Repository } from "./repository";
import { errorPayload, registerRoutes, uploadLimits } from "./routes";
import { SessionService } from "./sessions";

export interface BuildAppOptions {
  /** Ruta del SQLite; `:memory:` para tests. */
  dbPath?: string;
  uploadsDir?: string;
  webDistDir?: string;
  /** Logger de Fastify (pino). */
  logger?: boolean;
  /** Crea la campaña semilla si la base está vacía (default: true). */
  seed?: boolean;
}

export interface BuiltApp {
  app: FastifyInstance;
  repository: Repository;
  sessions: SessionService;
  realtime: RealtimeService;
  combatStore: CombatStore;
  combat: CombatService;
  loot: LootService;
  shopScene: ShopSceneService;
  dungeonRuns: DungeonRunService;
  dice: DiceService;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<BuiltApp> {
  const file = options.dbPath ?? defaultDbPath();
  const uploads = options.uploadsDir ?? defaultUploadsDir();
  const webDist = options.webDistDir ?? defaultWebDistDir();

  const { sqlite, db } = openDatabase({ dbPath: file });
  const repository = new Repository(db, sqlite);
  const sessions = new SessionService(db, repository);
  sessions.resetPresence();
  const dice = new DiceService(sessions);
  const combatStore = new CombatStore(db, sqlite);
  const loot = new LootService(db, sqlite, repository, sessions);
  const shopScene = new ShopSceneService(db, repository, sessions);

  if (options.seed !== false) {
    const seeded = repository.ensureSeedCampaign();
    if (seeded) {
      // eslint-disable-next-line no-console
      console.log(`[seed] Campaña inicial creada: ${seeded.name}`);
    }
  }

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 10 * 1024 * 1024,
  });

  const realtime = createRealtime(app, sessions);
  let dungeonRuns: DungeonRunService | null = null;
  const combat = new CombatService(
    repository,
    sessions,
    combatStore,
    {
      onStarted: (state, session) => {
        realtime.emitCombatStarted(session.code, toPublicCombatState(state));
        realtime.emitPlayers(session.code);
        // En combate el jugador necesita las skills/objetos de los enemigos
        // para dibujar el side-view y leer el log; `getState` los incluye
        // mientras la sala está en `combat`.
        realtime.emitRefresh(session.campaignId);
        // Empezar combate cierra cualquier reparto pendiente de la sesión.
        realtime.emitLoot(session.code, loot.getBySession(session.id));
        // Y también la tienda que estuviera abierta.
        realtime.emitShop(session.code, shopScene.getBySession(session.id));
        // Fase 4C: un combate normal cierra la run; el que lanza una sala la
        // conserva y se marca con su `combatId` justo después.
        dungeonRuns?.handleCombatStarted(state, session);
        realtime.emitDungeon(
          session.code,
          dungeonRuns?.getBySession(session.id) ?? null,
        );
      },
      onCombatEvent: (_state, event, session) => {
        realtime.emitCombatEvent(session.code, event);
      },
      onCombatState: (state, session) => {
        realtime.emitCombatState(session.code, toPublicCombatState(state));
      },
      onCombatEnded: (state, session) => {
        realtime.emitCombatEnded(session.code, {
          winner: state.winner,
          log: state.log,
        });
        // La mesa vuelve a `playing`; refresca la presencia/estado de la sala.
        realtime.emitPlayers(session.code);
        // Fase 4: la victoria puede haber movido la bolsa y el inventario de la
        // party; el refresco hace que DM y jugadores lo vean sin recargar.
        realtime.emitRefresh(session.campaignId);
        // Fase 4A-2: si el botín quedó pendiente, la sala recibe el reparto.
        realtime.emitLoot(session.code, loot.getBySession(session.id));
        // Fase 4C: la victoria marca la sala actual como superada.
        dungeonRuns?.handleCombatEnded(state, session);
        realtime.emitDungeon(
          session.code,
          dungeonRuns?.getBySession(session.id) ?? null,
        );
      },
    },
    loot,
    shopScene,
  );
  dungeonRuns = new DungeonRunService(
    db,
    sqlite,
    repository,
    sessions,
    combat,
    loot,
  );
  registerCombatSocket({
    io: realtime.io,
    sessions,
    combat,
    loot,
    shopScene,
    dungeonRuns,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: uploadLimits });

  await registerRoutes(app, {
    repo: repository,
    uploadsDir: uploads,
    sessions,
    realtime,
    combat,
    loot,
    shopScene,
    dungeonRuns,
    dice,
  });

  const webIndex = join(webDist, "index.html");
  const hasWebBuild = existsSync(webIndex);
  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      index: ["index.html"],
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith("/api") || request.url.startsWith("/uploads");
    if (!isApi && hasWebBuild && request.method === "GET") {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply
      .code(404)
      .send(errorPayload("not_found", "Ruta no encontrada."));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const issues = error.issues.map((entry) => ({
        path: entry.path.join("."),
        message: entry.message,
        severity: "error" as const,
      }));
      return reply
        .code(400)
        .send(errorPayload("invalid_payload", "Datos inválidos.", issues));
    }

    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send(errorPayload(error.code, error.message, error.details));
    }

    const statusCode =
      typeof (error as { statusCode?: number }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;

    if (statusCode >= 500) {
      request.log.error(error);
      return reply
        .code(500)
        .send(errorPayload("internal_error", "Algo se rompió en el servidor."));
    }

    return reply
      .code(statusCode)
      .send(errorPayload("request_error", (error as Error).message));
  });

  app.addHook("onClose", async () => {
    try {
      realtime.close();
    } catch {
      // ya estaba cerrado
    }
    try {
      sqlite.close();
    } catch {
      // ya estaba cerrada
    }
  });

  return {
    app,
    repository,
    sessions,
    realtime,
    combatStore,
    combat,
    loot,
    shopScene,
    dungeonRuns,
    dice,
  };
}
