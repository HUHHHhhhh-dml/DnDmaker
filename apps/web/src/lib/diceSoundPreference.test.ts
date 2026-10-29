import { describe, expect, it } from "vitest";
import {
  DICE_SOUND_STORAGE_KEY,
  parseDiceSoundEnabled,
  readDiceSoundEnabled,
  writeDiceSoundEnabled,
  type DiceSoundStorage,
} from "./diceSoundPreference";

function memoryStorage(initial?: Record<string, string>): DiceSoundStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

describe("preferencia de sonido de dados", () => {
  it("está activa por defecto y entiende on/off", () => {
    expect(parseDiceSoundEnabled(null)).toBe(true);
    expect(parseDiceSoundEnabled(undefined)).toBe(true);
    expect(parseDiceSoundEnabled("")).toBe(true);
    expect(parseDiceSoundEnabled("on")).toBe(true);
    expect(parseDiceSoundEnabled("true")).toBe(true);
    expect(parseDiceSoundEnabled("1")).toBe(true);
    expect(parseDiceSoundEnabled("off")).toBe(false);
    expect(parseDiceSoundEnabled(" FALSE ")).toBe(false);
    expect(parseDiceSoundEnabled("0")).toBe(false);
    expect(parseDiceSoundEnabled("basura")).toBe(true);
  });

  it("persiste y recupera el valor", () => {
    const storage = memoryStorage();
    expect(readDiceSoundEnabled(storage)).toBe(true);
    writeDiceSoundEnabled(false, storage);
    expect(storage.data.get(DICE_SOUND_STORAGE_KEY)).toBe("off");
    expect(readDiceSoundEnabled(storage)).toBe(false);
    writeDiceSoundEnabled(true, storage);
    expect(storage.data.get(DICE_SOUND_STORAGE_KEY)).toBe("on");
    expect(readDiceSoundEnabled(storage)).toBe(true);
  });

  it("tolera almacenamiento ausente o que lanza", () => {
    expect(readDiceSoundEnabled(null)).toBe(true);
    expect(() => writeDiceSoundEnabled(false, null)).not.toThrow();
    const broken: DiceSoundStorage = {
      getItem() {
        throw new Error("bloqueado");
      },
      setItem() {
        throw new Error("bloqueado");
      },
    };
    expect(readDiceSoundEnabled(broken)).toBe(true);
    expect(() => writeDiceSoundEnabled(false, broken)).not.toThrow();
  });
});
