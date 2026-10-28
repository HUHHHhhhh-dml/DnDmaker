import type {
  Campaign,
  Character,
  DiceRoll,
  LootDraft,
  PublicCombatState,
  PublicDungeonRun,
  Session,
  SessionPlayer,
  ShopScene,
} from "./types";

/**
 * Contrato de la mesa en vivo (Fase 2).
 *
 * El modelo persistido de sesión está en `types.ts` (`Session`). Aquí viven
 * las vistas públicas: nunca incluyen `dmToken` ni los tokens de jugador.
 */

export type PublicSessionPlayer = Omit<SessionPlayer, "token">;

export interface PublicSession
  extends Omit<Session, "dmToken" | "players"> {
  players: PublicSessionPlayer[];
  /** Presencia del DM en la sala (solo runtime). */
  dmConnected?: boolean;
}

export interface SessionInfo {
  session: PublicSession;
  campaignName: string;
  campaignDescription?: string;
  requiresPin: boolean;
  maxPlayers: number;
  /** Personajes de tipo jugador sin dueño, para elegir al unirse. */
  availableCharacters: Array<Pick<Character, "id" | "name" | "portrait">>;
}

export interface HostSessionResponse {
  session: PublicSession;
  dmToken: string;
}

export interface JoinSessionResponse {
  session: PublicSession;
  playerToken: string;
  player: PublicSessionPlayer;
  character: Character;
  /** Campaña saneada para el jugador (sin enemigos, notas ni PIN). */
  campaign: Campaign;
}

export interface SessionStateResponse {
  role: "dm" | "player";
  session: PublicSession;
  /** Completa para el DM; saneada para el jugador. */
  campaign: Campaign;
  player?: PublicSessionPlayer;
  character?: Character;
  /** Fase 4A-2: reparto de botín activo de la sala, si lo hay. */
  lootDraft?: LootDraft | null;
  /** Fase 4A-3: escena de tienda abierta por el DM, si la hay. */
  activeShop?: ShopScene | null;
  /** Fase 4C: run de mazmorra activa de la sala, si la hay. */
  dungeonRun?: PublicDungeonRun | null;
}

/**
 * Snapshot completo al conectar/reconectar (Fase 3D). Incluye el combate vivo
 * ya público (sin seed) o `null` si la mesa no está combatiendo.
 *
 * `recentCombat` (Fase 3F, riesgo 2) es el último combate terminado dentro del
 * TTL; el servidor solo lo manda si el jugador participó en él. El cliente
 * puede descartarlo localmente y no volver a mostrarlo.
 */
export interface StateFullPayload extends SessionStateResponse {
  combat: PublicCombatState | null;
  recentCombat?: PublicCombatState | null;
}

export interface SessionPlayersEvent {
  players: PublicSessionPlayer[];
  status: Session["status"];
  dmConnected?: boolean;
}

/** Evento `loot:updated`: snapshot del reparto (null al cerrarse o limpiarse). */
export interface LootUpdatedEvent {
  draft: LootDraft | null;
}

/** Evento `shop:state`: escena de tienda activa (null al cerrarse). */
export interface ShopSceneEvent {
  shop: ShopScene | null;
}

/** Evento `dungeon:state`: run activa (null al terminar/cerrarse). */
export interface DungeonStateEvent {
  run: PublicDungeonRun | null;
}

/** Evento `dice:rolled`: tirada compartida de la mesa. */
export interface DiceRolledEvent {
  roll: DiceRoll;
}

/** Sin caracteres ambiguos (sin I, O, 0, 1). */
export const SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SESSION_CODE_LENGTH = 6;

export const SESSION_STATUS_LABELS = {
  lobby: "Lobby",
  playing: "En mesa",
  combat: "En combate",
} as const;
