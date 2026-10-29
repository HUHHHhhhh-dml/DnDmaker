/**
 * Preferencia de sonido de los dados. Por defecto activo; el usuario puede
 * silenciarlo y la elección persiste en localStorage.
 */

export const DICE_SOUND_STORAGE_KEY = "protocol-life-dice-sound";
export const DEFAULT_DICE_SOUND_ENABLED = true;

export interface DiceSoundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseDiceSoundEnabled(
  value: string | null | undefined,
): boolean {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_DICE_SOUND_ENABLED;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "off" || normalized === "false" || normalized === "0") {
    return false;
  }
  if (normalized === "on" || normalized === "true" || normalized === "1") {
    return true;
  }
  return DEFAULT_DICE_SOUND_ENABLED;
}

function defaultStorage(): DiceSoundStorage | null {
  try {
    // En Node no hay `window`; así no se toca el localStorage experimental.
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readDiceSoundEnabled(
  storage: DiceSoundStorage | null = defaultStorage(),
): boolean {
  if (!storage) return DEFAULT_DICE_SOUND_ENABLED;
  try {
    return parseDiceSoundEnabled(storage.getItem(DICE_SOUND_STORAGE_KEY));
  } catch {
    return DEFAULT_DICE_SOUND_ENABLED;
  }
}

export function writeDiceSoundEnabled(
  enabled: boolean,
  storage: DiceSoundStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(DICE_SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Sin persistencia el sonido sigue funcionando en memoria.
  }
}
