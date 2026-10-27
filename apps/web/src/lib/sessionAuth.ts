/**
 * Token de la sesión viva de esta pestaña.
 *
 * Cada pestaña tiene su propio contexto (DM en una, jugador en otra), así que
 * el token se guarda en memoria y se rellena al hospedar/unirse/reconectar.
 * Los tokens persisten en localStorage bajo claves separadas por rol.
 */

let sessionToken: string | null = null;

export function getSessionToken(): string | null {
  return sessionToken;
}

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function clearSessionToken(): void {
  sessionToken = null;
}

const DM_KEY_PREFIX = "protocol-life:dm-session:";
const PLAYER_KEY_PREFIX = "protocol-life:player-session:";

export interface StoredDmSession {
  campaignId: string;
  code: string;
  token: string;
}

export interface StoredPlayerSession {
  code: string;
  token: string;
  playerId: string;
  name: string;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin localStorage seguimos funcionando en memoria.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nada
  }
}

export function readDmSession(campaignId: string): StoredDmSession | null {
  return readJson<StoredDmSession>(`${DM_KEY_PREFIX}${campaignId}`);
}

export function saveDmSession(value: StoredDmSession): void {
  writeJson(`${DM_KEY_PREFIX}${value.campaignId}`, value);
}

export function clearDmSession(campaignId: string): void {
  remove(`${DM_KEY_PREFIX}${campaignId}`);
}

export function readPlayerSession(code: string): StoredPlayerSession | null {
  return readJson<StoredPlayerSession>(
    `${PLAYER_KEY_PREFIX}${code.trim().toUpperCase()}`,
  );
}

export function savePlayerSession(value: StoredPlayerSession): void {
  writeJson(`${PLAYER_KEY_PREFIX}${value.code.toUpperCase()}`, value);
}

export function clearPlayerSession(code: string): void {
  remove(`${PLAYER_KEY_PREFIX}${code.trim().toUpperCase()}`);
}
