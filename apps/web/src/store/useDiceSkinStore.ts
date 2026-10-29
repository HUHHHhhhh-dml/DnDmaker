import { create } from "zustand";
import {
  readDiceSkin,
  writeDiceSkin,
  type DiceSkinId,
} from "../lib/diceSkin";

/**
 * Skin de los dados, persistida en localStorage. Vive fuera de `DiceTray`
 * porque la escena 3D se monta en un portal (`DiceCinematic`) y necesita el
 * mismo valor.
 */
interface DiceSkinState {
  skin: DiceSkinId;
  setSkin: (skin: DiceSkinId) => void;
}

export const useDiceSkinStore = create<DiceSkinState>((set) => ({
  skin: readDiceSkin(),
  setSkin(skin) {
    writeDiceSkin(skin);
    set({ skin });
  },
}));
