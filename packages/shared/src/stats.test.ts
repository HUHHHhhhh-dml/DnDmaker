import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "./defaults";
import { sampleContent } from "./fixtures";
import { calculateStats, coinChance, mitigation } from "./stats";
import type { CampaignContent, Character, EffectDefinition, Item } from "./types";

function characterWith(overrides: Partial<Character> = {}): Character {
  return {
    id: "chr_test",
    name: "Test",
    kind: "player",
    baseStats: { hpMax: 50, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2 },
    equipment: { horns: null, hand: null, armor: null, leg: null, utility: null },
    skills: [null, null, null],
    inventory: [],
    ...overrides,
  };
}

describe("calculateStats", () => {
  it("devuelve los stats base sin equipo", () => {
    const content = sampleContent();
    const derived = calculateStats(characterWith(), content);
    expect(derived.stats).toEqual({
      hpMax: 50,
      def: 0,
      atk: 0,
      spd: 10,
      luck: 0,
      skillSlots: 2,
    });
    expect(derived.warnings).toEqual([]);
    expect(derived.contributions).toEqual([]);
  });

  it("suma stats del equipo y modificadores de efectos pasivos", () => {
    const content = sampleContent();
    const derived = calculateStats(content.characters[0]!, content);

    expect(derived.stats).toEqual({
      hpMax: 56,
      def: 12,
      atk: 3,
      spd: 10,
      luck: 0,
      skillSlots: 2,
    });
    expect(derived.activeEffects).toHaveLength(1);
    expect(derived.activeEffects[0]?.name).toBe("Protection");
    expect(derived.skills[0]?.name).toBe("ODACHI");
    expect(derived.contributions).toHaveLength(6);
  });

  it("aplica porcentajes después de los planos y redondea", () => {
    const item: Item = {
      id: "itm_boots",
      name: "Botas raras",
      slot: "leg",
      stats: { spd: 3 },
      effects: [{ effectId: "eff_haste", stacks: 2 }],
    };
    const haste: EffectDefinition = {
      id: "eff_haste",
      name: "Haste",
      maxStacks: 5,
      triggers: [
        {
          when: "roundStart",
          actions: [
            { type: "modifyStat", stat: "spd", mode: "percent", amount: 10, perStack: 5 },
          ],
        },
      ],
    };
    const content: CampaignContent = {
      ...sampleContent(),
      items: [item],
      effects: [haste],
      characters: [],
    };
    const character = characterWith({
      equipment: { horns: null, hand: null, armor: null, leg: item.id, utility: null },
    });

    const derived = calculateStats(character, content);
    // (10 + 3) × (1 + (10 + 5×2)/100) = 13 × 1.2 = 15.6 → 16
    expect(derived.stats.spd).toBe(16);
  });

  it("limita Skill Slots a 1..maxSkillSlots y avisa", () => {
    const item: Item = {
      id: "itm_slots",
      name: "Reliquia",
      slot: "hand",
      stats: { skillSlots: 10 },
    };
    const content = { ...sampleContent(), items: [item], effects: [] };
    const character = characterWith({
      equipment: { horns: null, hand: item.id, armor: null, leg: null, utility: null },
    });

    const high = calculateStats(character, content, { ...DEFAULT_RULES, maxSkillSlots: 6 });
    expect(high.stats.skillSlots).toBe(6);
    expect(high.warnings.join(" ")).toContain("límite de la campaña");

    const capped = calculateStats(character, content, { ...DEFAULT_RULES, maxSkillSlots: 3 });
    expect(capped.stats.skillSlots).toBe(3);
  });

  it("nunca deja el HP máximo por debajo de 1", () => {
    const item: Item = {
      id: "itm_curse",
      name: "Maldición",
      slot: "horns",
      stats: { hpMax: -999 },
    };
    const content = { ...sampleContent(), items: [item], effects: [] };
    const character = characterWith({
      equipment: { horns: item.id, hand: null, armor: null, leg: null, utility: null },
    });

    const derived = calculateStats(character, content);
    expect(derived.stats.hpMax).toBe(1);
    expect(derived.warnings.some((w) => w.includes("HP máximo"))).toBe(true);
  });

  it("avisa de referencias rotas sin romper el cálculo", () => {
    const character = characterWith({
      equipment: { horns: "itm_missing", hand: null, armor: null, leg: null, utility: null },
      skills: ["skl_missing", null, null],
    });
    const derived = calculateStats(character, sampleContent());
    expect(derived.stats.hpMax).toBe(50);
    expect(derived.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("acumula stacks del mismo efecto y respeta maxStacks", () => {
    const item: Item = {
      id: "itm_twin",
      name: "Doble protección",
      slot: "armor",
      effects: [
        { effectId: "eff_protection", stacks: 2 },
        { effectId: "eff_protection", stacks: 5 },
      ],
    };
    const content = { ...sampleContent(), items: [item] };
    const character = characterWith({
      equipment: { horns: null, hand: null, armor: item.id, leg: null, utility: null },
    });

    const derived = calculateStats(character, content);
    expect(derived.activeEffects[0]?.stacks).toBe(3);
    expect(derived.stats.def).toBe(15);
  });
});

describe("fórmulas auxiliares", () => {
  it("calcula la mitigación con DEF/(DEF+100)", () => {
    expect(mitigation(0)).toBe(0);
    expect(mitigation(-50)).toBe(0);
    expect(mitigation(100)).toBeCloseTo(0.5);
    expect(mitigation(200)).toBeCloseTo(2 / 3);
  });

  it("calcula la probabilidad de cara con cap y floor", () => {
    expect(coinChance(0)).toBeCloseTo(0.5);
    expect(coinChance(10)).toBeCloseTo(0.6);
    expect(coinChance(100)).toBe(0.9);
    expect(coinChance(-100)).toBe(0.1);
  });
});
