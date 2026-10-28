import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "./defaults";
import { sampleCampaign, sampleContent } from "./fixtures";
import {
  campaignSchema,
  characterInputSchema,
  combatScenePatchSchema,
  combatStateSchema,
  encounterInputSchema,
  itemInputSchema,
  skillInputSchema,
} from "./schemas";
import type { CampaignContent, Character, Encounter } from "./types";
import {
  findReferences,
  validateCampaign,
  validateCharacter,
  validateContent,
} from "./validation";

function cloneContent(): CampaignContent {
  return structuredClone(sampleContent());
}

describe("validación de contenido", () => {
  it("acepta el contenido de ejemplo", () => {
    const result = validateContent(sampleContent());
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("detecta referencias a efectos inexistentes", () => {
    const content = cloneContent();
    content.effects = [];
    const result = validateContent(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.includes(".effects"))).toBe(true);
  });

  it("detecta IDs duplicados", () => {
    const content = cloneContent();
    content.items.push(structuredClone(content.items[0]!));
    const result = validateContent(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("ID duplicado"))).toBe(true);
  });

  it("exige exactamente 3 slots de skill", () => {
    const content = cloneContent();
    content.characters[0]!.skills = [content.skills[0]!.id, null] as unknown as (
      | string
      | null
    )[];
    const result = validateContent(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.endsWith(".skills"))).toBe(true);
  });

  it("avisa si equipas un objeto en el slot equivocado", () => {
    const content = cloneContent();
    content.characters[0]!.equipment.hand = content.items[0]!.id;
    const result = validateCharacter(content.characters[0]!, content);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.severity === "warning")).toBe(true);
  });

  it("valida referencias de enemigos y recompensas de encuentros", () => {
    const content = cloneContent();
    const encounter: Encounter = {
      id: "enc_1",
      name: "Prueba",
      enemies: [{ characterId: "chr_nope" }],
      rewards: { itemIds: ["itm_nope"] },
    };
    content.encounters.push(encounter);
    const result = validateContent(content);
    expect(result.valid).toBe(false);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(2);
  });

  it("encuentra quién referencia un efecto", () => {
    const content = cloneContent();
    const refs = findReferences("eff_protection", content);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]?.label).toContain("SIMPLE ARMOR");
  });

  it("encuentra referencias de un objeto en la ficha", () => {
    const content = cloneContent();
    const refs = findReferences("itm_civil", content);
    const labels = refs.map((ref) => ref.label).join(" | ");
    expect(labels).toContain("personaje");
    expect(labels).toContain("inventario");
  });
});

describe("validación de campaña", () => {
  it("acepta la campaña de ejemplo", () => {
    const campaign = sampleCampaign();
    const result = validateCampaign(campaign);
    expect(result.valid).toBe(true);
  });

  it("rechaza un suelo de suerte mayor que el techo", () => {
    const campaign = sampleCampaign();
    campaign.rules = { ...DEFAULT_RULES, luckFloor: 0.95, luckCap: 0.5 };
    const result = validateCampaign(campaign);
    expect(result.valid).toBe(false);
  });

  it("marca el PIN vacío como aviso", () => {
    const campaign = sampleCampaign();
    campaign.settings.requirePin = true;
    campaign.settings.pin = "";
    const result = validateCampaign(campaign);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.severity === "warning")).toBe(true);
  });
});

describe("esquemas Zod", () => {
  it("parsea la campaña completa y la deja idéntica", () => {
    const campaign = sampleCampaign();
    const parsed = campaignSchema.parse(campaign);
    expect(parsed.name).toBe(campaign.name);
    expect(parsed.content.items).toHaveLength(2);
  });

  it("rechaza nombres vacíos, coins fuera de rango y descripciones largas", () => {
    expect(itemInputSchema.safeParse({ name: "", slot: "horns" }).success).toBe(false);
    expect(
      skillInputSchema.safeParse({
        name: "X",
        coins: 0,
        baseClash: 1,
        coinClash: 1,
        baseDamage: 1,
        coinDamage: 1,
      }).success,
    ).toBe(false);
    expect(
      itemInputSchema.safeParse({
        name: "X",
        slot: "horns",
        description: "a".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("rechaza una ficha con menos de 3 slots de skill", () => {
    const character = structuredClone(sampleContent().characters[0]!);
    const parsed = characterInputSchema.safeParse({
      ...character,
      skills: [null, null],
    });
    expect(parsed.success).toBe(false);
  });

  it("acepta imágenes locales y rechaza protocolos raros", () => {
    expect(
      itemInputSchema.safeParse({
        name: "Local",
        slot: "hand",
        image: "/uploads/foo.png",
      }).success,
    ).toBe(true);
    expect(
      itemInputSchema.safeParse({
        name: "Asset",
        slot: "hand",
        image: "/assets/items/civil.png",
      }).success,
    ).toBe(true);
    expect(
      itemInputSchema.safeParse({
        name: "Raro",
        slot: "hand",
        image: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
});

describe("tipos de personaje", () => {
  it("acepta un personaje mínimo válido", () => {
    const character: Character = {
      id: "chr_1",
      name: "Nadie",
      kind: "npc",
      baseStats: { hpMax: 10, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2 },
      equipment: { horns: null, hand: null, armor: null, leg: null, utility: null },
      skills: [null, null, null],
      inventory: [],
    };
    expect(characterInputSchema.safeParse(character).success).toBe(true);
  });
});

describe("escena de combate y compatibilidad (3F.5)", () => {
  const legacyState = {
    id: "cmb_1",
    encounterId: "enc_1",
    round: 1,
    phase: "declaring" as const,
    seed: "seed",
    units: [
      {
        id: "unt_1",
        characterId: "chr_1",
        team: "players" as const,
        kind: "player" as const,
        name: "Antigua",
        stats: { hpMax: 10, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2 },
        hpCurrent: 10,
        equipment: {
          horns: null,
          hand: null,
          armor: null,
          leg: null,
          utility: null,
        },
        skills: [null, null, null],
        effects: [],
        utilityUses: 0,
        defeated: false,
      },
    ],
    actions: {},
    specialCooldowns: {},
    log: [],
  };

  it("parsea estados antiguos sin scene/spdRoll y estados nuevos con escena", () => {
    const legacyUnit = legacyState.units[0]!;
    expect(combatStateSchema.safeParse(legacyState).success).toBe(true);
    // 0 es el valor de compatibilidad para estados antiguos con roll ausente.
    expect(
      combatStateSchema.safeParse({
        ...legacyState,
        units: [{ ...legacyUnit, spdRoll: 0 }],
      }).success,
    ).toBe(true);

    const modern = {
      ...legacyState,
      scene: {
        floor: "/assets/scenes/floor.png",
        wall: "/assets/scenes/wall.png",
        theme: "night",
      },
      units: [
        {
          ...legacyUnit,
          spdRoll: 4,
          stats: { ...legacyUnit.stats, spd: 14 },
        },
      ],
    };
    const parsed = combatStateSchema.parse(modern);
    expect(parsed.scene).toEqual(modern.scene);
    expect(parsed.units[0]?.spdRoll).toBe(4);

    // Roll fuera de 1..4 rechazado.
    expect(
      combatStateSchema.safeParse({
        ...legacyState,
        units: [{ ...legacyUnit, spdRoll: 5 }],
      }).success,
    ).toBe(false);
  });

  it("valida el patch de escena y las capas del encuentro", () => {
    // Al menos un campo y siempre con el validador de imágenes.
    expect(combatScenePatchSchema.safeParse({}).success).toBe(false);
    expect(combatScenePatchSchema.safeParse({ theme: "night" }).success).toBe(
      true,
    );
    expect(combatScenePatchSchema.safeParse({ theme: "neon" }).success).toBe(
      false,
    );
    expect(
      combatScenePatchSchema.safeParse({
        floor: "/assets/scenes/floor.png",
        wall: "/assets/scenes/wall.png",
        theme: "paper",
      }).success,
    ).toBe(true);
    expect(
      combatScenePatchSchema.safeParse({ wall: "javascript:alert(1)" }).success,
    ).toBe(false);

    const encounter = {
      name: "Escena",
      background: "/assets/scenes/floor.png",
      backgroundWall: "/assets/scenes/wall.png",
      sceneTheme: "night",
      enemies: [],
    };
    const parsed = encounterInputSchema.safeParse(encounter);
    expect(parsed.success).toBe(true);
    expect(
      encounterInputSchema.safeParse({ ...encounter, sceneTheme: "neon" })
        .success,
    ).toBe(false);
  });
});
