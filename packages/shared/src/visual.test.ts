import { describe, expect, it } from "vitest";
import {
  currentHp,
  defaultVisualMode,
  resolveVisualMode,
} from "./defaults";
import { characterSchema, skillSchema } from "./schemas";
import { planCombatVisual, type CombatVisualSource } from "./visual";

/**
 * Fase 3A — contrato visual y HP actual.
 * Fase 3F — composición del side-view (preview y combate comparten plan).
 */

const baseCharacter = {
  id: "chr_visual",
  name: "Visual",
  kind: "player" as const,
  baseStats: { hpMax: 50, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2 },
  equipment: {
    horns: null,
    hand: null,
    armor: null,
    leg: null,
    utility: null,
  },
  skills: [null, null, null],
  inventory: [],
};

describe("contrato visual y HP (3A)", () => {
  it("resuelve el modo visual por tipo y permite override", () => {
    expect(defaultVisualMode("enemy")).toBe("portrait");
    expect(defaultVisualMode("player")).toBe("layered");
    expect(defaultVisualMode("npc")).toBe("layered");

    expect(
      resolveVisualMode({ kind: "enemy", visualMode: "layered" }),
    ).toBe("layered");
    expect(resolveVisualMode({ kind: "enemy" })).toBe("portrait");
    expect(resolveVisualMode({ kind: "player" })).toBe("layered");
  });

  it("usa hpMax si no hay hpCurrent y clampa el HP actual", () => {
    expect(currentHp({}, 55)).toBe(55);
    expect(currentHp({ hpCurrent: 17 }, 55)).toBe(17);
    expect(currentHp({ hpCurrent: 0 }, 55)).toBe(0);
    expect(currentHp({ hpCurrent: 90 }, 55)).toBe(55);
    expect(currentHp({ hpCurrent: -5 }, 55)).toBe(0);
  });

  it("parsea visualMode, battleSprite, bodyImage, hpCurrent y weaponImage", () => {
    const character = characterSchema.parse({
      ...baseCharacter,
      visualMode: "layered",
      battleSprite: "/assets/battle.png",
      bodyImage: "/assets/body.png",
      hpCurrent: 20,
    });
    expect(character.visualMode).toBe("layered");
    expect(character.battleSprite).toBe("/assets/battle.png");
    expect(character.bodyImage).toBe("/assets/body.png");
    expect(character.hpCurrent).toBe(20);

    const skill = skillSchema.parse({
      id: "skl_visual",
      name: "Filo",
      coins: 1,
      baseClash: 1,
      coinClash: 1,
      baseDamage: 1,
      coinDamage: 1,
      weaponImage: "/assets/weapon.png",
    });
    expect(skill.weaponImage).toBe("/assets/weapon.png");
  });

  it("rechaza hpCurrent negativo y modos visuales desconocidos", () => {
    expect(() =>
      characterSchema.parse({ ...baseCharacter, hpCurrent: -1 }),
    ).toThrow();
    expect(() =>
      characterSchema.parse({ ...baseCharacter, visualMode: "sprite" }),
    ).toThrow();
  });
});

describe("plan de composición visual (3F)", () => {
  const content = {
    items: [
      { id: "leg", name: "Piernas", slot: "leg" as const, image: "/leg.png" },
      { id: "armor", name: "Armadura", slot: "armor" as const, image: "/armor.png" },
      { id: "horns", name: "Cuernos", slot: "horns" as const, image: "/horns.png" },
      { id: "hand", name: "Mano", slot: "hand" as const, image: "/hand.png" },
      { id: "utility", name: "Utilidad", slot: "utility" as const, image: "/utility.png" },
      { id: "noimg", name: "Sin imagen", slot: "hand" as const },
    ],
  };

  const party: CombatVisualSource = {
    kind: "player",
    visualMode: "layered",
    bodyImage: "/body.png",
    battleSprite: "/battle.png",
    portrait: "/portrait.png",
    equipment: {
      leg: "leg",
      armor: "armor",
      horns: "horns",
      hand: "hand",
      utility: "utility",
    },
  };

  it("apila cuerpo + leg → armor → horns → hand y no dibuja la utilidad", () => {
    const plan = planCombatVisual(party, content);
    expect(plan.kind).toBe("layered");
    if (plan.kind !== "layered") return;
    expect(plan.baseImage).toBe("/body.png");
    expect(plan.layers.map((layer) => layer.slot)).toEqual([
      "leg",
      "armor",
      "horns",
      "hand",
    ]);
    expect(plan.layers.at(-1)?.image).toBe("/hand.png");
  });

  it("sustituye la mano por el arma de la skill activa", () => {
    const plan = planCombatVisual(party, content, {
      weaponImage: "/skill-blade.png",
    });
    if (plan.kind !== "layered") throw new Error("Se esperaba modo capas.");
    const hand = plan.layers.find((layer) => layer.slot === "hand");
    expect(hand?.image).toBe("/skill-blade.png");
    expect(plan.layers.filter((layer) => layer.slot === "hand")).toHaveLength(1);
  });

  it("aplica fallbacks: capas sin cuerpo → sprite → retrato → placeholder", () => {
    const noBody = planCombatVisual({ ...party, bodyImage: undefined }, content);
    expect(noBody).toEqual({ kind: "single", image: "/battle.png" });

    const onlyPortrait = planCombatVisual(
      { ...party, visualMode: "portrait", battleSprite: undefined },
      content,
    );
    expect(onlyPortrait).toEqual({ kind: "single", image: "/portrait.png" });

    expect(
      planCombatVisual(
        {
          ...party,
          visualMode: "portrait",
          battleSprite: undefined,
          portrait: undefined,
        },
        content,
      ),
    ).toEqual({ kind: "placeholder" });
  });

  it("los enemigos usan sprite único por defecto", () => {
    const enemy: CombatVisualSource = {
      kind: "enemy",
      bodyImage: "/body.png",
      battleSprite: "/enemy-battle.png",
      portrait: "/enemy-portrait.png",
      equipment: {
        leg: null,
        armor: null,
        horns: null,
        hand: null,
        utility: null,
      },
    };
    expect(planCombatVisual(enemy, content)).toEqual({
      kind: "single",
      image: "/enemy-battle.png",
    });
  });
});
