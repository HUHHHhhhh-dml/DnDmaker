import { afterEach, describe, expect, it } from "vitest";
import { useDiceSoundStore } from "../store/useDiceSoundStore";

describe("estado del sonido de dados", () => {
  afterEach(() => {
    useDiceSoundStore.getState().setEnabled(true);
  });

  it("arranca activo y se puede silenciar o volver a activar", () => {
    expect(useDiceSoundStore.getState().enabled).toBe(true);
    useDiceSoundStore.getState().setEnabled(false);
    expect(useDiceSoundStore.getState().enabled).toBe(false);
    useDiceSoundStore.getState().toggle();
    expect(useDiceSoundStore.getState().enabled).toBe(true);
    useDiceSoundStore.getState().toggle();
    expect(useDiceSoundStore.getState().enabled).toBe(false);
  });
});
