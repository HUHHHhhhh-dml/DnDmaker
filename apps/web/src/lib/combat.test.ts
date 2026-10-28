import { describe, expect, it } from "vitest";
import type {
  CampaignContent,
  CombatUnit,
  Skill,
} from "@protocol-life/shared";
import {
  draftToPayload,
  payloadToDraft,
  validateDraft,
  type CombatDraftAction,
} from "./combat";

/**
 * Fase 3F.5 — contrato cliente de `targetSlot`.
 *
 * `targetSlot` es solo presentación; estos tests comprueban que viaja en el
 * borrador y que la validación local respeta los slots reales del objetivo.
 */

const skill: Skill = {
  id: "skl_test",
  name: "Filo de prueba",
  coins: 2,
  baseClash: 4,
  coinClash: 3,
  baseDamage: 6,
  coinDamage: 2,
  target: "single",
};

const content: CampaignContent = {
  items: [],
  skills: [skill],
  effects: [],
  characters: [],
  encounters: [],
  specials: [],
  shops: [],
  dungeons: [],
};

function unit(partial: Partial<CombatUnit> & Pick<CombatUnit, "id" | "team">): CombatUnit {
  return {
    characterId: `chr_${partial.id}`,
    kind: partial.team === "enemies" ? "enemy" : "player",
    name: partial.id,
    stats: { hpMax: 40, def: 0, atk: 5, spd: 10, luck: 0, skillSlots: 2 },
    hpCurrent: 40,
    equipment: {
      horns: null,
      hand: null,
      armor: null,
      leg: null,
      utility: null,
    },
    skills: [skill.id, null, null],
    effects: [],
    utilityUses: 0,
    defeated: false,
    ...partial,
  };
}

const attacker = unit({ id: "p1", team: "players" });
const target = unit({ id: "e1", team: "enemies" });

const draft: CombatDraftAction = {
  id: "act_1",
  kind: "skill",
  skillId: skill.id,
  targetId: target.id,
  targetSlot: 2,
};

describe("targetSlot en el cliente (3F.5)", () => {
  it("viaja del borrador al payload y de vuelta", () => {
    const payload = draftToPayload([draft]);
    expect(payload[0]).toMatchObject({
      slot: 1,
      skillId: skill.id,
      targetId: target.id,
      targetSlot: 2,
    });
    expect(payloadToDraft(payload as never)[0]?.targetSlot).toBe(2);
  });

  it("acepta un slot válido del objetivo", () => {
    expect(
      validateDraft([draft], {
        combat: { units: [attacker, target], specialCooldowns: {} },
        unit: attacker,
        content,
      }),
    ).toBeNull();
  });

  it("rechaza un targetSlot fuera de los slots reales", () => {
    const error = validateDraft([{ ...draft, targetSlot: 3 }], {
      combat: { units: [attacker, target], specialCooldowns: {} },
      unit: attacker,
      content,
    });
    expect(error).toContain("no existe");
  });
});
