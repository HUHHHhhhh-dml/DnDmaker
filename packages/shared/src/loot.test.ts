import { describe, expect, it } from "vitest";
import {
  applyLootPick,
  closeLootDraft,
  lootBaseOrder,
  lootTotalItems,
  lootTurnCharacter,
  lootTurnNumber,
  skipLootTurn,
} from "./loot";
import type { LootDraft } from "./types";

/**
 * Fase 4A-2 — lógica pura del reparto por turnos.
 *
 * Orden por iniciativa (SPD) y serpiente: la primera ronda hacia delante, la
 * segunda hacia atrás. Sin estado global ni fechas reales: `at` se inyecta.
 */

const AT = "2026-10-28T00:00:00.000Z";

function draft(overrides: Partial<LootDraft> = {}): LootDraft {
  return {
    id: "loot_1",
    campaignId: "cmp_1",
    sessionId: "ses_1",
    encounterId: "enc_1",
    status: "active",
    pool: ["itm_a", "itm_b", "itm_c"],
    order: ["chr_ana", "chr_beto", "chr_caro"],
    round: 1,
    turnIndex: 0,
    picks: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

describe("orden base del reparto", () => {
  it("ordena por SPD descendente y desempata por id", () => {
    expect(
      lootBaseOrder([
        { characterId: "chr_beto", spd: 12 },
        { characterId: "chr_ana", spd: 18 },
        { characterId: "chr_caro", spd: 12 },
      ]),
    ).toEqual(["chr_ana", "chr_beto", "chr_caro"]);
  });

  it("deduplica fichas y se queda con su mejor SPD", () => {
    expect(
      lootBaseOrder([
        { characterId: "chr_ana", spd: 10 },
        { characterId: "chr_ana", spd: 15 },
        { characterId: "chr_beto", spd: 12 },
      ]),
    ).toEqual(["chr_ana", "chr_beto"]);
  });
});

describe("turnos en serpiente", () => {
  it("va hacia delante en la ronda 1 y hacia atrás en la 2", () => {
    expect(lootTurnCharacter(draft())).toBe("chr_ana");
    expect(lootTurnCharacter(draft({ turnIndex: 1 }))).toBe("chr_beto");
    expect(lootTurnCharacter(draft({ turnIndex: 2 }))).toBe("chr_caro");
    expect(
      lootTurnCharacter(draft({ round: 2, turnIndex: 0 })),
    ).toBe("chr_caro");
    expect(
      lootTurnCharacter(draft({ round: 2, turnIndex: 1 })),
    ).toBe("chr_beto");
    expect(
      lootTurnCharacter(draft({ round: 3, turnIndex: 0 })),
    ).toBe("chr_ana");
  });

  it("numera el turno dentro de la ronda", () => {
    expect(lootTurnNumber(draft())).toBe(1);
    expect(lootTurnNumber(draft({ turnIndex: 2 }))).toBe(3);
    expect(lootTurnNumber(draft({ order: [] }))).toBe(0);
    expect(lootTurnCharacter(draft({ order: [] }))).toBeNull();
  });
});

describe("elecciones", () => {
  it("entrega el objeto elegido y avanza el turno", () => {
    const result = applyLootPick(draft(), "chr_ana", 1, AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.itemId).toBe("itm_b");
    expect(result.draft.pool).toEqual(["itm_a", "itm_c"]);
    expect(result.draft.picks).toEqual([
      { characterId: "chr_ana", itemId: "itm_b", at: AT },
    ]);
    expect(result.draft.status).toBe("active");
    expect(lootTurnCharacter(result.draft)).toBe("chr_beto");
    expect(result.draft.updatedAt).toBe(AT);
  });

  it("rechaza a quien no tiene el turno, un índice inválido o un reparto cerrado", () => {
    expect(applyLootPick(draft(), "chr_beto", 0, AT)).toEqual({
      ok: false,
      error: "not_your_turn",
    });
    expect(applyLootPick(draft(), "chr_ana", 9, AT)).toEqual({
      ok: false,
      error: "invalid_item",
    });
    expect(applyLootPick(draft(), "chr_ana", -1, AT)).toEqual({
      ok: false,
      error: "invalid_item",
    });
    expect(
      applyLootPick(draft({ status: "done" }), "chr_ana", 0, AT),
    ).toEqual({ ok: false, error: "not_active" });
  });

  it("cierra el reparto al vaciar el pool y reinicia la ronda al completar el orden", () => {
    let current = draft({ pool: ["itm_a", "itm_b", "itm_c"] });
    for (const [characterId, expectedItem] of [
      ["chr_ana", "itm_a"],
      ["chr_beto", "itm_b"],
      ["chr_caro", "itm_c"],
    ] as const) {
      const result = applyLootPick(current, characterId, 0, AT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.itemId).toBe(expectedItem);
      current = result.draft;
    }
    expect(current.status).toBe("done");
    expect(current.pool).toEqual([]);
    expect(lootTotalItems(current)).toBe(3);
  });

  it("la serpiente alterna el orden entre rondas al elegir", () => {
    // 5 objetos y 2 jugadores: ana, beto, beto, ana, ana.
    let current = draft({ order: ["chr_ana", "chr_beto"], pool: ["1", "2", "3", "4", "5"] });
    const picks: Array<[string, string]> = [];
    for (let step = 0; step < 4; step += 1) {
      const characterId = lootTurnCharacter(current);
      if (!characterId) throw new Error("Sin turno");
      const result = applyLootPick(current, characterId, 0, AT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      picks.push([characterId, result.itemId ?? ""]);
      current = result.draft;
    }
    expect(picks.map(([characterId]) => characterId)).toEqual([
      "chr_ana",
      "chr_beto",
      "chr_beto",
      "chr_ana",
    ]);
    // Ronda 3 vuelve a empezar por ana.
    expect(lootTurnCharacter(current)).toBe("chr_ana");
    expect(current.round).toBe(3);
  });
});

describe("saltar y cerrar", () => {
  it("saltar avanza el turno sin gastar objeto", () => {
    const skipped = skipLootTurn(draft(), AT);
    expect(skipped?.pool).toEqual(["itm_a", "itm_b", "itm_c"]);
    expect(skipped?.picks).toEqual([]);
    expect(skipped && lootTurnCharacter(skipped)).toBe("chr_beto");
    expect(skipLootTurn(draft({ status: "done" }), AT)).toBeNull();
  });

  it("saltar en el último turno de la ronda pasa a la siguiente ronda en serpiente", () => {
    const skipped = skipLootTurn(draft({ turnIndex: 2 }), AT);
    expect(skipped?.round).toBe(2);
    expect(skipped?.turnIndex).toBe(0);
    expect(skipped && lootTurnCharacter(skipped)).toBe("chr_caro");
  });

  it("cerrar deja el reparto en done y conserva lo elegido", () => {
    const picked = applyLootPick(draft(), "chr_ana", 0, AT);
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;

    const closed = closeLootDraft(picked.draft, AT);
    expect(closed?.status).toBe("done");
    expect(closed?.pool).toEqual(["itm_b", "itm_c"]);
    expect(closed?.picks).toHaveLength(1);
    expect(closeLootDraft({ ...draft(), status: "done" }, AT)).toBeNull();
  });
});
