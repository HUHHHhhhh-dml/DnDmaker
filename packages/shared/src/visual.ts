import { resolveVisualMode } from "./defaults";
import type {
  CampaignContent,
  CharacterKind,
  EquipmentSlot,
  Id,
  VisualMode,
} from "./types";

/**
 * Plan de render del side-view híbrido (Fase 3F).
 *
 * Esta función es la única fuente de verdad de la composición visual: la usan
 * el `CombatSprite` de la mesa, la vista previa del editor de ficha y los
 * tests. No toca React ni el DOM; solo decide qué imágenes se apilan y en qué
 * orden, respetando los fallbacks de DECISION-SIDE-VIEW.md.
 */

/** Orden cerrado de capas del cuerpo: leg → armor → horns → hand. */
export const COMBAT_LAYER_ORDER = [
  "leg",
  "armor",
  "horns",
  "hand",
] as const satisfies readonly EquipmentSlot[];

export interface CombatVisualSource {
  kind: CharacterKind;
  visualMode?: VisualMode;
  portrait?: string;
  battleSprite?: string;
  bodyImage?: string;
  equipment: Partial<Record<EquipmentSlot, Id | null>>;
}

export interface CombatVisualLayer {
  slot: EquipmentSlot;
  image: string;
}

export type CombatVisualPlan =
  | {
      kind: "layered";
      baseImage: string;
      layers: CombatVisualLayer[];
    }
  | { kind: "single"; image: string }
  | { kind: "placeholder" };

export interface CombatVisualOptions {
  /**
   * Imagen del arma de la skill que se está usando. Sustituye temporalmente
   * la capa del objeto de mano; no altera el equipo persistido.
   */
  weaponImage?: string;
}

export function planCombatVisual(
  source: CombatVisualSource,
  content: Pick<CampaignContent, "items">,
  options: CombatVisualOptions = {},
): CombatVisualPlan {
  const mode = resolveVisualMode(source);

  // Sin cuerpo base, el modo capas cae a sprite único sin romper la escena.
  if (mode === "layered" && source.bodyImage) {
    const items = new Map(content.items.map((item) => [item.id, item]));
    const layers: CombatVisualLayer[] = [];

    for (const slot of COMBAT_LAYER_ORDER) {
      const itemId = source.equipment[slot];
      const image =
        slot === "hand" && options.weaponImage
          ? options.weaponImage
          : itemId
            ? items.get(itemId)?.image
            : undefined;
      if (image) layers.push({ slot, image });
    }

    return { kind: "layered", baseImage: source.bodyImage, layers };
  }

  const single = source.battleSprite || source.portrait;
  return single ? { kind: "single", image: single } : { kind: "placeholder" };
}
