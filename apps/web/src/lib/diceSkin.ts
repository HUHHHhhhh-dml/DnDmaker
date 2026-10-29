/**
 * Skins del dado 3D y de la bandeja. La fuente de verdad es este módulo: el
 * atlas del canvas, los materiales de three y los colores de la UI salen de la
 * misma configuración para que el dado y la bandeja no se desincronicen.
 *
 * No importa three ni React: se puede testear en Node. El estado persistido
 * vive en `useDiceSkinStore` (localStorage).
 */

export type DiceSkinId = "bone" | "obsidian";

export interface DiceSkin {
  id: DiceSkinId;
  label: string;
  /** Fondo de cada cara en el atlas y tinta de los números. */
  faceBackground: string;
  faceInk: string;
  /** Material del cuerpo del dado. */
  materialColor: number;
  roughness: number;
  metalness: number;
  /** Aristas y emisivo del posado. */
  edgeColor: number;
  edgeOpacity: number;
  emissiveColor: number;
  emissiveBoost: number;
  /** Etiqueta flotante del resultado en tiradas múltiples. */
  labelBackground: string;
  labelInk: string;
}

export const DICE_SKIN_ORDER: readonly DiceSkinId[] = ["bone", "obsidian"];

export const DEFAULT_DICE_SKIN: DiceSkinId = "bone";

export const DICE_SKINS: Record<DiceSkinId, DiceSkin> = {
  bone: {
    id: "bone",
    label: "Hueso",
    faceBackground: "#d8cbb0",
    faceInk: "#1b160f",
    materialColor: 0xffffff,
    roughness: 0.52,
    metalness: 0.06,
    edgeColor: 0xd4a72c,
    edgeOpacity: 0.55,
    emissiveColor: 0xd4a72c,
    emissiveBoost: 0.22,
    labelBackground: "#201b12",
    labelInk: "#f4e7c5",
  },
  obsidian: {
    id: "obsidian",
    label: "Negra",
    faceBackground: "#17161b",
    faceInk: "#f2e2b3",
    materialColor: 0xffffff,
    roughness: 0.36,
    metalness: 0.2,
    edgeColor: 0xe8c56a,
    edgeOpacity: 0.72,
    emissiveColor: 0xd4a72c,
    emissiveBoost: 0.3,
    labelBackground: "#0d0c10",
    labelInk: "#f6e7ba",
  },
};

export const DICE_SKIN_STORAGE_KEY = "protocol-life-dice-skin";

export interface DiceSkinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isDiceSkinId(value: unknown): value is DiceSkinId {
  return value === "bone" || value === "obsidian";
}

/** Cualquier valor desconocido o corrupto cae a la skin por defecto. */
export function parseDiceSkin(value: string | null | undefined): DiceSkinId {
  return isDiceSkinId(value) ? value : DEFAULT_DICE_SKIN;
}

function defaultStorage(): DiceSkinStorage | null {
  try {
    // En Node no hay `window`; así no se toca el localStorage experimental.
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // Navegadores con almacenamiento bloqueado: se usa el valor por defecto.
    return null;
  }
}

export function readDiceSkin(
  storage: DiceSkinStorage | null = defaultStorage(),
): DiceSkinId {
  if (!storage) return DEFAULT_DICE_SKIN;
  try {
    return parseDiceSkin(storage.getItem(DICE_SKIN_STORAGE_KEY));
  } catch {
    return DEFAULT_DICE_SKIN;
  }
}

export function writeDiceSkin(
  skin: DiceSkinId,
  storage: DiceSkinStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(DICE_SKIN_STORAGE_KEY, skin);
  } catch {
    // Sin persistencia la skin sigue funcionando en memoria.
  }
}
