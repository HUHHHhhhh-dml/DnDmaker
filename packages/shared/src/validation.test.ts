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
  shopInputSchema,
  skillInputSchema,
} from "./schemas";
import type {
  CampaignContent,
  Character,
  Dungeon,
  Encounter,
  Shop,
  SpecialAbility,
} from "./types";
import {
  findReferences,
  validateCampaign,
  validateCharacter,
  validateContent,
  validateDungeon,
  validateShop,
  validateSpecial,
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

  it("detecta efectos de inicio de combate inexistentes en un objeto", () => {
    const content = cloneContent();
    content.items[0]!.startCombatEffects = [
      { effectId: "eff_inexistente", stacks: 2 },
    ];
    const result = validateContent(content);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.path.includes("startCombatEffects"),
      ),
    ).toBe(true);
  });

  it("detecta efectos al usar la skill inexistentes", () => {
    const content = cloneContent();
    content.skills[0]!.selfEffects = [
      { effectId: "eff_inexistente", stacks: 1 },
    ];
    const result = validateContent(content);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.path.includes("selfEffects")),
    ).toBe(true);
  });

  it("valida los efectos por bando de un dominio y avisa de «Rival»", () => {
    const content = cloneContent();
    const special: SpecialAbility = {
      id: "spc_bandas",
      name: "Dominio de prueba",
      kind: "domain",
      duration: 2,
      oncePerCombat: true,
      target: "team",
      effects: [],
      allyEffects: [
        { type: "applyEffect", effectId: "eff_inexistente", stacks: 1 },
        { type: "damage", base: 4, target: "opponent" },
      ],
      enemyEffects: [{ type: "damage", base: 6 }],
    };
    content.specials = [special];
    const result = validateContent(content);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "error" && issue.path.includes("allyEffects"),
      ),
    ).toBe(true);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "warning" && issue.message.includes("«Rival»"),
      ),
    ).toBe(true);

    const refs = findReferences("eff_inexistente", content);
    expect(
      refs.some((ref) => ref.label.includes("Dominio de prueba")),
    ).toBe(true);
  });

  it("avisa si un dominio define listas por bando y efectos legacy a la vez", () => {
    const content = cloneContent();
    const effectId = content.effects[0]!.id;
    const special: SpecialAbility = {
      id: "spc_legacy",
      name: "Dominio mixto",
      duration: 1,
      oncePerCombat: true,
      target: "team",
      effects: [{ type: "applyEffect", effectId, stacks: 1 }],
      allyEffects: [],
      enemyEffects: [],
    };
    const result = validateSpecial(special, content);
    expect(result.valid).toBe(true);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "warning" &&
          issue.message.includes("efectos legacy"),
      ),
    ).toBe(true);
  });

  it("avisa si se aplica un efecto al rival en un trigger sin rival", () => {
    const content = cloneContent();
    const base = content.effects[0]!;
    content.effects.push({
      ...base,
      id: "eff_opponent_warning",
      name: "Aviso",
      triggers: [
        {
          when: "roundStart",
          actions: [
            {
              type: "applyEffect",
              effectId: base.id,
              target: "opponent" as const,
            },
          ],
        },
      ],
    });
    const result = validateContent(content);
    expect(result.valid).toBe(true);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "warning" &&
          issue.path.includes("triggers[0].actions[0]"),
      ),
    ).toBe(true);
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

  it("acepta jefes como enemigos y sus skills de fase 2", () => {
    const content = cloneContent();
    const boss = content.characters[0]!;
    boss.kind = "boss";
    boss.bossPhase = {
      thresholdPct: 50,
      label: "Fase 2",
      skills: [content.skills[0]!.id, null, null],
    };
    content.encounters.push({
      id: "enc_boss",
      name: "Jefe",
      enemies: [{ characterId: boss.id }],
    });

    const result = validateContent(content);
    expect(result.valid).toBe(true);
    expect(
      result.issues.some((i) => i.path.includes("enemies[0]")),
    ).toBe(false);

    const refs = findReferences(content.skills[0]!.id, content);
    expect(refs.some((ref) => ref.label.includes("fase 2"))).toBe(true);
  });

  it("detecta skills inexistentes en la fase 2 de un jefe", () => {
    const content = cloneContent();
    const boss = content.characters[0]!;
    boss.kind = "boss";
    boss.bossPhase = {
      thresholdPct: 50,
      skills: ["skl_inexistente", null, null],
    };

    const result = validateContent(content);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.path.includes("bossPhase.skills")),
    ).toBe(true);
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

  it("valida tiendas: referencias, duplicados y objetos bloqueados", () => {
    const content = cloneContent();
    const item = content.items[0];
    if (!item) throw new Error("El fixture no tiene objetos.");

    const validShop: Shop = {
      id: "shp_1",
      name: "Mercado",
      background: "/uploads/mercado.gif",
      items: [{ itemId: item.id, price: 10, stock: 2 }],
    };
    expect(validateShop(validShop, content).valid).toBe(true);

    const missing = validateShop(
      { ...validShop, items: [{ itemId: "itm_no_existe", price: 1 }] },
      content,
    );
    expect(missing.valid).toBe(false);

    const duplicated = validateShop(
      {
        ...validShop,
        items: [
          { itemId: item.id, price: 1 },
          { itemId: item.id, price: 2 },
        ],
      },
      content,
    );
    expect(duplicated.valid).toBe(false);

    // Un objeto bloqueado es comprable: solo avisa si ya está desbloqueado.
    const locked: Shop = {
      ...validShop,
      items: [{ itemId: item.id, price: 1 }],
    };
    const lockedResult = validateShop(locked, {
      items: [{ ...item, unlocked: false }],
      skills: content.skills,
    });
    expect(lockedResult.valid).toBe(true);
    expect(lockedResult.issues).toEqual([]);

    const alreadyUnlocked = validateShop(locked, {
      items: [{ ...item, unlocked: true }],
      skills: content.skills,
    });
    expect(alreadyUnlocked.valid).toBe(true);
    expect(
      alreadyUnlocked.issues.some(
        (entry) =>
          entry.severity === "warning" && entry.path.includes(".items"),
      ),
    ).toBe(true);

    // Skills a la venta: referencia, duplicados y aviso si ya está abierta.
    const skill = content.skills[0];
    if (skill) {
      const skillShop: Shop = {
        ...validShop,
        items: [],
        skills: [{ skillId: skill.id, price: 3 }],
      };
      expect(validateShop(skillShop, content).valid).toBe(true);
      expect(
        validateShop(
          { ...skillShop, skills: [{ skillId: "skl_no_existe", price: 3 }] },
          content,
        ).valid,
      ).toBe(false);
      expect(
        validateShop(
          {
            ...skillShop,
            skills: [
              { skillId: skill.id, price: 3 },
              { skillId: skill.id, price: 4 },
            ],
          },
          content,
        ).valid,
      ).toBe(false);
      const alreadyOpen = validateShop(skillShop, {
        ...content,
        skills: [{ ...skill, unlocked: true }],
      });
      expect(
        alreadyOpen.issues.some(
          (entry) => entry.severity === "warning" && entry.path.includes(".skills"),
        ),
      ).toBe(true);
    }

    expect(
      validateContent({ ...content, shops: [validShop, { ...validShop }] }).valid,
    ).toBe(false);

    expect(
      shopInputSchema.safeParse({
        name: "Tienda",
        items: [{ itemId: item.id, price: -1 }],
      }).success,
    ).toBe(false);
    expect(
      shopInputSchema.safeParse({
        name: "Tienda",
        items: [{ itemId: item.id, price: 5 }],
      }).success,
    ).toBe(true);
  });
});

describe("validación de mazmorras (4B)", () => {
  const content = cloneContent();
  const item = content.items[0];
  if (!item) throw new Error("El contenido de ejemplo no tiene objetos.");
  const encounter: Encounter = {
    id: "enc_prueba",
    name: "Guardia de prueba",
    enemies: [],
  };
  const refs = {
    items: content.items,
    skills: content.skills,
    encounters: [encounter],
  };
  const base: Dungeon = {
    id: "dgn_prueba",
    name: "Cripta de prueba",
    entryRoomId: "room-1",
    rooms: [
      { id: "room-1", name: "Entrada", encounterId: encounter.id },
      { id: "room-2", name: "Fogata", kind: "rest" },
    ],
  };

  it("acepta una mazmorra coherente", () => {
    const result = validateDungeon(base, refs);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("avisa sin invalidar de salas sin encuentro y cofres vacíos", () => {
    const result = validateDungeon(
      {
        ...base,
        rooms: [
          ...base.rooms,
          { id: "room-3", name: "Cofre", kind: "treasure" },
          { id: "room-4", name: "Pasillo" },
        ],
      },
      refs,
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((entry) => entry.severity === "warning")).toBe(
      true,
    );
  });

  it("rechaza entrada, ids, encuentros y recompensas inválidas", () => {
    const result = validateDungeon(
      {
        ...base,
        entryRoomId: "room-x",
        rooms: [
          { id: "room-1", name: "Sala A", encounterId: "enc_no_existe" },
          { id: "room-1", name: "Sala B" },
          {
            id: "room-3",
            name: "Cofre",
            kind: "treasure",
            rewards: {
              itemIds: ["itm_no_existe"],
              skillIds: ["skl_no_existe"],
            },
          },
        ],
      },
      refs,
    );
    expect(result.valid).toBe(false);
    const messages = result.issues.map((entry) => entry.message).join(" | ");
    expect(messages).toContain("entrada no existe");
    expect(messages).toContain("ID de sala duplicado");
    expect(messages).toContain("encuentro de la sala no existe");
    expect(messages).toContain("recompensa del cofre no existe");
    expect(messages).toContain("skill del cofre no existe");
  });

  it("detecta mazmorras con el mismo id en el contenido", () => {
    const duplicated: CampaignContent = {
      ...content,
      encounters: [encounter],
      dungeons: [base, { ...base, name: "Otra copia" }],
    };
    const result = validateContent(duplicated);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (entry) =>
          entry.path.startsWith("dungeons[dgn_prueba]") &&
          entry.message.includes("duplicado"),
      ),
    ).toBe(true);
  });
});
