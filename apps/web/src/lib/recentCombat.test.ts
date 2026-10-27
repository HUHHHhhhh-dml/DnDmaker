import { beforeEach, describe, expect, it } from "vitest";
import {
  isRecentCombatDismissed,
  rememberRecentCombatDismissed,
} from "./recentCombat";

/**
 * Fase 3F — descarte local del último combate (riesgo 2).
 *
 * Entorno Node sin jsdom: se inyecta un `localStorage` en memoria. El helper
 * solo debe recordar el par sala+combate y sobrevivir a recargas.
 */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
});

describe("descarte local del último combate (3F)", () => {
  it("recuerda el combate descartado y normaliza el código de sala", () => {
    const storage = globalThis.localStorage as MemoryStorage;
    expect(isRecentCombatDismissed("nuu umc", "cmb_1")).toBe(false);

    rememberRecentCombatDismissed("nuu umc", "cmb_1");
    expect(isRecentCombatDismissed("NUU UMC", "cmb_1")).toBe(true);
    expect(storage.getItem("protocol-life:dismissed-recent-combats")).toContain(
      "NUU UMC:cmb_1",
    );
  });

  it("no descarta otros combates ni duplica entradas", () => {
    rememberRecentCombatDismissed("ABC123", "cmb_1");
    rememberRecentCombatDismissed("ABC123", "cmb_1");
    rememberRecentCombatDismissed("ABC123", "cmb_2");

    expect(isRecentCombatDismissed("ABC123", "cmb_1")).toBe(true);
    expect(isRecentCombatDismissed("ABC123", "cmb_2")).toBe(true);
    expect(isRecentCombatDismissed("ABC123", "cmb_3")).toBe(false);

    const raw = globalThis.localStorage.getItem(
      "protocol-life:dismissed-recent-combats",
    );
    expect(JSON.parse(raw ?? "[]")).toEqual(["ABC123:cmb_1", "ABC123:cmb_2"]);
  });

  it("tolera localStorage corrupto o ausente sin romper la UI", () => {
    globalThis.localStorage.setItem(
      "protocol-life:dismissed-recent-combats",
      "{no es json",
    );
    expect(isRecentCombatDismissed("ABC123", "cmb_1")).toBe(false);
    rememberRecentCombatDismissed("ABC123", "cmb_1");
    expect(isRecentCombatDismissed("ABC123", "cmb_1")).toBe(true);
  });
});
