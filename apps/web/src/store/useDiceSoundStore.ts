import { create } from "zustand";
import {
  readDiceSoundEnabled,
  writeDiceSoundEnabled,
} from "../lib/diceSoundPreference";
import { setDiceAudioEnabled } from "../lib/diceSound";

/**
 * Preferencia de sonido de los dados, persistida en localStorage. Vive fuera
 * de `DiceTray` porque la escena 3D y el toast también la consultan.
 */
interface DiceSoundState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (enabled: boolean) => void;
}

const initial = readDiceSoundEnabled();
setDiceAudioEnabled(initial);

export const useDiceSoundStore = create<DiceSoundState>((set, get) => ({
  enabled: initial,
  toggle() {
    const next = !get().enabled;
    writeDiceSoundEnabled(next);
    setDiceAudioEnabled(next);
    set({ enabled: next });
  },
  setEnabled(enabled) {
    writeDiceSoundEnabled(enabled);
    setDiceAudioEnabled(enabled);
    set({ enabled });
  },
}));
