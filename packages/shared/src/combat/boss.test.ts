import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, DEFAULT_STATS, emptyContent } from "../defaults";
import type {
  BossPhase,
  CampaignContent,
  CharacterKind,
  CombatState,
  CombatUnit,
  DeclaredAction,
  Id,
  Skill,
  Team,
} from "../types";
import {
  BOSS_PHASE_FINAL,
  applyBossPhase,
  bossPhaseToActivate,
  resolveRound,
} from "./index";

/**
 * Cambio de fase de jefes: umbral por % de vida máxima, unidireccional y
 * evaluado al final de la ronda, después del daño/efectos y antes de avanzar
 * `round`.
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
  kind?: CharacterKind;
  hpMax?: number;
  hpCurrent?: number;
  atk?: number;
  skills?: (Id | null)[];
  battleSprite?: string;
  bossPhase?: BossPhase;
  bossPhaseActive?: boolean;
}): CombatUnit {
  const hpMax = params.hpMax ?? 100;
  const hpCurrent = params.hpCurrent ?? hpMax;
  const stats = {
    ...DEFAULT_STATS,
    hpMax,
    atk: params.atk ?? 0,
  };
  return {
    id: params.id,
    characterId: params.id,
    team: params.team ?? "players",
    kind: params.kind ?? "player",
    name: params.name ?? params.id,
    battleSprite: params.battleSprite,
    stats,
    baseStats: stats,
    hpCurrent,
    equipment: { ...EMPTY_EQUIPMENT },
    skills: params.skills ?? [null, null, null],
    bossPhase: params.bossPhase,
    bossPhaseActive: params.bossPhaseActive,
    effects: [],
    utilityUses: 0,
    defeated: hpCurrent <= 0,
  };
}

function makeSkill(id: string, partial: Partial<Skill> = {}): Skill {
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

function makeState(
  units: CombatUnit[],
  actions: Record<Id, DeclaredAction[]> = {},
  round = 1,
): CombatState {
  const actionMap: CombatState["actions"] = {};
  const cooldowns: CombatState["specialCooldowns"] = {};
  for (const unit of units) {
    actionMap[unit.id] = actions[unit.id] ?? [];
    cooldowns[unit.id] = {};
  }
  return {
    id: "cmb_boss",
    encounterId: "enc_boss",
    round,
    phase: "declaring",
    seed: "seed-boss",
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

describe("jefe — umbral de fase", () => {
  const phase: BossPhase = { thresholdPct: 50 };

  it("se activa justo en el umbral y no por encima", () => {
    const atThreshold = makeUnit({
      id: "boss",
      kind: "boss",
      hpMax: 100,
      hpCurrent: 50,
      bossPhase: phase,
    });
    expect(bossPhaseToActivate(atThreshold)).toEqual(phase);

    const above = makeUnit({
      id: "boss",
      kind: "boss",
      hpMax: 100,
      hpCurrent: 51,
      bossPhase: phase,
    });
    expect(bossPhaseToActivate(above)).toBeNull();
  });

  it("no activa sin fase, sin ser jefe, ya activa ni con el jefe muerto", () => {
    expect(
      bossPhaseToActivate(
        makeUnit({ id: "sin-fase", kind: "boss", hpCurrent: 10 }),
      ),
    ).toBeNull();
    expect(
      bossPhaseToActivate(
        makeUnit({
          id: "enemigo",
          kind: "enemy",
          hpCurrent: 10,
          bossPhase: phase,
        }),
      ),
    ).toBeNull();
    expect(
      bossPhaseToActivate(
        makeUnit({
          id: "activo",
          kind: "boss",
          hpCurrent: 10,
          bossPhase: phase,
          bossPhaseActive: true,
        }),
      ),
    ).toBeNull();
    expect(
      bossPhaseToActivate(
        makeUnit({
          id: "muerto",
          kind: "boss",
          hpMax: 100,
          hpCurrent: 0,
          bossPhase: phase,
        }),
      ),
    ).toBeNull();
  });

  it("no divide si hpMax es 0", () => {
    const unit = makeUnit({
      id: "boss",
      kind: "boss",
      hpMax: 0,
      hpCurrent: 0,
      bossPhase: phase,
    });
    expect(bossPhaseToActivate(unit)).toBeNull();
  });

  it("aplica solo los overrides presentes y conserva el resto", () => {
    const unit = makeUnit({
      id: "boss",
      name: "Arzu",
      kind: "boss",
      hpMax: 100,
      hpCurrent: 10,
      skills: ["skl_a", null, null],
      bossPhase: {
        thresholdPct: 30,
        label: "Fase 2: desatado",
        battleSprite: "/uploads/arzu-fase2.png",
      },
    });
    const transformed = applyBossPhase(unit, unit.bossPhase!);
    expect(transformed.bossPhaseActive).toBe(true);
    expect(transformed.name).toBe("Arzu");
    expect(transformed.battleSprite).toBe("/uploads/arzu-fase2.png");
    expect(transformed.skills).toEqual(["skl_a", null, null]);
    expect(transformed.skills).not.toBe(unit.skills);
  });
});

describe("jefe — resolución de ronda", () => {
  const baseSkill = makeSkill("skl_base");
  const strikeSkill = makeSkill("skl_strike", { baseClash: 9999 });
  const phaseSkill = makeSkill("skl_fase2", { baseDamage: 99 });

  function content(): CampaignContent {
    const campaign = emptyContent();
    campaign.skills.push(baseSkill, strikeSkill, phaseSkill);
    return campaign;
  }

  it("activa la fase 2 al final de la ronda, después del clash con fase 1", () => {
    const boss = makeUnit({
      id: "boss",
      kind: "boss",
      team: "enemies",
      name: "Arzu",
      hpMax: 100,
      hpCurrent: 100,
      atk: 0,
      skills: [baseSkill.id, null, null],
      bossPhase: {
        thresholdPct: 99,
        label: "Fase 2: desatado",
        name: "Arzu desatado",
        battleSprite: "/uploads/fase2.png",
        visualMode: "portrait",
        skills: [phaseSkill.id, null, null],
      },
    });
    const player = makeUnit({
      id: "player",
      name: "Ana",
      hpMax: 100,
      hpCurrent: 100,
      skills: [strikeSkill.id, null, null],
    });
    const state = makeState(
      [player, boss],
      {
        player: [
          act("player", 1, { skillId: strikeSkill.id, targetId: boss.id }),
        ],
        boss: [act("boss", 1, { skillId: baseSkill.id, targetId: player.id })],
      },
      3,
    );

    const result = resolveRound(
      state,
      state.actions,
      content(),
      DEFAULT_RULES,
    );
    const after = unitFromState(result.state, "boss");

    expect(after.bossPhaseActive).toBe(true);
    expect(after.name).toBe("Arzu desatado");
    expect(after.battleSprite).toBe("/uploads/fase2.png");
    expect(after.skills).toEqual([phaseSkill.id, null, null]);
    expect(result.state.round).toBe(4);

    // Las acciones declaradas esa ronda se resolvieron con la fase 1.
    const clash = result.events.find((event) => event.type === "clash");
    expect(clash?.data?.attackerSkillId).toBe(strikeSkill.id);
    expect(clash?.data?.defenderSkillId).toBe(baseSkill.id);

    const phaseEvent = result.events.find(
      (event) => event.type === "bossPhase",
    );
    expect(phaseEvent).toMatchObject({
      actorId: boss.id,
      round: 3,
    });
    expect(phaseEvent?.data).toMatchObject({
      unitId: boss.id,
      phase: BOSS_PHASE_FINAL,
      thresholdPct: 99,
      label: "Fase 2: desatado",
      name: "Arzu desatado",
    });
    expect(result.state.log.some((event) => event.type === "bossPhase")).toBe(
      true,
    );
  });

  it("no activa la fase si el jefe muere en esa misma ronda", () => {
    const lethal = makeSkill("skl_letal", { baseDamage: 999, coins: 1 });
    const boss = makeUnit({
      id: "boss",
      kind: "boss",
      team: "enemies",
      hpMax: 100,
      hpCurrent: 1,
      skills: [baseSkill.id, null, null],
      bossPhase: {
        thresholdPct: 50,
        skills: [phaseSkill.id, null, null],
      },
    });
    const player = makeUnit({
      id: "player",
      hpMax: 100,
      hpCurrent: 100,
      skills: [lethal.id, null, null],
    });
    const state = makeState(
      [player, boss],
      {
        player: [act("player", 1, { skillId: lethal.id, targetId: boss.id })],
      },
      1,
    );

    const campaign = emptyContent();
    campaign.skills.push(baseSkill, phaseSkill, lethal);

    const result = resolveRound(state, state.actions, campaign, DEFAULT_RULES);
    const after = unitFromState(result.state, "boss");

    expect(after.defeated).toBe(true);
    expect(after.hpCurrent).toBe(0);
    expect(after.bossPhaseActive).not.toBe(true);
    expect(after.skills).toEqual([baseSkill.id, null, null]);
    expect(result.events.some((event) => event.type === "bossPhase")).toBe(
      false,
    );
  });

  it("es unidireccional: curarse por encima del umbral no revierte la fase", () => {
    const boss = makeUnit({
      id: "boss",
      kind: "boss",
      team: "enemies",
      name: "Arzu desatado",
      battleSprite: "/uploads/fase2.png",
      hpMax: 100,
      hpCurrent: 100,
      skills: [phaseSkill.id, null, null],
      bossPhase: { thresholdPct: 50, skills: [phaseSkill.id, null, null] },
      bossPhaseActive: true,
    });
    const player = makeUnit({ id: "player", hpMax: 100, hpCurrent: 100 });
    const state = makeState([player, boss], {}, 2);

    const result = resolveRound(
      state,
      state.actions,
      content(),
      DEFAULT_RULES,
    );
    const after = unitFromState(result.state, "boss");

    expect(after.bossPhaseActive).toBe(true);
    expect(after.battleSprite).toBe("/uploads/fase2.png");
    expect(after.skills).toEqual([phaseSkill.id, null, null]);
    expect(result.events.some((event) => event.type === "bossPhase")).toBe(
      false,
    );
  });
});
