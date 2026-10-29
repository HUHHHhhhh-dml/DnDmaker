import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  calculateStats,
  emptyContent,
  type Campaign,
  type Character,
  type EffectDefinition,
  type Item,
} from "@protocol-life/shared";
import { snapshotUnit } from "./snapshot";

/**
 * El snapshot de combate debe llevar las ganancias de nivel en `baseStats`
 * (para que el motor no las pierda al refrescar stats) y el estado OVERCHARGED.
 */
describe("snapshot de combate con nivel y Soul Points", () => {
  it("copia stats derivados, base con nivel y overcharged", () => {
    const item: Item = {
      id: "itm_heavy",
      name: "Armadura pesada",
      slot: "armor",
      soulCost: 13,
    };
    const character: Character = {
      id: "chr_level",
      name: "Nivelada",
      kind: "player",
      level: 3,
      baseStats: { ...DEFAULT_STATS, hpMax: 50 },
      equipment: {
        horns: null,
        hand: null,
        armor: item.id,
        leg: null,
        utility: null,
      },
      skills: [null, null, null],
      inventory: [],
    };
    const content = emptyContent();
    content.items.push(item);
    const campaign: Campaign = {
      id: "cmp_level",
      name: "Niveles",
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      rules: { ...DEFAULT_RULES },
      settings: {
        ...DEFAULT_SETTINGS,
        leveling: {
          hp: true,
          def: true,
          soulPoints: true,
          hpPerLevel: 5,
          defPerLevel: 2,
          soulPointsPerLevel: 1,
        },
      },
      wallet: { cleanShards: 0 },
      content,
    };

    const derived = calculateStats(
      character,
      content,
      campaign.rules,
      campaign.settings,
    );
    const unit = snapshotUnit(character, { campaign, team: "players" });

    expect(unit.stats).toEqual(derived.stats);
    expect(unit.baseStats).toEqual(derived.base);
    // 50 base + 2 niveles × 5: el motor conserva el nivel en su base.
    expect(unit.baseStats?.hpMax).toBe(60);
    expect(unit.soulPoints).toEqual({
      used: 13,
      max: 12,
      overcharged: true,
    });
    expect(unit.overcharged).toBe(true);
  });

  it("aplica los efectos de inicio como activos, separados de los pasivos", () => {
    const bleed: EffectDefinition = {
      id: "eff_bleed_start",
      name: "Bleed",
      maxStacks: 5,
      stackMode: "add",
      duration: { type: "turns", default: 3 },
      triggers: [],
    };
    const item: Item = {
      id: "itm_red_crown",
      name: "Red Crown",
      slot: "horns",
      effects: [{ effectId: bleed.id, stacks: 1 }],
      startCombatEffects: [{ effectId: bleed.id, stacks: 3 }],
    };
    const character: Character = {
      id: "chr_crown",
      name: "Portador",
      kind: "player",
      baseStats: { ...DEFAULT_STATS },
      equipment: {
        horns: item.id,
        hand: null,
        armor: null,
        leg: null,
        utility: null,
      },
      skills: [null, null, null],
      inventory: [],
    };
    const content = emptyContent();
    content.items.push(item);
    content.effects.push(bleed);
    const campaign: Campaign = {
      id: "cmp_crown",
      name: "Efectos de inicio",
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      rules: { ...DEFAULT_RULES },
      settings: { ...DEFAULT_SETTINGS },
      wallet: { cleanShards: 0 },
      content,
    };

    const unit = snapshotUnit(character, { campaign, team: "players" });
    const passive = unit.effects.find(
      (effect) => effect.effectId === bleed.id && effect.passive,
    );
    const active = unit.effects.find(
      (effect) => effect.effectId === bleed.id && !effect.passive,
    );

    expect(passive?.stacks).toBe(1);
    expect(active).toMatchObject({
      effectId: bleed.id,
      stacks: 3,
      remainingTurns: 3,
      sourceId: item.id,
    });
    expect(active?.passive).not.toBe(true);
  });
});
