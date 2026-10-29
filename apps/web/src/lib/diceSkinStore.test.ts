import { afterEach, describe, expect, it } from "vitest";
import { useDiceSkinStore } from "../store/useDiceSkinStore";

/** Estado compartido de la skin: lo usan la bandeja y la escena 3D. */
describe("estado de la skin", () => {
  afterEach(() => {
    useDiceSkinStore.getState().setSkin("bone");
  });

  it("arranca en hueso y cambia con setSkin", () => {
    expect(useDiceSkinStore.getState().skin).toBe("bone");
    useDiceSkinStore.getState().setSkin("obsidian");
    expect(useDiceSkinStore.getState().skin).toBe("obsidian");
    useDiceSkinStore.getState().setSkin("bone");
    expect(useDiceSkinStore.getState().skin).toBe("bone");
  });
});
