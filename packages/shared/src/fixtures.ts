import {
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  newId,
} from "./defaults";
import type {
  Campaign,
  CampaignContent,
  Character,
  EffectDefinition,
  Item,
  Skill,
} from "./types";

/**
 * Contenido mínimo de ejemplo para tests y para probar la ficha.
 * El seed real de la app vive en `apps/server/src/seed.ts`.
 */
export function sampleContent(): CampaignContent {
  const burn: EffectDefinition = {
    id: "eff_burn",
    code: "BURN",
    name: "Burn",
    description: "Daño por stack al final de la ronda.",
    maxStacks: 5,
    stackMode: "add",
    duration: { type: "turns", default: 3 },
    triggers: [
      {
        when: "roundEnd",
        actions: [
          { type: "damage", perStack: 2, damageType: "mystic" },
          { type: "consumeStacks", amount: 1 },
        ],
      },
    ],
  };

  const protection: EffectDefinition = {
    id: "eff_protection",
    code: "PROT",
    name: "Protection",
    description: "+5 DEF por stack.",
    maxStacks: 3,
    stackMode: "add",
    duration: { type: "turns", default: 3 },
    triggers: [
      {
        when: "roundStart",
        actions: [
          { type: "modifyStat", stat: "def", mode: "flat", amount: 0, perStack: 5 },
        ],
      },
    ],
  };

  const civil: Item = {
    id: "itm_civil",
    code: "AASS-164",
    name: "CIVIL",
    description: "Cuernos otorgados a civiles para reducir Incidentes.",
    slot: "horns",
    rarity: "Common",
    stats: { hpMax: 3, def: 2, atk: 3 },
    tags: ["civil", "starter"],
  };

  const armor: Item = {
    id: "itm_armor",
    code: "AFAB-745",
    name: "SIMPLE ARMOR",
    description: "Armadura básica usada por novatos.",
    slot: "armor",
    stats: { hpMax: 3, def: 5 },
    effects: [{ effectId: protection.id }],
  };

  const odachi: Skill = {
    id: "skl_odachi",
    code: "BETI-928",
    name: "ODACHI",
    coins: 3,
    baseClash: 5,
    coinClash: 7,
    baseDamage: 20,
    coinDamage: 5,
    fullHeadsMultiplier: 2,
    target: "single",
  };

  const character: Character = {
    id: "chr_test",
    name: "Arzu",
    kind: "player",
    baseStats: { ...DEFAULT_STATS },
    equipment: {
      horns: civil.id,
      hand: null,
      armor: armor.id,
      leg: null,
      utility: null,
    },
    skills: [odachi.id, null, null],
    inventory: [{ itemId: civil.id, qty: 1 }],
  };

  return {
    items: [civil, armor],
    skills: [odachi],
    effects: [burn, protection],
    characters: [character],
    encounters: [],
    specials: [],
    shops: [],
    dungeons: [],
  };
}

export function sampleCampaign(): Campaign {
  const now = "2026-10-26T00:00:00.000Z";
  return {
    id: newId("cmp"),
    name: "Campaña de prueba",
    description: "Campaña mínima para tests.",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    rules: { ...DEFAULT_RULES },
    settings: { ...DEFAULT_SETTINGS },
    content: sampleContent(),
  };
}
