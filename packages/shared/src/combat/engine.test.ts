import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  DEFAULT_STATS,
  emptyContent,
} from "../defaults";
import type {
  AppliedEffect,
  CampaignContent,
  CombatState,
  CombatUnit,
  DeclaredAction,
  EffectDefinition,
  Id,
  Item,
  Skill,
  SpecialAbility,
  Stats,
  Team,
} from "../types";
import {
  SPECIAL_USED,
  applyEffect,
  collectTriggers,
  computeDamage,
  createRng,
  effectiveStats,
  executeEffectActions,
  resolveClash,
  resolveRound,
  rollCoins,
  tickEffects,
  winnerOf,
} from "./index";

/**
 * Tests del motor puro 3B. Usan seeds/estados fijos y no tocan DB ni React.
 */

const EMPTY_EQUIPMENT = {
  horns: null,
  hand: null,
  armor: null,
  leg: null,
  utility: null,
} as const;

function makeUnit(params: {
  id: string;
  name?: string;
  team?: Team;
  baseStats?: Partial<Stats>;
  stats?: Stats;
  hpCurrent?: number;
  skills?: (Id | null)[];
  effects?: AppliedEffect[];
  utilityUses?: number;
  special?: CombatUnit["special"];
  overcharged?: boolean;
}): CombatUnit {
  const baseStats: Stats = {
    ...DEFAULT_STATS,
    atk: 10,
    ...params.baseStats,
  };
  const stats = params.stats ?? { ...baseStats };
  const hpCurrent = params.hpCurrent ?? stats.hpMax;
  return {
    id: params.id,
    characterId: params.id,
    team: params.team ?? "players",
    kind: (params.team ?? "players") === "enemies" ? "enemy" : "player",
    name: params.name ?? params.id,
    stats,
    baseStats,
    hpCurrent,
    equipment: { ...EMPTY_EQUIPMENT },
    skills: params.skills ?? [null, null, null],
    special: params.special,
    effects: params.effects ?? [],
    utilityUses: params.utilityUses ?? 0,
    overcharged: params.overcharged,
    defeated: hpCurrent <= 0,
  };
}

function makeSkill(
  id: string,
  partial: Partial<Skill> = {},
): Skill {
  return {
    id,
    name: id,
    coins: 1,
    baseClash: 10,
    coinClash: 0,
    baseDamage: 10,
    coinDamage: 0,
    target: "single",
    ...partial,
  };
}

function makeEffect(
  id: string,
  partial: Partial<EffectDefinition> = {},
): EffectDefinition {
  return {
    id,
    name: id,
    maxStacks: 5,
    stackMode: "add",
    duration: { type: "turns", default: 3 },
    triggers: [],
    ...partial,
  };
}

function makeSpecial(
  id: string,
  partial: Partial<SpecialAbility> = {},
): SpecialAbility {
  return {
    id,
    name: id,
    duration: 4,
    oncePerCombat: true,
    target: "team",
    effects: [],
    ...partial,
  };
}

function makeItem(id: string, partial: Partial<Item> = {}): Item {
  return {
    id,
    name: id,
    slot: "utility",
    uses: 2,
    useEffect: [],
    ...partial,
  };
}

function makeContent(params: {
  skills?: Skill[];
  effects?: EffectDefinition[];
  specials?: SpecialAbility[];
  items?: Item[];
}): CampaignContent {
  const content = emptyContent();
  content.skills.push(...(params.skills ?? []));
  content.effects.push(...(params.effects ?? []));
  content.specials.push(...(params.specials ?? []));
  content.items.push(...(params.items ?? []));
  return content;
}

function makeState(
  units: CombatUnit[],
  actions: Record<Id, DeclaredAction[]> = {},
  options: {
    round?: number;
    seed?: string;
    specialCooldowns?: CombatState["specialCooldowns"];
  } = {},
): CombatState {
  const actionMap: CombatState["actions"] = {};
  const cooldowns: CombatState["specialCooldowns"] = {};
  for (const unit of units) {
    actionMap[unit.id] = actions[unit.id] ?? [];
    cooldowns[unit.id] = options.specialCooldowns?.[unit.id] ?? {};
  }
  return {
    id: "cmb_test",
    encounterId: "enc_test",
    round: options.round ?? 1,
    phase: "declaring",
    seed: options.seed ?? "seed-test",
    units,
    actions: actionMap,
    specialCooldowns: cooldowns,
    log: [],
  };
}

function act(
  unitId: Id,
  slot: number,
  extra: Partial<DeclaredAction> = {},
): DeclaredAction {
  return { unitId, slot, locked: true, ...extra };
}

function unitFromState(state: CombatState, id: Id): CombatUnit {
  const unit = state.units.find((entry) => entry.id === id);
  if (!unit) throw new Error(`No existe la unidad ${id}`);
  return unit;
}

describe("3B — monedas, full heads y daño", () => {
  it("distingue todas caras de todas cruces con la probabilidad de LUCK", () => {
    const skill = makeSkill("skl", {
      coins: 3,
      baseClash: 5,
      coinClash: 7,
      baseDamage: 10,
      coinDamage: 5,
    });
    const stats = { ...DEFAULT_STATS, atk: 20, luck: 0 };

    const heads = rollCoins(
      skill,
      stats,
      createRng("heads-0"),
      DEFAULT_RULES,
    );
    expect(heads.faces).toEqual([true, true, true]);
    expect(heads.heads).toBe(3);
    expect(heads.clashPower).toBe(26);
    expect(heads.fullHeads).toBe(true);
    expect(heads.rawDamage).toBe(90);
    expect(heads.probability).toBe(0.5);

    const tails = rollCoins(
      skill,
      stats,
      createRng("tails-1"),
      DEFAULT_RULES,
    );
    expect(tails.faces).toEqual([false, false, false]);
    expect(tails.heads).toBe(0);
    expect(tails.clashPower).toBe(5);
    expect(tails.fullHeads).toBe(false);
    expect(tails.rawDamage).toBe(30);
  });

  it("aplica full heads multiplier y respeta el override de la skill", () => {
    const stats = { ...DEFAULT_STATS, atk: 20, luck: 0 };
    const skill = makeSkill("skl", {
      coins: 3,
      baseClash: 5,
      coinClash: 7,
      baseDamage: 10,
      coinDamage: 5,
      fullHeadsMultiplier: 3,
    });
    const roll = rollCoins(
      skill,
      stats,
      createRng("heads-0"),
      DEFAULT_RULES,
    );
    expect(roll.rawDamage).toBe(135);

    const noBonus = rollCoins(
      { ...skill, fullHeadsMultiplier: 1 },
      stats,
      createRng("heads-0"),
      DEFAULT_RULES,
    );
    expect(noBonus.rawDamage).toBe(45);
  });

  it("calcula DEF 0/50/100/200, DEF negativa y mínimo 1", () => {
    expect(computeDamage(100, 0, DEFAULT_RULES)).toBe(100);
    expect(computeDamage(100, 50, DEFAULT_RULES)).toBe(66);
    expect(computeDamage(100, 100, DEFAULT_RULES)).toBe(50);
    expect(computeDamage(100, 200, DEFAULT_RULES)).toBe(33);
    expect(computeDamage(100, -50, DEFAULT_RULES)).toBe(100);
    expect(computeDamage(1, 200, DEFAULT_RULES)).toBe(1);
    expect(computeDamage(100, 200, DEFAULT_RULES, "pure")).toBe(100);
  });

  it("un objetivo OVERCHARGED recibe 1.5× daño en combate", () => {
    const skill = makeSkill("skl_overcharge", {
      coins: 1,
      baseClash: 10,
      coinClash: 0,
      baseDamage: 100,
      coinDamage: 0,
    });
    const content = makeContent({ skills: [skill] });

    function hpAfterAttack(overcharged: boolean): number {
      const attacker = makeUnit({
        id: "attacker",
        baseStats: { hpMax: 1000, atk: 0, def: 0 },
        skills: [skill.id, null, null],
      });
      const target = makeUnit({
        id: "target",
        team: "enemies",
        baseStats: { hpMax: 1000, def: 0 },
        hpCurrent: 1000,
        overcharged,
      });
      const state = makeState([attacker, target], {
        attacker: [
          act("attacker", 1, { skillId: skill.id, targetId: target.id }),
        ],
      });
      const result = resolveRound(
        state,
        state.actions,
        content,
        DEFAULT_RULES,
      );
      return unitFromState(result.state, target.id).hpCurrent;
    }

    expect(hpAfterAttack(false)).toBe(900);
    expect(hpAfterAttack(true)).toBe(850);
  });
});

describe("3B — clash y redirección", () => {
  it("empate cancela ambas acciones", () => {
    const skill = makeSkill("skl_tie", {
      coins: 2,
      baseClash: 10,
      coinClash: 0,
    });
    const a = makeUnit({ id: "a", name: "A" });
    const b = makeUnit({ id: "b", name: "B" });
    const rng = createRng("tie-seed");

    const direct = resolveClash(
      { unit: a, skill, action: act("a", 1, { skillId: skill.id, targetId: "b" }) },
      { unit: b, skill, action: act("b", 2, { skillId: skill.id, targetId: "a" }) },
      DEFAULT_RULES,
      rng,
    );
    expect(direct.tie).toBe(true);
    expect(direct.cancelled).toBe(true);
    expect(direct.damage).toBe(0);

    const content = makeContent({ skills: [skill] });
    const state = makeState([a, b], {
      a: [act("a", 1, { skillId: skill.id, targetId: "b" })],
      b: [act("b", 2, { skillId: skill.id, targetId: "a" })],
    });
    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    const clash = result.events.find((event) => event.type === "clash");
    expect(clash?.data?.tie).toBe(true);
    expect(clash?.data?.cancelled).toBe(true);
    expect(result.events.some((event) => event.type === "damage")).toBe(false);
    expect(unitFromState(result.state, "a").hpCurrent).toBe(50);
    expect(unitFromState(result.state, "b").hpCurrent).toBe(50);
  });

  it("clashea acciones de slots distintos si se apuntan", () => {
    const skillA = makeSkill("skl_a", {
      coins: 1,
      baseClash: 20,
      coinClash: 0,
      baseDamage: 10,
      coinDamage: 0,
    });
    const skillB = makeSkill("skl_b", {
      coins: 1,
      baseClash: 5,
      coinClash: 0,
      baseDamage: 10,
      coinDamage: 0,
    });
    const a = makeUnit({
      id: "a",
      team: "players",
      baseStats: { spd: 20, atk: 10, hpMax: 50 },
      skills: [skillA.id, null, null],
    });
    const b = makeUnit({
      id: "b",
      team: "enemies",
      baseStats: { spd: 10, atk: 10, hpMax: 50 },
      skills: [skillB.id, null, null],
    });
    const content = makeContent({ skills: [skillA, skillB] });
    const state = makeState([a, b], {
      a: [act("a", 1, { skillId: skillA.id, targetId: "b" })],
      b: [act("b", 2, { skillId: skillB.id, targetId: "a" })],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    const clash = result.events.find((event) => event.type === "clash");
    expect(clash?.data).toMatchObject({
      attackerId: "a",
      defenderId: "b",
      attackerSkillId: skillA.id,
      defenderSkillId: skillB.id,
      attackerSlot: 1,
      defenderSlot: 2,
      winner: "attacker",
    });
    expect(clash?.data?.oneSided).not.toBe(true);
    expect(unitFromState(result.state, "b").hpCurrent).toBe(30);
    expect(unitFromState(result.state, "a").hpCurrent).toBe(50);
    expect(result.state.actions.a).toEqual([]);
    expect(result.state.actions.b).toEqual([]);
  });

  it("una redirección válida intercepta y protege al aliado", () => {
    const skillA = makeSkill("skl_a", { baseClash: 5, baseDamage: 10 });
    const skillC = makeSkill("skl_c", { baseClash: 20, baseDamage: 10 });
    const a = makeUnit({
      id: "a",
      team: "enemies",
      baseStats: { spd: 10, atk: 10, hpMax: 50 },
    });
    const b = makeUnit({
      id: "b",
      team: "players",
      baseStats: { spd: 5, atk: 0, hpMax: 50 },
    });
    const c = makeUnit({
      id: "c",
      team: "players",
      baseStats: { spd: 20, atk: 10, hpMax: 50 },
    });
    const content = makeContent({ skills: [skillA, skillC] });
    const state = makeState([a, b, c], {
      a: [act("a", 1, { skillId: skillA.id, targetId: "b" })],
      c: [
        act("c", 1, {
          skillId: skillC.id,
          targetId: "a",
          redirectFor: "b",
        }),
      ],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    const redirect = result.events.find((event) => event.type === "redirect");
    expect(redirect?.data).toMatchObject({
      redirectorId: "c",
      attackerId: "a",
      protectedId: "b",
    });
    expect(unitFromState(result.state, "b").hpCurrent).toBe(50);
    expect(unitFromState(result.state, "a").hpCurrent).toBe(30);
    expect(unitFromState(result.state, "c").hpCurrent).toBe(50);
  });

  it("reparte varias acciones: un clash y una one-sided extra", () => {
    const skillA = makeSkill("skl_a", {
      baseClash: 20,
      baseDamage: 10,
      coinClash: 0,
      coinDamage: 0,
    });
    const skillB = makeSkill("skl_b", {
      baseClash: 5,
      baseDamage: 10,
      coinClash: 0,
      coinDamage: 0,
    });
    const a = makeUnit({
      id: "a",
      baseStats: { spd: 20, atk: 10, hpMax: 50 },
      skills: [skillA.id, null, null],
    });
    const b = makeUnit({
      id: "b",
      team: "enemies",
      baseStats: { spd: 10, atk: 10, hpMax: 200 },
      skills: [skillB.id, null, null],
    });
    const content = makeContent({ skills: [skillA, skillB] });
    const state = makeState([a, b], {
      a: [
        act("a", 1, { skillId: skillA.id, targetId: "b" }),
        act("a", 2, { skillId: skillA.id, targetId: "b" }),
      ],
      b: [act("b", 1, { skillId: skillB.id, targetId: "a" })],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    const clashes = result.events.filter((event) => event.type === "clash");
    expect(clashes).toHaveLength(2);
    expect(clashes.some((event) => event.data?.oneSided === true)).toBe(true);
    expect(unitFromState(result.state, "b").hpCurrent).toBe(160);
    expect(unitFromState(result.state, "a").hpCurrent).toBe(50);
  });

  it("permite una redirección por ataque con varios redirigidores", () => {
    const skillA = makeSkill("skl_a", { baseClash: 5, baseDamage: 10 });
    const skillC = makeSkill("skl_c", { baseClash: 20, baseDamage: 10 });
    const a = makeUnit({
      id: "a",
      team: "enemies",
      baseStats: { spd: 10, atk: 10, hpMax: 200 },
      skills: [skillA.id, null, null],
    });
    const b = makeUnit({
      id: "b",
      team: "players",
      baseStats: { spd: 5, atk: 0, hpMax: 50 },
    });
    const c = makeUnit({
      id: "c",
      team: "players",
      baseStats: { spd: 20, atk: 10, hpMax: 50 },
    });
    const d = makeUnit({
      id: "d",
      team: "players",
      baseStats: { spd: 15, atk: 10, hpMax: 50 },
    });
    const content = makeContent({ skills: [skillA, skillC] });
    const state = makeState([a, b, c, d], {
      a: [
        act("a", 1, { skillId: skillA.id, targetId: "b" }),
        act("a", 2, { skillId: skillA.id, targetId: "b" }),
      ],
      c: [
        act("c", 1, {
          skillId: skillC.id,
          targetId: "a",
          redirectFor: "b",
        }),
      ],
      d: [
        act("d", 1, {
          skillId: skillC.id,
          targetId: "a",
          redirectFor: "b",
        }),
      ],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    expect(
      result.events.filter((event) => event.type === "redirect"),
    ).toHaveLength(2);
    expect(unitFromState(result.state, "b").hpCurrent).toBe(50);
    expect(unitFromState(result.state, "a").hpCurrent).toBe(160);
  });

  it("rechaza redirección con SPD igual o menor", () => {
    const skillA = makeSkill("skl_a", { baseClash: 20, baseDamage: 10 });
    const skillC = makeSkill("skl_c", { baseClash: 20, baseDamage: 10 });
    const content = makeContent({ skills: [skillA, skillC] });

    for (const cSpd of [10, 5]) {
      const a = makeUnit({
        id: "a",
        team: "enemies",
        baseStats: { spd: 10, atk: 10, hpMax: 50 },
      });
      const b = makeUnit({
        id: "b",
        team: "players",
        baseStats: { spd: 5, atk: 0, hpMax: 50 },
      });
      const c = makeUnit({
        id: "c",
        team: "players",
        baseStats: { spd: cSpd, atk: 10, hpMax: 50 },
      });
      const state = makeState([a, b, c], {
        a: [act("a", 1, { skillId: skillA.id, targetId: "b" })],
        c: [
          act("c", 1, {
            skillId: skillC.id,
            targetId: "a",
            redirectFor: "b",
          }),
        ],
      });

      const result = resolveRound(
        state,
        state.actions,
        content,
        DEFAULT_RULES,
      );
      expect(result.events.some((event) => event.type === "redirect")).toBe(
        false,
      );
      expect(unitFromState(result.state, "b").hpCurrent).toBeLessThan(50);
    }
  });

  it("respeta tieRule defender_wins y both_half (no default)", () => {
    const skill = makeSkill("skl_tie", {
      coins: 1,
      coinClash: 0,
      baseClash: 10,
      baseDamage: 10,
      coinDamage: 0,
    });
    const a = makeUnit({ id: "a", baseStats: { hpMax: 50, def: 0 } });
    const b = makeUnit({ id: "b", baseStats: { hpMax: 50, def: 0 } });
    const rng = createRng("tie-rule");

    const defenderWins = resolveClash(
      { unit: a, skill, action: act("a", 1, { skillId: skill.id, targetId: "b" }) },
      { unit: b, skill, action: act("b", 1, { skillId: skill.id, targetId: "a" }) },
      { ...DEFAULT_RULES, tieRule: "defender_wins" },
      rng,
    );
    expect(defenderWins.winner).toBe("defender");
    expect(defenderWins.tie).toBe(true);
    expect(defenderWins.damageToAttacker).toBeGreaterThan(0);
    expect(defenderWins.damageToDefender).toBe(0);

    const bothHalf = resolveClash(
      { unit: a, skill, action: act("a", 1, { skillId: skill.id, targetId: "b" }) },
      { unit: b, skill, action: act("b", 1, { skillId: skill.id, targetId: "a" }) },
      { ...DEFAULT_RULES, tieRule: "both_half" },
      createRng("tie-rule"),
    );
    expect(bothHalf.winner).toBe("tie");
    expect(bothHalf.cancelled).toBe(false);
    expect(bothHalf.damageToAttacker).toBeGreaterThanOrEqual(1);
    expect(bothHalf.damageToDefender).toBeGreaterThanOrEqual(1);
  });
});

describe("3B — estados, utilidad y dominios", () => {
  const burn = makeEffect("burn", {
    maxStacks: 5,
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
  });
  const bleed = makeEffect("bleed", {
    maxStacks: 10,
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
  });
  const protection = makeEffect("protection", {
    maxStacks: 3,
    duration: { type: "turns", default: 3 },
    triggers: [
      {
        when: "roundStart",
        actions: [
          { type: "modifyStat", stat: "def", mode: "flat", amount: 0, perStack: 5 },
        ],
      },
    ],
  });
  const haste = makeEffect("haste", {
    maxStacks: 3,
    duration: { type: "turns", default: 3 },
    triggers: [
      {
        when: "roundStart",
        actions: [
          { type: "modifyStat", stat: "spd", mode: "flat", amount: 0, perStack: 3 },
        ],
      },
    ],
  });

  const effectsContent = makeContent({
    effects: [burn, bleed, protection, haste],
  });
  const effectContext = { content: effectsContent, rules: DEFAULT_RULES };

  it("Burn hace daño al final de ronda y consume stacks", () => {
    const applied = applyEffect(
      makeUnit({ id: "burned", hpCurrent: 50 }),
      burn.id,
      3,
      effectContext,
    );
    expect(applied.unit.effects[0]?.stacks).toBe(3);
    const state = makeState([applied.unit]);
    const result = resolveRound(state, state.actions, effectsContent, DEFAULT_RULES);
    const unit = unitFromState(result.state, "burned");

    expect(unit.hpCurrent).toBe(44);
    expect(unit.effects[0]?.stacks).toBe(2);
    expect(unit.effects[0]?.remainingTurns).toBe(2);
    const damage = result.events.find((event) => event.type === "damage");
    expect(damage?.data).toMatchObject({ effectId: burn.id, final: 6 });

    // Con un solo stack, Burn se consume y desaparece.
    const single = applyEffect(
      makeUnit({ id: "single", hpCurrent: 50 }),
      burn.id,
      1,
      effectContext,
    ).unit;
    const singleState = makeState([single]);
    const singleResult = resolveRound(
      singleState,
      singleState.actions,
      effectsContent,
      DEFAULT_RULES,
    );
    expect(unitFromState(singleResult.state, "single").hpCurrent).toBe(48);
    expect(unitFromState(singleResult.state, "single").effects).toHaveLength(0);
  });

  it("Bleed castiga el uso de skill y consume un stack", () => {
    const applied = applyEffect(
      makeUnit({ id: "bleeding", hpCurrent: 50 }),
      bleed.id,
      3,
      effectContext,
    );
    const groups = collectTriggers(
      applied.unit,
      "onUseSkill",
      effectsContent,
    );
    expect(groups).toHaveLength(1);
    const result = executeEffectActions(
      applied.unit,
      groups[0]!.trigger.actions,
      groups[0]!.effect.stacks,
      effectContext,
      { effectId: bleed.id },
    );
    expect(result.unit.hpCurrent).toBe(47);
    expect(result.unit.effects[0]?.stacks).toBe(2);
    expect(result.damageApplied).toBe(true);

    // También en una ronda real: Bleed pega antes de resolver la skill.
    const skill = makeSkill("skl_bleed", { baseDamage: 5, baseClash: 10 });
    const bleeder = applyEffect(
      makeUnit({
        id: "bleeder",
        hpCurrent: 50,
        skills: [skill.id, null, null],
      }),
      bleed.id,
      2,
      effectContext,
    ).unit;
    const target = makeUnit({
      id: "target",
      team: "enemies",
      baseStats: { hpMax: 50, def: 0, atk: 0, spd: 5 },
    });
    const content = makeContent({ skills: [skill], effects: [bleed] });
    const state = makeState([bleeder, target], {
      bleeder: [act("bleeder", 1, { skillId: skill.id, targetId: "target" })],
    });
    const round = resolveRound(state, state.actions, content, DEFAULT_RULES);
    expect(unitFromState(round.state, "bleeder").hpCurrent).toBe(48);
    // Después del Bleed, la skill sigue resolviéndose contra su objetivo.
    expect(unitFromState(round.state, "target").hpCurrent).toBe(35);
    expect(
      round.events.some(
        (event) =>
          event.type === "damage" && event.data?.effectId === bleed.id,
      ),
    ).toBe(true);
  });

  it("Aumentar stacks sube el efecto activo y respeta maxStacks", () => {
    const growth = makeEffect("growth", { maxStacks: 3, triggers: [] });
    const growthContent = makeContent({ effects: [growth] });
    const growthContext = {
      content: growthContent,
      rules: DEFAULT_RULES,
    };
    const applied = applyEffect(
      makeUnit({ id: "growing" }),
      growth.id,
      1,
      growthContext,
    ).unit;

    const first = executeEffectActions(
      applied,
      [{ type: "addStacks", amount: 2 }],
      1,
      growthContext,
      { effectId: growth.id },
    );
    expect(first.unit.effects[0]?.stacks).toBe(3);
    expect(first.events[0]?.data).toMatchObject({ added: 2, stacks: 3 });

    const capped = executeEffectActions(
      first.unit,
      [{ type: "addStacks", amount: 2 }],
      1,
      growthContext,
      { effectId: growth.id },
    );
    expect(capped.unit.effects[0]?.stacks).toBe(3);
    expect(capped.events).toHaveLength(0);
  });

  it("Protection y Haste modifican stats mientras duran y revierten al caducar", () => {
    const base = makeUnit({
      id: "buffed",
      baseStats: { def: 0, spd: 10, hpMax: 50 },
    });

    let protectedUnit = applyEffect(
      base,
      protection.id,
      2,
      effectContext,
    ).unit;
    let hastedUnit = applyEffect(
      protectedUnit,
      haste.id,
      2,
      effectContext,
    ).unit;

    expect(effectiveStats(hastedUnit, effectContext).def).toBe(10);
    expect(effectiveStats(hastedUnit, effectContext).spd).toBe(16);

    for (let index = 0; index < 3; index += 1) {
      hastedUnit = tickEffects(hastedUnit, effectContext).unit;
    }
    expect(hastedUnit.effects).toHaveLength(0);
    expect(effectiveStats(hastedUnit, effectContext).def).toBe(0);
    expect(effectiveStats(hastedUnit, effectContext).spd).toBe(10);
  });

  it("la utilidad consume usos y cura; sin usos no se puede usar", () => {
    const heal = makeItem("item_heal", {
      name: "Heal",
      uses: 2,
      useEffect: [{ type: "heal", base: 20 }],
    });
    const content = makeContent({ items: [heal] });
    const unit = makeUnit({
      id: "medic",
      baseStats: { hpMax: 50, atk: 0, spd: 10 },
      hpCurrent: 20,
      utilityUses: 2,
    });
    const actions = {
      medic: [
        act("medic", 1, { utilityId: heal.id, targetId: "medic" }),
      ],
    };

    const first = resolveRound(
      makeState([unit], actions),
      actions,
      content,
      DEFAULT_RULES,
    );
    expect(unitFromState(first.state, "medic").hpCurrent).toBe(40);
    expect(unitFromState(first.state, "medic").utilityUses).toBe(1);

    const secondActions = {
      medic: [
        act("medic", 1, { utilityId: heal.id, targetId: "medic" }),
      ],
    };
    const second = resolveRound(
      first.state,
      secondActions,
      content,
      DEFAULT_RULES,
    );
    expect(unitFromState(second.state, "medic").hpCurrent).toBe(50);
    expect(unitFromState(second.state, "medic").utilityUses).toBe(0);

    const third = resolveRound(
      second.state,
      secondActions,
      content,
      DEFAULT_RULES,
    );
    expect(unitFromState(third.state, "medic").hpCurrent).toBe(50);
    expect(third.events.some((event) => event.type === "cooldown")).toBe(true);

    // Buff de utilidad con modifyStat: efecto permanente del combate.
    const buff = makeItem("item_buff", {
      uses: 1,
      useEffect: [
        { type: "modifyStat", stat: "atk", mode: "flat", amount: 5 },
      ],
    });
    const buffContent = makeContent({ items: [buff] });
    const fighter = makeUnit({
      id: "fighter",
      baseStats: { atk: 10, hpMax: 50 },
      utilityUses: 1,
    });
    const buffActions = {
      fighter: [
        act("fighter", 1, { utilityId: buff.id, targetId: "fighter" }),
      ],
    };
    const buffed = resolveRound(
      makeState([fighter], buffActions),
      buffActions,
      buffContent,
      DEFAULT_RULES,
    );
    const buffedUnit = unitFromState(buffed.state, "fighter");
    expect(
      effectiveStats(buffedUnit, { content: buffContent, rules: DEFAULT_RULES })
        .atk,
    ).toBe(15);
    expect(buffedUnit.utilityUses).toBe(0);
  });

  it("dispara onTakeDamage, onClashWin, onClashLose y onDefeat", () => {
    const onWin = makeEffect("on_win", {
      triggers: [{ when: "onClashWin", actions: [{ type: "heal", base: 5 }] }],
    });
    const onLose = makeEffect("on_lose", {
      triggers: [{ when: "onClashLose", actions: [{ type: "heal", base: 5 }] }],
    });
    const onHit = makeEffect("on_hit", {
      triggers: [
        { when: "onTakeDamage", actions: [{ type: "heal", base: 3 }] },
      ],
    });
    const mark = makeEffect("mark", { triggers: [] });
    const onDeath = makeEffect("on_death", {
      triggers: [
        {
          when: "onDefeat",
          actions: [{ type: "applyEffect", effectId: mark.id, stacks: 1 }],
        },
      ],
    });
    const content = makeContent({
      effects: [onWin, onLose, onHit, mark, onDeath],
    });

    const skillA = makeSkill("skl_a", {
      baseClash: 20,
      baseDamage: 10,
      coinClash: 0,
      coinDamage: 0,
    });
    const skillB = makeSkill("skl_b", {
      baseClash: 5,
      baseDamage: 10,
      coinClash: 0,
      coinDamage: 0,
    });
    content.skills.push(skillA, skillB);

    const a = makeUnit({
      id: "a",
      baseStats: { spd: 20, atk: 10, hpMax: 50 },
      hpCurrent: 40,
      skills: [skillA.id, null, null],
      effects: [{ effectId: onWin.id, stacks: 1 }],
    });
    const b = makeUnit({
      id: "b",
      team: "enemies",
      baseStats: { spd: 10, atk: 10, hpMax: 50 },
      hpCurrent: 50,
      skills: [skillB.id, null, null],
      effects: [
        { effectId: onHit.id, stacks: 1 },
        { effectId: onLose.id, stacks: 1 },
      ],
    });
    const state = makeState([a, b], {
      a: [act("a", 1, { skillId: skillA.id, targetId: "b" })],
      b: [act("b", 1, { skillId: skillB.id, targetId: "a" })],
    });
    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    // A gana el clash: B recibe 20, se cura 3 por onTakeDamage y 5 por
    // onClashLose; A se cura 5 por onClashWin.
    expect(unitFromState(result.state, "b").hpCurrent).toBe(38);
    expect(unitFromState(result.state, "a").hpCurrent).toBe(45);

    const dying = makeUnit({
      id: "dying",
      team: "enemies",
      baseStats: { spd: 10, atk: 10, hpMax: 50 },
      hpCurrent: 10,
      skills: [skillB.id, null, null],
      effects: [{ effectId: onDeath.id, stacks: 1 }],
    });
    const killer = makeUnit({
      id: "killer",
      baseStats: { spd: 20, atk: 10, hpMax: 50 },
      skills: [skillA.id, null, null],
    });
    const deathState = makeState([killer, dying], {
      killer: [act("killer", 1, { skillId: skillA.id, targetId: "dying" })],
      dying: [act("dying", 1, { skillId: skillB.id, targetId: "killer" })],
    });
    const deathResult = resolveRound(
      deathState,
      deathState.actions,
      content,
      DEFAULT_RULES,
    );
    const dead = unitFromState(deathResult.state, "dying");
    expect(dead.hpCurrent).toBe(0);
    expect(dead.defeated).toBe(true);
    expect(dead.effects.some((effect) => effect.effectId === mark.id)).toBe(
      true,
    );
    expect(
      deathResult.events.some((event) => event.type === "defeated"),
    ).toBe(true);
    // El derrotado pierde su acción antes de actuar.
    expect(unitFromState(deathResult.state, "killer").hpCurrent).toBe(50);
    expect(winnerOf(deathResult.state)).toBe("players");
  });

  it("aplica un efecto al rival con onDealDamage y target opponent", () => {
    const mark = makeEffect("mark_on_hit", { triggers: [] });
    const onDealDamage = makeEffect("on_deal_damage", {
      triggers: [
        {
          when: "onDealDamage",
          actions: [
            {
              type: "applyEffect",
              effectId: mark.id,
              stacks: 2,
              target: "opponent",
            },
          ],
        },
      ],
    });
    const skill = makeSkill("skl_hit", {
      baseClash: 10,
      baseDamage: 10,
      coinDamage: 0,
    });
    const content = makeContent({
      skills: [skill],
      effects: [mark, onDealDamage],
    });

    const attacker = makeUnit({
      id: "attacker",
      baseStats: { hpMax: 100, atk: 0 },
      skills: [skill.id, null, null],
      effects: [
        {
          effectId: onDealDamage.id,
          stacks: 1,
          passive: true,
          sourceId: "itm_passive_test",
        },
      ],
    });
    const target = makeUnit({
      id: "target",
      team: "enemies",
      baseStats: { hpMax: 100, def: 0 },
      hpCurrent: 100,
    });
    const state = makeState([attacker, target], {
      attacker: [
        act("attacker", 1, { skillId: skill.id, targetId: target.id }),
      ],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    const marked = unitFromState(result.state, target.id);
    expect(
      marked.effects.find((effect) => effect.effectId === mark.id)?.stacks,
    ).toBe(2);
    expect(
      result.events.some(
        (event) =>
          event.type === "effectApplied" && event.targetId === target.id,
      ),
    ).toBe(true);
  });

  it("aplica un efecto al rival con onClashWin y target opponent", () => {
    const mark = makeEffect("mark_on_win", { triggers: [] });
    const onWin = makeEffect("on_win_target", {
      triggers: [
        {
          when: "onClashWin",
          actions: [
            {
              type: "applyEffect",
              effectId: mark.id,
              stacks: 1,
              target: "opponent",
            },
          ],
        },
      ],
    });
    const strong = makeSkill("skl_strong", {
      baseClash: 9999,
      baseDamage: 1,
      coinDamage: 0,
    });
    const weak = makeSkill("skl_weak", {
      baseClash: 0,
      baseDamage: 1,
      coinDamage: 0,
    });
    const content = makeContent({
      skills: [strong, weak],
      effects: [mark, onWin],
    });

    const a = makeUnit({
      id: "a",
      baseStats: { hpMax: 100, atk: 0 },
      skills: [strong.id, null, null],
      effects: [{ effectId: onWin.id, stacks: 1 }],
    });
    const b = makeUnit({
      id: "b",
      team: "enemies",
      baseStats: { hpMax: 100, def: 0 },
      skills: [weak.id, null, null],
    });
    const state = makeState([a, b], {
      a: [act("a", 1, { skillId: strong.id, targetId: b.id })],
      b: [act("b", 1, { skillId: weak.id, targetId: a.id })],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    const marked = unitFromState(result.state, b.id);
    expect(
      marked.effects.find((effect) => effect.effectId === mark.id)?.stacks,
    ).toBe(1);
    expect(
      result.events.some(
        (event) =>
          event.type === "effectApplied" && event.targetId === b.id,
      ),
    ).toBe(true);
  });

  it("al morir, daña a todos los aliados y enemigos con allOthers", () => {
    const deathBurst = makeEffect("death_burst", {
      triggers: [
        {
          when: "onDefeat",
          actions: [
            {
              type: "damage",
              base: 50,
              perStack: 0,
              damageType: "pure",
              target: "allOthers",
            },
          ],
        },
      ],
    });
    const kill = makeSkill("skl_kill", {
      baseClash: 9999,
      baseDamage: 999,
      coinDamage: 0,
    });
    const content = makeContent({
      effects: [deathBurst],
      skills: [kill],
    });

    const fallen = makeUnit({
      id: "fallen",
      baseStats: { hpMax: 10, def: 0 },
      hpCurrent: 10,
      effects: [
        {
          effectId: deathBurst.id,
          stacks: 1,
          passive: true,
        },
      ],
    });
    const ally = makeUnit({
      id: "ally",
      baseStats: { hpMax: 100, def: 0 },
      hpCurrent: 100,
    });
    const enemy = makeUnit({
      id: "enemy",
      team: "enemies",
      baseStats: { hpMax: 100, def: 0 },
      hpCurrent: 100,
      skills: [kill.id, null, null],
    });
    const state = makeState([fallen, ally, enemy], {
      enemy: [act("enemy", 1, { skillId: kill.id, targetId: fallen.id })],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);

    expect(unitFromState(result.state, fallen.id).hpCurrent).toBe(0);
    // El daño puro de 50 alcanza por igual a aliado y enemigo.
    expect(unitFromState(result.state, ally.id).hpCurrent).toBe(50);
    expect(unitFromState(result.state, enemy.id).hpCurrent).toBe(50);
    expect(
      result.events.filter(
        (event) =>
          event.type === "damage" &&
          (event.targetId === ally.id || event.targetId === enemy.id),
      ),
    ).toHaveLength(2);
  });

  it("un dominio se aplica al equipo una sola vez por combate", () => {
    const domain = makeSpecial("spc_domain", {
      name: "Dominio",
      duration: 5,
      oncePerCombat: true,
      target: "team",
      effects: [
        { type: "modifyStat", stat: "atk", mode: "flat", amount: 10 },
      ],
    });
    const content = makeContent({ specials: [domain] });
    const caster = makeUnit({
      id: "caster",
      baseStats: { atk: 10, hpMax: 50 },
      special: { domainId: domain.id },
    });
    const ally = makeUnit({
      id: "ally",
      baseStats: { atk: 10, hpMax: 50 },
    });
    const actions = {
      caster: [act("caster", 1, { special: "domain" })],
    };

    const first = resolveRound(
      makeState([caster, ally], actions),
      actions,
      content,
      DEFAULT_RULES,
    );
    expect(effectiveStats(unitFromState(first.state, "caster"), { content, rules: DEFAULT_RULES }).atk).toBe(20);
    expect(effectiveStats(unitFromState(first.state, "ally"), { content, rules: DEFAULT_RULES }).atk).toBe(20);
    expect(first.state.specialCooldowns.caster?.[domain.id]).toBe(SPECIAL_USED);
    expect(first.events.some((event) => event.type === "special")).toBe(true);

    const second = resolveRound(
      first.state,
      actions,
      content,
      DEFAULT_RULES,
    );
    expect(effectiveStats(unitFromState(second.state, "caster"), { content, rules: DEFAULT_RULES }).atk).toBe(20);
    expect(effectiveStats(unitFromState(second.state, "ally"), { content, rules: DEFAULT_RULES }).atk).toBe(20);
    expect(second.events.some((event) => event.type === "special")).toBe(false);
    expect(second.events.some((event) => event.type === "cooldown")).toBe(true);
    expect(second.state.specialCooldowns.caster?.[domain.id]).toBe(SPECIAL_USED);
  });
});

describe("3B — determinismo", () => {
  it("misma seed y mismo estado producen el mismo resultado", () => {
    const skillA = makeSkill("skl_a", {
      coins: 3,
      baseClash: 5,
      coinClash: 7,
      baseDamage: 10,
      coinDamage: 5,
    });
    const skillB = makeSkill("skl_b", {
      coins: 2,
      baseClash: 8,
      coinClash: 5,
      baseDamage: 10,
      coinDamage: 5,
    });
    const content = makeContent({ skills: [skillA, skillB] });
    const a = makeUnit({
      id: "a",
      baseStats: { spd: 10, atk: 20, def: 10, hpMax: 50 },
      skills: [skillA.id, null, null],
    });
    const b = makeUnit({
      id: "b",
      baseStats: { spd: 10, atk: 15, def: 12, hpMax: 50 },
      skills: [skillB.id, null, null],
    });
    const actions = {
      a: [act("a", 1, { skillId: skillA.id, targetId: "b" })],
      b: [act("b", 1, { skillId: skillB.id, targetId: "a" })],
    };
    const state = makeState([a, b], actions, { seed: "deterministic-seed" });

    const first = resolveRound(state, actions, content, DEFAULT_RULES);
    const second = resolveRound(state, actions, content, DEFAULT_RULES);

    expect(first.state).toEqual(second.state);
    expect(first.events).toEqual(second.events);
    expect(state.log).toHaveLength(0);

    const rngA = createRng("same");
    const rngB = createRng("same");
    expect([rngA.next(), rngA.next(), rngA.next()]).toEqual([
      rngB.next(),
      rngB.next(),
      rngB.next(),
    ]);
  });
});

describe("3F — efectos al usar la skill (portador)", () => {
  const build = () => {
    const buff = makeEffect("eff_buff", {
      name: "Buff",
      maxStacks: 5,
      stackMode: "add",
      duration: { type: "turns", default: 3 },
      triggers: [],
    });
    const mark = makeEffect("eff_mark", {
      name: "Mark",
      maxStacks: 5,
      stackMode: "add",
      duration: { type: "turns", default: 3 },
      triggers: [],
    });
    return { buff, mark };
  };

  it("aplica los efectos al portador y los de impacto al rival", () => {
    const { buff, mark } = build();
    const skill = makeSkill("skl_self", {
      baseClash: 20,
      baseDamage: 10,
      selfEffects: [{ effectId: buff.id, stacks: 2 }],
      effects: [{ effectId: mark.id, stacks: 1 }],
    });
    const content = makeContent({ skills: [skill], effects: [buff, mark] });
    const a = makeUnit({
      id: "a",
      baseStats: { spd: 20, atk: 10, hpMax: 50 },
      hpCurrent: 50,
      skills: [skill.id, null, null],
    });
    const b = makeUnit({
      id: "b",
      team: "enemies",
      baseStats: { spd: 10, atk: 10, hpMax: 50 },
      hpCurrent: 50,
    });
    const state = makeState([a, b], {
      a: [act("a", 1, { skillId: skill.id, targetId: "b" })],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    const actor = unitFromState(result.state, "a");
    const target = unitFromState(result.state, "b");

    expect(
      actor.effects.find((entry) => entry.effectId === buff.id)?.stacks,
    ).toBe(2);
    expect(
      target.effects.find((entry) => entry.effectId === mark.id)?.stacks,
    ).toBe(1);
    // El portador no recibe el efecto de impacto, ni el rival el autobuff.
    expect(actor.effects.some((entry) => entry.effectId === mark.id)).toBe(false);
    expect(target.effects.some((entry) => entry.effectId === buff.id)).toBe(false);
  });

  it("mantiene el autobuff aunque pierda el clash", () => {
    const { buff, mark } = build();
    const weak = makeSkill("skl_weak", {
      baseClash: 1,
      coinClash: 0,
      baseDamage: 5,
      coinDamage: 0,
      selfEffects: [{ effectId: buff.id, stacks: 1 }],
      effects: [{ effectId: mark.id, stacks: 1 }],
    });
    const strong = makeSkill("skl_strong", {
      baseClash: 50,
      coinClash: 0,
      baseDamage: 5,
      coinDamage: 0,
    });
    const content = makeContent({
      skills: [weak, strong],
      effects: [buff, mark],
    });
    const a = makeUnit({
      id: "a",
      baseStats: { spd: 20, atk: 10, hpMax: 50 },
      hpCurrent: 50,
      skills: [weak.id, null, null],
    });
    const b = makeUnit({
      id: "b",
      team: "enemies",
      baseStats: { spd: 10, atk: 10, hpMax: 50 },
      hpCurrent: 50,
      skills: [strong.id, null, null],
    });
    const state = makeState([a, b], {
      a: [act("a", 1, { skillId: weak.id, targetId: "b" })],
      b: [act("b", 1, { skillId: strong.id, targetId: "a" })],
    });

    const result = resolveRound(state, state.actions, content, DEFAULT_RULES);
    const actor = unitFromState(result.state, "a");
    const target = unitFromState(result.state, "b");

    expect(
      actor.effects.find((entry) => entry.effectId === buff.id)?.stacks,
    ).toBe(1);
    // Perdió el clash: su efecto de impacto no llega al rival.
    expect(target.effects.some((entry) => entry.effectId === mark.id)).toBe(false);
  });

  it("respeta probabilidad, tope de stacks y efectos inexistentes", () => {
    const { buff } = build();
    const never = makeSkill("skl_never", {
      selfEffects: [{ effectId: buff.id, chance: 0 }],
    });
    const capped = makeSkill("skl_capped", {
      selfEffects: [{ effectId: buff.id, stacks: 99 }],
    });
    const ghost = makeSkill("skl_ghost", {
      selfEffects: [{ effectId: "eff_missing", stacks: 1 }],
    });
    const content = makeContent({
      skills: [never, capped, ghost],
      effects: [buff],
    });
    const run = (skill: Skill) => {
      const a = makeUnit({
        id: "a",
        baseStats: { spd: 20, atk: 10, hpMax: 50 },
        hpCurrent: 50,
        skills: [skill.id, null, null],
      });
      const b = makeUnit({
        id: "b",
        team: "enemies",
        baseStats: { spd: 10, atk: 10, hpMax: 50 },
        hpCurrent: 50,
      });
      const state = makeState([a, b], {
        a: [act("a", 1, { skillId: skill.id, targetId: "b" })],
      });
      return unitFromState(
        resolveRound(state, state.actions, content, DEFAULT_RULES).state,
        "a",
      );
    };

    expect(run(never).effects.some((entry) => entry.effectId === buff.id)).toBe(
      false,
    );
    expect(
      run(capped).effects.find((entry) => entry.effectId === buff.id)?.stacks,
    ).toBe(5);
    // Un efecto borrado no rompe la ronda ni crea entradas fantasma.
    expect(run(ghost).effects).toHaveLength(0);
  });
});
