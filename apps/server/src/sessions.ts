import { randomBytes, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  DEFAULT_STATS,
  SESSION_CODE_ALPHABET,
  SESSION_CODE_LENGTH,
  isEnemyKind,
  newId,
  type Character,
  type HostSessionResponse,
  type JoinSessionResponse,
  type PublicSession,
  type PublicSessionPlayer,
  type SessionInfo,
  type SessionJoinInput,
  type SessionPlayer,
  type SessionStateResponse,
} from "@protocol-life/shared";
import type { AppDatabase } from "./db";
import { HttpError, Repository } from "./repository";
import { sessions } from "./schema";

/**
 * Salas en vivo (Fase 2).
 *
 * - Una sesión activa por campaña.
 * - Tokens: DM y cada jugador tienen el suyo; nunca se exponen en vistas
 *   públicas.
 * - La presencia (`connected`) se persiste para reconexiones normales, pero se
 *   resetea al arrancar el servidor.
 */

export type SessionRow = typeof sessions.$inferSelect;

export type SessionIdentity =
  | { role: "dm"; session: SessionRow }
  | { role: "player"; session: SessionRow; player: SessionPlayer };

const PIN_ERROR = "El PIN no es correcto.";

export class SessionService {
  private readonly dmConnections = new Map<string, number>();

  constructor(
    private readonly db: AppDatabase,
    private readonly repo: Repository,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Consultas base                                                          */
  /* ---------------------------------------------------------------------- */

  getByCode(code: string): SessionRow | null {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return null;
    return (
      this.db.select().from(sessions).where(eq(sessions.code, normalized)).get() ??
      null
    );
  }

  getByCampaignId(campaignId: string): SessionRow | null {
    return (
      this.db
        .select()
        .from(sessions)
        .where(eq(sessions.campaignId, campaignId))
        .get() ?? null
    );
  }

  getById(id: string): SessionRow | null {
    return (
      this.db.select().from(sessions).where(eq(sessions.id, id)).get() ?? null
    );
  }

  /**
   * Cambia el estado de la mesa (`lobby` / `playing` / `combat`). Lo usa el
   * dominio de combate al iniciar/terminar y no expone tokens.
   */
  setStatus(
    id: string,
    status: SessionRow["status"],
  ): PublicSession | null {
    const row = this.getById(id);
    if (!row) return null;
    const now = new Date().toISOString();
    this.db
      .update(sessions)
      .set({ status, updatedAt: now })
      .where(eq(sessions.id, id))
      .run();
    return this.publicSession({ ...row, status, updatedAt: now });
  }

  authenticate(code: string, token: string | undefined | null): SessionIdentity | null {
    if (!token) return null;
    const row = this.getByCode(code);
    if (!row) return null;
    if (token === row.dmToken) return { role: "dm", session: row };
    const player = row.players.find((entry) => entry.token === token);
    if (player) return { role: "player", session: row, player };
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Vistas públicas                                                         */
  /* ---------------------------------------------------------------------- */

  publicSession(row: SessionRow): PublicSession {
    return {
      id: row.id,
      code: row.code,
      campaignId: row.campaignId,
      status: row.status,
      players: row.players.map(publicPlayer),
      dmConnected: (this.dmConnections.get(row.code) ?? 0) > 0,
    };
  }

  publicPlayers(code: string): PublicSessionPlayer[] {
    const row = this.getByCode(code);
    return row ? row.players.map(publicPlayer) : [];
  }

  getInfo(code: string): SessionInfo {
    const row = this.getByCode(code);
    if (!row) {
      throw new HttpError(404, "session_not_found", "Esa sala no existe o ya se cerró.");
    }
    const campaign = this.repo.getCampaign(row.campaignId);
    return {
      session: this.publicSession(row),
      campaignName: campaign.name,
      campaignDescription: campaign.description,
      requiresPin: Boolean(campaign.settings.requirePin && campaign.settings.pin),
      maxPlayers: campaign.settings.maxPlayers,
      availableCharacters: campaign.content.characters
        .filter((character) => character.kind === "player" && !character.ownerId)
        .map((character) => ({
          id: character.id,
          name: character.name,
          portrait: character.portrait,
        })),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Host / join / close                                                     */
  /* ---------------------------------------------------------------------- */

  host(campaignId: string): HostSessionResponse {
    const campaign = this.repo.getCampaign(campaignId);
    if (campaign.settings.requirePin && !campaign.settings.pin?.trim()) {
      throw new HttpError(
        422,
        "pin_not_configured",
        "La campaña exige PIN pero no tiene uno configurado. Configúralo en los ajustes de la campaña.",
      );
    }

    const previous = this.getByCampaignId(campaignId);
    if (previous) {
      // Una nueva sala reemplaza la anterior: liberamos las fichas reclamadas
      // para que los jugadores puedan volver a elegirlas.
      this.releaseCharacters(previous);
      this.dmConnections.delete(previous.code);
      this.db.delete(sessions).where(eq(sessions.id, previous.id)).run();
    }

    const now = new Date().toISOString();
    const row: SessionRow = {
      id: newId("ses"),
      campaignId,
      code: this.generateCode(),
      dmToken: randomBytes(32).toString("hex"),
      status: "lobby",
      players: [],
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(sessions).values(row).run();

    return {
      session: this.publicSession(row),
      dmToken: row.dmToken,
    };
  }

  join(code: string, input: SessionJoinInput): JoinSessionResponse {
    const row = this.getByCode(code);
    if (!row) {
      throw new HttpError(404, "session_not_found", "Esa sala no existe o ya se cerró.");
    }
    if (row.status === "combat") {
      throw new HttpError(409, "session_in_combat", "La mesa está en combate. Espera a que termine.");
    }

    const campaign = this.repo.getCampaign(row.campaignId);
    if (row.players.length >= campaign.settings.maxPlayers) {
      throw new HttpError(409, "session_full", "La sala está llena.");
    }

    if (campaign.settings.requirePin && campaign.settings.pin) {
      if ((input.pin ?? "").trim() !== campaign.settings.pin) {
        throw new HttpError(403, "invalid_pin", PIN_ERROR);
      }
    }

    let character: Character;

    if (input.characterId) {
      const found = campaign.content.characters.find(
        (entry) => entry.id === input.characterId,
      );
      if (!found) {
        throw new HttpError(404, "character_not_found", "Ese personaje no existe.");
      }
      if (found.kind !== "player") {
        throw new HttpError(
          422,
          "character_not_playable",
          "Solo puedes elegir un personaje de tipo jugador.",
        );
      }
      if (found.ownerId) {
        throw new HttpError(
          409,
          "character_claimed",
          "Ese personaje ya lo reclamó otro jugador.",
        );
      }
      character = found;
    } else {
      character = this.repo.createContent(
        "characters",
        row.campaignId,
        {
          name: input.name,
          kind: "player",
          level: 1,
          baseStats: { ...DEFAULT_STATS },
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
    }

    const player: SessionPlayer = {
      id: newId("plr"),
      name: input.name,
      token: randomBytes(32).toString("hex"),
      characterId: character.id,
      connected: false,
    };

    this.repo.setCharacterOwner(character.id, player.id);

    const now = new Date().toISOString();
    const nextPlayers = [...row.players, player];
    this.db
      .update(sessions)
      .set({ players: nextPlayers, updatedAt: now })
      .where(eq(sessions.id, row.id))
      .run();

    const updatedRow: SessionRow = { ...row, players: nextPlayers, updatedAt: now };
    const updatedCampaign = this.repo.getCampaign(row.campaignId);
    const ownCharacter =
      updatedCampaign.content.characters.find((entry) => entry.id === character.id) ??
      character;

    return {
      session: this.publicSession(updatedRow),
      playerToken: player.token,
      player: publicPlayer(player),
      character: this.sanitizeCharacter(ownCharacter),
      campaign: this.sanitizeCampaign(updatedCampaign),
    };
  }

  leave(code: string, token: string | null): PublicSession {
    const identity = this.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu sesión ya no es válida.");
    }
    if (identity.role !== "player") {
      throw new HttpError(403, "dm_cannot_leave", "El DM debe cerrar la sala.");
    }
    if (identity.player.characterId) {
      this.tryReleaseCharacter(identity.player.characterId);
    }
    const row = identity.session;
    const nextPlayers = row.players.filter((entry) => entry.id !== identity.player.id);
    const now = new Date().toISOString();
    this.db
      .update(sessions)
      .set({ players: nextPlayers, updatedAt: now })
      .where(eq(sessions.id, row.id))
      .run();
    return this.publicSession({ ...row, players: nextPlayers, updatedAt: now });
  }

  close(code: string, token: string | null): { campaignId: string } {
    const identity = this.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "No puedes cerrar esta sala.");
    }
    if (identity.role !== "dm") {
      throw new HttpError(403, "dm_only", "Solo el DM puede cerrar la sala.");
    }
    const row = identity.session;
    this.releaseCharacters(row);
    this.dmConnections.delete(row.code);
    this.db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return { campaignId: row.campaignId };
  }

  /* ---------------------------------------------------------------------- */
  /* Estado sanitizado                                                       */
  /* ---------------------------------------------------------------------- */

  getState(code: string, token: string | null): SessionStateResponse {
    const identity = this.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu sesión ya no es válida. Vuelve a entrar.");
    }
    const row = identity.session;
    const campaign = this.repo.getCampaign(row.campaignId);

    if (identity.role === "dm") {
      return {
        role: "dm",
        session: this.publicSession(row),
        campaign,
      };
    }

    const ownCharacter = identity.player.characterId
      ? campaign.content.characters.find(
          (entry) => entry.id === identity.player.characterId,
        )
      : undefined;

    return {
      role: "player",
      session: this.publicSession(row),
      // Durante el combate el jugador necesita ver las skills/objetos que
      // aparecen en el estado (incluidos los enemigos) para poder dibujar el
      // side-view y leer el log. Fuera de combate se mantiene el saneado.
      campaign: this.sanitizeCampaign(campaign, row.status === "combat"),
      player: publicPlayer(identity.player),
      character: ownCharacter ? this.sanitizeCharacter(ownCharacter) : undefined,
    };
  }

  /**
   * Campaña vista por un jugador: sin enemigos, notas, PIN ni contenido
   * bloqueado. Las tiendas tampoco viajan: la escena de tienda (Fase 4A-3)
   * manda su propio snapshot cuando el DM la abre. En combate
   * (`includeCombatReferences`) se añaden las skills/objetos referenciados por
   * los enemigos porque ya son visibles en el estado de combate y el
   * renderer/log los necesitan.
   */
  sanitizeCampaign(
    campaign: ReturnType<Repository["getCampaign"]>,
    includeCombatReferences = false,
  ) {
    const { pin: _pin, ...safeSettings } = campaign.settings;
    const party = campaign.content.characters.filter(
      (character) => !isEnemyKind(character.kind),
    );
    const referencedItems = new Set<string>();
    const referencedSkills = new Set<string>();
    const referencedCharacters = includeCombatReferences
      ? campaign.content.characters
      : party;
    for (const character of referencedCharacters) {
      for (const itemId of Object.values(character.equipment ?? {})) {
        if (itemId) referencedItems.add(itemId);
      }
      for (const entry of character.inventory) referencedItems.add(entry.itemId);
      for (const skillId of character.skills) {
        if (skillId) referencedSkills.add(skillId);
      }
      // En combate un jefe puede entrar en fase 2 y cambiar sus skills: sus
      // definiciones viajan al jugador para poder pintarlas en el log/estado.
      if (includeCombatReferences) {
        for (const skillId of character.bossPhase?.skills ?? []) {
          if (skillId) referencedSkills.add(skillId);
        }
      }
    }

    return {
      ...campaign,
      settings: { ...safeSettings, pin: undefined },
      content: {
        ...campaign.content,
        // Los objetos/skills desbloqueados son la biblioteca visible. Los
        // bloqueados que ya lleva un personaje de la party se mantienen para
        // que su ficha y sus stats sigan siendo válidos.
        items: campaign.content.items.filter(
          (item) => item.unlocked === true || referencedItems.has(item.id),
        ),
        skills: campaign.content.skills.filter(
          (skill) => skill.unlocked === true || referencedSkills.has(skill.id),
        ),
        characters: party.map((character) => this.sanitizeCharacter(character)),
        encounters: [],
        shops: [],
        dungeons: [],
      },
    };
  }

  private sanitizeCharacter(character: Character): Character {
    const { notes: _notes, ownerId: _ownerId, ...safe } = character;
    return safe;
  }

  /* ---------------------------------------------------------------------- */
  /* Presencia y helpers                                                     */
  /* ---------------------------------------------------------------------- */

  markPlayerConnected(
    code: string,
    playerId: string,
    connected: boolean,
  ): PublicSession | null {
    const row = this.getByCode(code);
    if (!row) return null;
    let changed = false;
    const players = row.players.map((player) => {
      if (player.id !== playerId || player.connected === connected) return player;
      changed = true;
      return { ...player, connected };
    });
    if (changed) {
      this.db
        .update(sessions)
        .set({ players })
        .where(eq(sessions.id, row.id))
        .run();
    }
    return this.publicSession({ ...row, players });
  }

  markDmConnected(code: string, connected: boolean): void {
    const current = this.dmConnections.get(code) ?? 0;
    const next = Math.max(0, current + (connected ? 1 : -1));
    if (next === 0) this.dmConnections.delete(code);
    else this.dmConnections.set(code, next);
  }

  getPublicSession(code: string): PublicSession | null {
    const row = this.getByCode(code);
    return row ? this.publicSession(row) : null;
  }

  resetPresence(): void {
    const rows = this.db.select().from(sessions).all();
    for (const row of rows) {
      if (!row.players.some((player) => player.connected)) continue;
      this.db
        .update(sessions)
        .set({ players: row.players.map((player) => ({ ...player, connected: false })) })
        .where(eq(sessions.id, row.id))
        .run();
    }
    this.dmConnections.clear();
  }

  isDmToken(code: string, token: string | null): boolean {
    const identity = this.authenticate(code, token);
    return identity?.role === "dm";
  }

  /* ---------------------------------------------------------------------- */
  /* Internos                                                                */
  /* ---------------------------------------------------------------------- */

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = "";
      for (let index = 0; index < SESSION_CODE_LENGTH; index += 1) {
        code += SESSION_CODE_ALPHABET[randomInt(0, SESSION_CODE_ALPHABET.length)];
      }
      if (!this.getByCode(code)) return code;
    }
    throw new HttpError(
      500,
      "session_code_failed",
      "No se pudo generar un código de sala. Inténtalo de nuevo.",
    );
  }

  private releaseCharacters(row: SessionRow): void {
    for (const player of row.players) {
      if (player.characterId) this.tryReleaseCharacter(player.characterId);
    }
  }

  private tryReleaseCharacter(characterId: string): void {
    try {
      this.repo.setCharacterOwner(characterId, null);
    } catch {
      // La ficha pudo borrarse mientras la sala estaba abierta.
    }
  }
}

function publicPlayer(player: SessionPlayer): PublicSessionPlayer {
  const { token: _token, ...rest } = player;
  return rest;
}
