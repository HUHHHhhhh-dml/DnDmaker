import { describe, expect, it } from "vitest";
import {
  DICE_SKINS,
  DICE_SKIN_ORDER,
  DICE_SKIN_STORAGE_KEY,
  DEFAULT_DICE_SKIN,
  isDiceSkinId,
  parseDiceSkin,
  readDiceSkin,
  writeDiceSkin,
  type DiceSkinStorage,
} from "./diceSkin";

function memoryStorage(initial?: Record<string, string>): DiceSkinStorage & {
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

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [light, dark] =
    luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (light + 0.05) / (dark + 0.05);
}

describe("skins de los dados", () => {
  it("hay hueso por defecto y una lista estable hueso/negra", () => {
    expect(DEFAULT_DICE_SKIN).toBe("bone");
    expect(DICE_SKIN_ORDER).toEqual(["bone", "obsidian"]);
    expect(Object.keys(DICE_SKINS).sort()).toEqual(["bone", "obsidian"]);
    expect(DICE_SKINS.bone.label).toBe("Hueso");
    expect(DICE_SKINS.obsidian.label).toBe("Negra");
    expect(DICE_SKINS.obsidian.faceBackground).not.toBe(
      DICE_SKINS.bone.faceBackground,
    );
  });

  it("los números se leen con contraste alto en ambas skins", () => {
    for (const skin of Object.values(DICE_SKINS)) {
      expect(contrast(skin.faceInk, skin.faceBackground)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(skin.labelInk, skin.labelBackground)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    // La negra es de cuerpo oscuro y números claros, no al revés.
    expect(luminance(DICE_SKINS.obsidian.faceBackground)).toBeLessThan(0.05);
    expect(luminance(DICE_SKINS.obsidian.faceInk)).toBeGreaterThan(0.5);
  });

  it("parsea ids válidos y cae al valor por defecto con basura", () => {
    expect(parseDiceSkin("bone")).toBe("bone");
    expect(parseDiceSkin("obsidian")).toBe("obsidian");
    expect(parseDiceSkin("negra")).toBe("bone");
    expect(parseDiceSkin("")).toBe("bone");
    expect(parseDiceSkin(null)).toBe("bone");
    expect(parseDiceSkin(undefined)).toBe("bone");
    expect(isDiceSkinId("obsidian")).toBe(true);
    expect(isDiceSkinId("bone")).toBe(true);
    expect(isDiceSkinId("gold")).toBe(false);
  });

  it("lee y escribe la skin persistida", () => {
    const storage = memoryStorage();
    expect(readDiceSkin(storage)).toBe("bone");
    writeDiceSkin("obsidian", storage);
    expect(storage.data.get(DICE_SKIN_STORAGE_KEY)).toBe("obsidian");
    expect(readDiceSkin(storage)).toBe("obsidian");
    storage.data.set(DICE_SKIN_STORAGE_KEY, "corrupta");
    expect(readDiceSkin(storage)).toBe("bone");
  });

  it("tolera almacenamiento ausente o que lanza", () => {
    expect(readDiceSkin(null)).toBe("bone");
    expect(() => writeDiceSkin("obsidian", null)).not.toThrow();
    const broken: DiceSkinStorage = {
      getItem() {
        throw new Error("bloqueado");
      },
      setItem() {
        throw new Error("bloqueado");
      },
    };
    expect(readDiceSkin(broken)).toBe("bone");
    expect(() => writeDiceSkin("obsidian", broken)).not.toThrow();
  });
});
