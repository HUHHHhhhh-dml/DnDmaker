import type {
  Campaign,
  Character,
  Session,
  SessionPlayer,
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
}

export interface SessionPlayersEvent {
  players: PublicSessionPlayer[];
  status: Session["status"];
  dmConnected?: boolean;
}

/** Sin caracteres ambiguos (sin I, O, 0, 1). */
export const SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SESSION_CODE_LENGTH = 6;

export const SESSION_STATUS_LABELS = {
  lobby: "Lobby",
  playing: "En mesa",
  combat: "En combate",
} as const;
