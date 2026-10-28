import { describe, expect, it } from "vitest";
import type { CombatEvent, CoinRoll } from "@protocol-life/shared";
import {
  clashViewsFromEvents,
  clashViewFromEvent,
  damageTakenBy,
  damagesForClash,
} from "./clash";

/**
 * Fase 3F.5 — lectura de la cinemática de clash.
 *
 * Los eventos reales llegan con `data` sin tipo; estos tests fijan qué debe
 * hacer el cliente con ellos y que un payload raro no rompa la escena.
 */

const attackerRoll: CoinRoll = {
  coins: 3,
  heads: 2,
  faces: [true, true, false],
  probability: 0.5,
  clashPower: 17,
  rawDamage: 9,
  fullHeads: false,
};

const defenderRoll: CoinRoll = {
  coins: 2,
  heads: 1,
  faces: [false, true],
  probability: 0.5,
  clashPower: 11,
  rawDamage: 6,
  fullHeads: false,
};

function clashEvent(
  data: Record<string, unknown>,
  overrides: Partial<CombatEvent> = {},
): CombatEvent {
  return {
    id: "evt_clash",
    round: 2,
    type: "clash",
    actorId: "unit_a",
    targetId: "unit_b",
    message: "Clash de prueba.",
    data,
    ...overrides,
  };
}

function damageEvent(
  targetId: string,
  final: number,
  hpBefore: number,
  hpAfter: number,
  overrides: Partial<CombatEvent> = {},
): CombatEvent {
  return {
    id: `evt_dmg_${targetId}`,
    round: 2,
    type: "damage",
    actorId: "unit_a",
    targetId,
    message: "Daño de prueba.",
    data: { final, hpBefore, hpAfter, def: 0 },
    ...overrides,
  };
}

describe("cinemática de clash (3F.5)", () => {
  it("lee un clash de dos lados con rolls, ganador y empate", () => {
    const event = clashEvent({
      attackerId: "unit_a",
      defenderId: "unit_b",
      attackerSkillId: "skl_a",
      defenderSkillId: "skl_b",
      attackerRoll,
      defenderRoll,
      winner: "attacker",
      tie: false,
      cancelled: false,
    });

    const view = clashViewFromEvent(event, 4);
    expect(view).toMatchObject({
      eventIndex: 4,
      round: 2,
      attackerId: "unit_a",
      defenderId: "unit_b",
      attackerSkillId: "skl_a",
      defenderSkillId: "skl_b",
      winner: "attacker",
      oneSided: false,
      tie: false,
      cancelled: false,
    });
    expect(view?.attackerRoll.clashPower).toBe(17);
    expect(view?.attackerRoll.faces).toEqual([true, true, false]);
    expect(view?.defenderRoll?.clashPower).toBe(11);
  });

  it("marca ataque sin respuesta cuando falta el roll defensor", () => {
    const view = clashViewFromEvent(
      clashEvent({
        oneSided: true,
        attackerId: "unit_a",
        defenderId: "unit_b",
        attackerSkillId: "skl_a",
        attackerRoll,
        winner: "attacker",
        tie: false,
        cancelled: false,
      }),
      0,
    );

    expect(view?.oneSided).toBe(true);
    expect(view?.defenderRoll).toBeUndefined();
    expect(view?.winner).toBe("attacker");
  });

  it("sintetiza las caras si el evento no las trae y no rompe con datos raros", () => {
    const view = clashViewFromEvent(
      clashEvent({
        attackerId: "unit_a",
        defenderId: "unit_b",
        attackerRoll: {
          coins: 3,
          heads: 2,
          clashPower: 9,
        },
        winner: "defender",
        tie: false,
        cancelled: false,
      }),
      0,
    );
    expect(view?.attackerRoll.faces).toEqual([true, true, false]);
    expect(view?.attackerRoll.heads).toBe(2);

    expect(clashViewFromEvent(clashEvent({}), 0)).toBeNull();
    expect(
      clashViewFromEvent(
        { ...clashEvent({}), type: "damage" },
        0,
      ),
    ).toBeNull();
  });

  it("correlaciona el daño posterior y se detiene en el siguiente clash", () => {
    const view = clashViewFromEvent(
      clashEvent({
        attackerId: "unit_a",
        defenderId: "unit_b",
        attackerSkillId: "skl_a",
        defenderSkillId: "skl_b",
        attackerRoll,
        defenderRoll,
        winner: "attacker",
        tie: false,
        cancelled: false,
      }),
      1,
    )!;

    const events: CombatEvent[] = [
      clashEvent({}, { id: "evt_previo" }),
      clashEvent(
        {
          attackerId: "unit_a",
          defenderId: "unit_b",
          attackerSkillId: "skl_a",
          defenderSkillId: "skl_b",
          attackerRoll,
          defenderRoll,
          winner: "attacker",
        },
        { id: "evt_clash" },
      ),
      {
        ...damageEvent("unit_b", 9, 40, 31),
        data: { final: 9, hpBefore: 40, hpAfter: 31, skillId: "skl_a" },
      },
      damageEvent("unit_x", 99, 40, 1),
      // Daño de un trigger/efecto colado: no pertenece a este clash.
      {
        ...damageEvent("unit_b", 99, 31, 1),
        data: { final: 99, hpBefore: 31, hpAfter: 1, skillId: "skl_efe" },
      },
      {
        ...damageEvent("unit_a", 2, 40, 38),
        data: { final: 2, hpBefore: 40, hpAfter: 38, skillId: "skl_b" },
      },
      clashEvent({}, { id: "evt_siguiente" }),
      damageEvent("unit_b", 50, 31, 0),
    ];

    const damages = damagesForClash(events, view);
    expect(damages).toEqual([
      { targetId: "unit_b", final: 9, hpBefore: 40, hpAfter: 31 },
      { targetId: "unit_a", final: 2, hpBefore: 40, hpAfter: 38 },
    ]);
    expect(damageTakenBy(damages, "unit_b")).toBe(9);
    expect(damageTakenBy(damages, "unit_a")).toBe(2);
  });

  it("solo encola los clash nuevos a partir del cursor", () => {
    const events = [
      clashEvent({}, { id: "evt_1", data: { attackerId: "a", defenderId: "b", attackerRoll } }),
      damageEvent("b", 1, 10, 9),
      clashEvent({}, { id: "evt_2", data: { attackerId: "c", defenderId: "d", attackerRoll } }),
    ];

    expect(clashViewsFromEvents(events, 0).map((view) => view.id)).toEqual([
      "evt_1",
      "evt_2",
    ]);
    expect(clashViewsFromEvents(events, 2).map((view) => view.id)).toEqual([
      "evt_2",
    ]);
  });
});
