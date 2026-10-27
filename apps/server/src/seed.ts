import {
  emptyContent,
  newId,
  type CampaignContent,
  type Character,
  type EffectDefinition,
  type Item,
  type Skill,
  type SpecialAbility,
} from "@protocol-life/shared";

/**
 * Seed inicial: un pequeño bestiario/arsenal inspirado en el prototipo
 * (`reference/protocol-game-v1.1.html`). Todo es editable desde la app.
 */

export const SEED_CAMPAIGN_NAME = "Campaña de prueba";
export const SEED_CAMPAIGN_DESCRIPTION =
  "Contenido inicial de PROTOCOL LIFE: objetos, skills, efectos y una party para empezar a editar.";

export function buildSeedContent(): CampaignContent {
  const content = emptyContent();

  const burn: EffectDefinition = {
    id: newId("eff"),
    code: "BURN",
    name: "Burn",
    description: "Al final de la ronda, cada stack hace daño y consume un stack.",
    icon: "",
    maxStacks: 5,
    stackMode: "add",
    duration: { type: "turns", default: 3 },
    triggers: [
      {
        when: "roundEnd",
        actions: [
          { type: "damage", base: 0, perStack: 2, damageType: "mystic" },
          { type: "consumeStacks", amount: 1 },
        ],
      },
    ],
    tags: ["dot", "fuego"],
  };

  const bleed: EffectDefinition = {
    id: newId("eff"),
    code: "BLEED",
    name: "Bleed",
    description: "Castiga las acciones: al usar una skill, cada stack hace daño.",
    icon: "",
    maxStacks: 10,
    stackMode: "add",
    duration: { type: "turns", default: 2 },
    triggers: [
      {
        when: "onUseSkill",
        actions: [
          { type: "damage", base: 0, perStack: 1, damageType: "physical" },
          { type: "consumeStacks", amount: 1 },
        ],
      },
    ],
    tags: ["dot", "sangrado"],
  };

  const protection: EffectDefinition = {
    id: newId("eff"),
    code: "PROT",
    name: "Protection",
    description: "+5 DEF por stack mientras esté activo.",
    icon: "",
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
    tags: ["buff", "defensa"],
  };

  const haste: EffectDefinition = {
    id: newId("eff"),
    code: "HASTE",
    name: "Haste",
    description: "+3 SPD por stack mientras esté activo.",
    icon: "",
    maxStacks: 3,
    stackMode: "add",
    duration: { type: "turns", default: 3 },
    triggers: [
      {
        when: "roundStart",
        actions: [
          { type: "modifyStat", stat: "spd", mode: "flat", amount: 0, perStack: 3 },
        ],
      },
    ],
    tags: ["buff", "velocidad"],
  };

  content.effects.push(burn, bleed, protection, haste);

  const civil: Item = {
    id: newId("itm"),
    code: "AASS-164",
    unlocked: true,
    name: "CIVIL",
    description: "Cuernos otorgados a civiles para reducir Incidentes.",
    slot: "horns",
    rarity: "Common",
    stats: { hpMax: 3, def: 2, atk: 3 },
    tags: ["civil", "starter"],
    price: 40,
  };

  const warrior: Item = {
    id: newId("itm"),
    code: "ADTH-376",
    unlocked: true,
    name: "WARRIOR",
    description: "Los aspirantes a ser guerreros usan estos cuernos.",
    slot: "horns",
    rarity: "Rare",
    stats: { hpMax: 5, def: 5, atk: 5 },
    tags: ["guerrero"],
    price: 120,
  };

  const brokenFetters: Item = {
    id: newId("itm"),
    code: "OPMS-356",
    unlocked: false,
    name: "BROKEN FETTERS",
    description:
      "Captan la energía del usuario y la liberan al entrar en combate: mucho ATK, poca vida.",
    slot: "hand",
    rarity: "Unique",
    stats: { hpMax: -10, def: -3, atk: 20 },
    tags: ["riesgo", "arma"],
    price: 300,
  };

  const simpleArmor: Item = {
    id: newId("itm"),
    code: "AFAB-745",
    unlocked: true,
    name: "SIMPLE ARMOR",
    description: "Armadura básica usada por novatos.",
    slot: "armor",
    rarity: "Common",
    stats: { hpMax: 3, def: 5 },
    effects: [{ effectId: protection.id, stacks: 1 }],
    tags: ["starter"],
    price: 60,
  };

  const whiteBoots: Item = {
    id: newId("itm"),
    code: "PWBE-747",
    unlocked: true,
    name: "WHITE BOOTS",
    description: "Usadas por los Purifiers en terrenos complicados.",
    slot: "leg",
    rarity: "Rare",
    stats: { def: 20, atk: 10 },
    tags: ["botas"],
    price: 140,
  };

  const healingInjection: Item = {
    id: newId("itm"),
    code: "BAHW-367",
    unlocked: true,
    name: "HEALING INJECTION",
    description: "Inyección de campaña: cura 20 HP al usarla en combate.",
    slot: "utility",
    rarity: "Common",
    uses: 10,
    useEffect: [{ type: "heal", base: 20 }],
    tags: ["curación", "consumible"],
    price: 25,
  };

  const purifierInjection: Item = {
    id: newId("itm"),
    code: "CLYK-643",
    unlocked: true,
    name: "PURIFIER INJECTION",
    description: "Inyección de élite: cura 150 HP.",
    slot: "utility",
    rarity: "Unique",
    uses: 3,
    useEffect: [{ type: "heal", base: 150 }],
    tags: ["curación", "consumible"],
    price: 200,
  };

  content.items.push(
    civil,
    warrior,
    brokenFetters,
    simpleArmor,
    whiteBoots,
    healingInjection,
    purifierInjection,
  );

  const odachi: Skill = {
    id: newId("skl"),
    code: "BETI-928",
    unlocked: true,
    name: "ODACHI",
    description: "Tres monedas y un filo que no perdona.",
    coins: 3,
    baseClash: 5,
    coinClash: 7,
    baseDamage: 20,
    coinDamage: 5,
    fullHeadsMultiplier: 2,
    target: "single",
    effects: [{ effectId: burn.id, chance: 0.35, stacks: 1 }],
    tags: ["corte"],
  };

  const simpleDagger: Skill = {
    id: newId("skl"),
    code: "BSGO-728",
    unlocked: true,
    name: "SIMPLE DAGGER",
    description: "Rápida y sucia; puede abrir heridas.",
    coins: 2,
    baseClash: 5,
    coinClash: 5,
    baseDamage: 20,
    coinDamage: 5,
    target: "single",
    effects: [{ effectId: bleed.id, chance: 0.5, stacks: 1 }],
    tags: ["corte"],
  };

  const simpleRifle: Skill = {
    id: newId("skl"),
    code: "BTAH-885",
    unlocked: true,
    name: "SIMPLE RIFLE",
    description: "Un disparo con mucho clasha y daño fiable.",
    coins: 1,
    baseClash: 10,
    coinClash: 5,
    baseDamage: 20,
    coinDamage: 10,
    target: "single",
    tags: ["disparo"],
  };

  const lance: Skill = {
    id: newId("skl"),
    code: "AACZ-996",
    unlocked: true,
    name: "LANCE",
    description: "Alcance medio, dos monedas equilibradas.",
    coins: 2,
    baseClash: 5,
    coinClash: 5,
    baseDamage: 10,
    coinDamage: 5,
    target: "single",
    tags: ["lanza"],
  };

  const thirdOdachi: Skill = {
    id: newId("skl"),
    code: "WEFE-421",
    unlocked: false,
    name: "3RD ODACHI",
    description: "Cinco monedas. Si sale todo caras, se acaba la conversación.",
    coins: 5,
    baseClash: 10,
    coinClash: 15,
    baseDamage: 50,
    coinDamage: 15,
    fullHeadsMultiplier: 2,
    target: "single",
    effects: [{ effectId: bleed.id, chance: 0.6, stacks: 2 }],
    tags: ["élite", "corte"],
  };

  content.skills.push(odachi, simpleDagger, simpleRifle, lance, thirdOdachi);

  const domain: SpecialAbility = {
    id: newId("spc"),
    code: "JASIF!!8",
    name: "Kiteretsu no Toppa",
    description:
      "Ruptura de protocolo: el equipo gana ATK, DEF y HP durante 4 rondas. Una vez por combate.",
    duration: 4,
    oncePerCombat: true,
    target: "team",
    effects: [
      { type: "modifyStat", stat: "atk", mode: "flat", amount: 150 },
      { type: "modifyStat", stat: "def", mode: "flat", amount: 100 },
      { type: "modifyStat", stat: "hpMax", mode: "flat", amount: 60 },
    ],
  };

  const habitat: SpecialAbility = {
    id: newId("spc"),
    code: "ASDE01!3",
    name: "The Beginning at the Sky and the Limit at Hell",
    description:
      "El hábitat del equipo: +100 ATK, +100 DEF y +100 HP durante 4 rondas.",
    duration: 4,
    oncePerCombat: true,
    target: "team",
    effects: [
      { type: "modifyStat", stat: "atk", mode: "flat", amount: 100 },
      { type: "modifyStat", stat: "def", mode: "flat", amount: 100 },
      { type: "modifyStat", stat: "hpMax", mode: "flat", amount: 100 },
    ],
  };

  content.specials.push(domain, habitat);

  const arzu: Character = {
    id: newId("chr"),
    name: "Arzu",
    kind: "player",
    description: "Portador de la Odachi. Busca su lugar en la Armada 2.",
    baseStats: { hpMax: 50, def: 0, atk: 0, spd: 10, luck: 5, skillSlots: 2 },
    equipment: {
      horns: civil.id,
      hand: null,
      armor: simpleArmor.id,
      leg: whiteBoots.id,
      utility: healingInjection.id,
    },
    skills: [odachi.id, simpleDagger.id, lance.id],
    special: { domainId: domain.id, habitatId: habitat.id },
    inventory: [{ itemId: healingInjection.id, qty: 2 }],
    notes: "Ficha de ejemplo: cámbiala o crea la tuya.",
    tags: ["party"],
  };

  const maciel: Character = {
    id: newId("chr"),
    name: "Maciel",
    kind: "player",
    description: "La voz de la Armada 2. Prefiere resolverlo a tiros.",
    baseStats: { hpMax: 45, def: 2, atk: 2, spd: 11, luck: 0, skillSlots: 2 },
    equipment: {
      horns: warrior.id,
      hand: null,
      armor: simpleArmor.id,
      leg: null,
      utility: purifierInjection.id,
    },
    skills: [simpleRifle.id, simpleDagger.id, null],
    inventory: [{ itemId: purifierInjection.id, qty: 1 }],
    tags: ["party"],
  };

  const scout: Character = {
    id: newId("chr"),
    name: "Purifier Scout",
    kind: "enemy",
    description: "Explorador de la Armada 2. Rápido y desechable.",
    baseStats: { hpMax: 40, def: 10, atk: 5, spd: 12, luck: 0, skillSlots: 2 },
    equipment: {
      horns: null,
      hand: null,
      armor: null,
      leg: null,
      utility: null,
    },
    skills: [simpleRifle.id, simpleDagger.id, null],
    inventory: [],
    tags: ["armada-2"],
  };

  const echo: Character = {
    id: newId("chr"),
    name: "Protocol Echo",
    kind: "enemy",
    description: "Una copia del protocolo que no debería existir.",
    baseStats: { hpMax: 90, def: 20, atk: 10, spd: 8, luck: 10, skillSlots: 3 },
    equipment: {
      horns: warrior.id,
      hand: brokenFetters.id,
      armor: null,
      leg: null,
      utility: null,
    },
    skills: [thirdOdachi.id, simpleDagger.id, simpleRifle.id],
    inventory: [],
    tags: ["jefe"],
  };

  content.characters.push(arzu, maciel, scout, echo);

  content.encounters.push({
    id: newId("enc"),
    name: "Protocolo roto",
    description: "Dos exploradores Purifier bloquean el paso.",
    enemies: [
      { characterId: scout.id, count: 2 },
      { characterId: echo.id, count: 1 },
    ],
    rewards: {
      currency: 120,
      itemIds: [healingInjection.id],
      notes: "Botín de prueba.",
    },
    victory: "La patrulla cede el paso.",
    defeat: "El protocolo se reinicia.",
  });

  return content;
}
