/**
 * Skins del dado 3D y de la bandeja. La fuente de verdad es este módulo: el
 * atlas del canvas, los materiales de three y los colores de la UI salen de la
 * misma configuración para que el dado y la bandeja no se desincronicen.
 *
 * No importa three ni React: se puede testear en Node. El estado persistido
 * vive en `useDiceSkinStore` (localStorage).
 */

export type DiceSkinId =
  | "bone"
  | "obsidian"
  | "amber"
  | "jade"
  | "crimson"
  | "volcanic";

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
  /** Patrón procedural del atlas; `lava` pinta grietas incandescentes. */
  pattern?: "plain" | "lava";
  /** Contorno oscuro bajo el número para que se lea sobre texturas. */
  inkOutline?: string;
  /** Usa el propio atlas como mapa emisivo (grietas que brillan). */
  emissiveFromAtlas?: boolean;
}

export const DICE_SKIN_ORDER: readonly DiceSkinId[] = [
  "bone",
  "obsidian",
  "amber",
  "jade",
  "crimson",
  "volcanic",
];

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
    emissiveBoost: 0.08,
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
    emissiveBoost: 0.04,
    labelBackground: "#0d0c10",
    labelInk: "#f6e7ba",
  },
  amber: {
    id: "amber",
    label: "Ámbar",
    faceBackground: "#d9a03c",
    faceInk: "#241505",
    materialColor: 0xffffff,
    roughness: 0.42,
    metalness: 0.14,
    edgeColor: 0xf5d27a,
    edgeOpacity: 0.66,
    emissiveColor: 0xff9d2e,
    emissiveBoost: 0.05,
    labelBackground: "#2a1a07",
    labelInk: "#ffe9b5",
  },
  jade: {
    id: "jade",
    label: "Jade",
    faceBackground: "#14453a",
    faceInk: "#dcf7ea",
    materialColor: 0xffffff,
    roughness: 0.34,
    metalness: 0.18,
    edgeColor: 0x7fe3b8,
    edgeOpacity: 0.7,
    emissiveColor: 0x4fd1a0,
    emissiveBoost: 0.04,
    labelBackground: "#07211a",
    labelInk: "#dcf7ea",
  },
  crimson: {
    id: "crimson",
    label: "Carmesí",
    faceBackground: "#4a1218",
    faceInk: "#ffe1c7",
    materialColor: 0xffffff,
    roughness: 0.4,
    metalness: 0.15,
    edgeColor: 0xe8a05a,
    edgeOpacity: 0.7,
    emissiveColor: 0xd84315,
    emissiveBoost: 0.05,
    labelBackground: "#24070a",
    labelInk: "#ffe2c4",
  },
  volcanic: {
    id: "volcanic",
    label: "Volcánica",
    faceBackground: "#171311",
    faceInk: "#ffe6c2",
    materialColor: 0xffffff,
    roughness: 0.78,
    metalness: 0.08,
    edgeColor: 0xff6a1f,
    edgeOpacity: 0.8,
    emissiveColor: 0xffffff,
    emissiveBoost: 0.45,
    labelBackground: "#120b08",
    labelInk: "#ffd9a0",
    pattern: "lava",
    inkOutline: "rgba(8, 4, 2, 0.85)",
    emissiveFromAtlas: true,
  },
};

export const DICE_SKIN_STORAGE_KEY = "protocol-life-dice-skin";

export interface DiceSkinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DICE_SKIN_IDS = new Set<string>(DICE_SKIN_ORDER);

export function isDiceSkinId(value: unknown): value is DiceSkinId {
  return typeof value === "string" && DICE_SKIN_IDS.has(value);
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
