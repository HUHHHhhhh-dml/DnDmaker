import type {
  CampaignContent,
  CombatEvent,
  CombatState,
  CombatUnit,
  DeclaredAction,
  EffectTrigger,
  Id,
  Ruleset,
  Skill,
} from "../types";
import { resolveClash } from "./clash";
import { rollCoins } from "./coins";
import { computeDamage } from "./damage";
import {
  applyBossPhase,
  bossPhaseEvent,
  bossPhaseToActivate,
} from "./boss";
import {
  applyEffect,
  collectTriggers,
  executeEffectActions,
  refreshUnitStats,
  tickEffects,
} from "./effects";
import { createRoundRng } from "./rng";
import {
  canUseSpecial,
  markSpecialUsed,
  specialTargets,
  tickSpecialCooldowns,
} from "./specials";
import type {
  ActionSource,
  EffectContext,
  EngineEvent,
  RoundResult,
} from "./types";

/**
 * Motor de una ronda completa (Fase 3B).
 *
 * Es puro respecto a I/O: clona el estado de entrada, no toca la base de
 * datos ni React, y usa el RNG inyectado. La fase de la mesa y la persistencia
 * las orquesta 3C.
 *
 * Orden:
 *   1. roundStart por SPD.
 *   2. Acciones por SPD descendente; empate: jugadores, luego id.
 *   3. Clash al apuntarse mutuamente, sin importar slot.
 *   4. Redirección válida antes del clash normal.
 *   5. roundEnd, tick de duraciones y cooldowns.
 *   6. Cambio de fase de jefes que bajaron de su umbral (fase 2).
 *   7. La ronda avanza y el estado queda listo para declarar de nuevo.
 *
 * Importante para 3C: la ronda avanza (`round + 1`), la fase vuelve a
 * `declaring` y las acciones se limpian. Si `state.winner` queda definido (o
 * `winnerOf(state)`), 3C debe cerrar el combate con `endEncounter`; el motor no
 * fija `phase: "ended"` ni persiste HP.
 *
 * La ronda 1 ya trae su evento `roundStart` desde `startEncounter` (3A); este
 * motor solo lo emite para rondas posteriores. Las declaraciones inválidas
 * (skill/objeto inexistente, target muerto, etc.) las rechaza 3C; aquí se
 * ignoran de forma defensiva.
 */

interface PendingAction {
  unitId: Id;
  action: DeclaredAction;
  index: number;
  resolved: boolean;
}

const MAX_TRIGGER_DEPTH = 8;

const alive = (unit: CombatUnit): boolean =>
  !unit.defeated && unit.hpCurrent > 0;

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function resolveRound(
  state: CombatState,
  actions: Record<Id, DeclaredAction[]>,
  content: CampaignContent,
  rules: Ruleset,
): RoundResult {
  const draft: CombatState = structuredClone(state);
  const context: EffectContext = { content, rules };
  const rng = createRoundRng(draft.seed, draft.round);
  const units = new Map(draft.units.map((unit) => [unit.id, unit]));
  const events: CombatEvent[] = [];
  const defeatedAnnounced = new Set<Id>();
  const onDefeatRan = new Set<Id>();
  const pending = new Map<Id, PendingAction[]>();

  for (const unit of draft.units) {
    const list = (actions[unit.id] ?? []).map((action, index) => ({
      unitId: unit.id,
      action,
      index,
      resolved: false,
    }));
    list.sort(
      (a, b) => a.action.slot - b.action.slot || a.index - b.index,
    );
    pending.set(unit.id, list);
  }

  const current = (unitId: Id): CombatUnit | undefined => units.get(unitId);

  const setUnit = (unit: CombatUnit): void => {
    units.set(unit.id, unit);
    const index = draft.units.findIndex((entry) => entry.id === unit.id);
    if (index >= 0) draft.units[index] = unit;
  };

  const emit = (event: EngineEvent): CombatEvent => {
    const combatEvent: CombatEvent = {
      id: `${draft.id}:evt:${draft.log.length + 1}`,
      round: draft.round,
      ...event,
    };
    draft.log.push(combatEvent);
    events.push(combatEvent);
    return combatEvent;
  };

  const markAllResolved = (unitId: Id): void => {
    for (const entry of pending.get(unitId) ?? []) entry.resolved = true;
  };

  const markDefeated = (unitId: Id, depth = 0): void => {
    const unit = current(unitId);
    if (!unit || unit.hpCurrent > 0) return;

    if (!defeatedAnnounced.has(unitId)) {
      setUnit({ ...unit, hpCurrent: 0, defeated: true });
      emit({
        type: "defeated",
        targetId: unitId,
        message: `${unit.name} cae y no puede actuar.`,
        data: { unitId },
      });
      defeatedAnnounced.add(unitId);
    }

    if (!onDefeatRan.has(unitId)) {
      onDefeatRan.add(unitId);
      runTriggers(unitId, "onDefeat", depth + 1);
    }
    markAllResolved(unitId);
  };

  const runTriggers = (
    unitId: Id,
    when: EffectTrigger,
    depth = 0,
  ): void => {
    if (depth > MAX_TRIGGER_DEPTH) return;
    const unit = current(unitId);
    if (!unit) return;

    for (const group of collectTriggers(unit, when, content)) {
      const latest = current(unitId);
      if (!latest) break;
      const result = executeEffectActions(
        latest,
        group.trigger.actions,
        group.effect.stacks,
        context,
        {
          effectId: group.effect.effectId,
          actorId: group.effect.sourceId ?? unitId,
        },
      );
      setUnit(result.unit);
      for (const event of result.events) emit(event);
      if (result.events.some((event) => event.type === "defeated")) {
        defeatedAnnounced.add(unitId);
      }
      if (result.damageApplied) runTriggers(unitId, "onTakeDamage", depth + 1);
      const after = current(unitId);
      if (after && after.hpCurrent <= 0) markDefeated(unitId, depth + 1);
    }
  };

  const applyDamage = (
    targetId: Id,
    final: number,
    source: ActionSource,
  ): void => {
    const target = current(targetId);
    if (!target || target.defeated) return;
    const hpBefore = target.hpCurrent;
    const hpAfter = Math.max(0, hpBefore - final);
    setUnit({
      ...target,
      hpCurrent: hpAfter,
      defeated: target.defeated || hpAfter <= 0,
    });
    emit({
      type: "damage",
      actorId: source.actorId,
      targetId,
      message: `${target.name} recibe ${final} de daño.`,
      data: {
        final,
        hpBefore,
        hpAfter,
        def: target.stats.def,
        overcharged: target.overcharged === true,
        ...source,
      },
    });
    runTriggers(targetId, "onTakeDamage", 0);
    if (hpAfter <= 0) markDefeated(targetId);
  };

  const applySkillEffects = (
    actorId: Id,
    targetId: Id,
    skill: Skill,
  ): void => {
    const target = current(targetId);
    if (!target || target.defeated) return;
    for (const ref of skill.effects ?? []) {
      const latest = current(targetId);
      if (!latest || latest.defeated) break;
      const chance = ref.chance ?? 1;
      if (chance <= 0) continue;
      if (chance < 1 && rng.next() >= chance) continue;
      const result = applyEffect(
        latest,
        ref.effectId,
        ref.stacks ?? 1,
        context,
        actorId,
      );
      setUnit(result.unit);
      for (const event of result.events) emit(event);
      const after = current(targetId);
      if (after && after.hpCurrent <= 0) markDefeated(targetId);
    }
  };

  const skillOf = (skillId: Id | undefined): Skill | undefined =>
    skillId ? content.skills.find((skill) => skill.id === skillId) : undefined;

  const resolveClashBetween = (
    attacker: CombatUnit,
    defender: CombatUnit,
    attackerSkill: Skill,
    defenderSkill: Skill,
    attackerAction: DeclaredAction,
    defenderAction: DeclaredAction,
  ): void => {
    const result = resolveClash(
      {
        unit: attacker,
        skill: attackerSkill,
        action: attackerAction,
      },
      {
        unit: defender,
        skill: defenderSkill,
        action: defenderAction,
      },
      rules,
      rng,
    );

    const winnerName =
      result.winner === "attacker" ? attacker.name : defender.name;
    const winnerSkill =
      result.winner === "attacker" ? attackerSkill : defenderSkill;
    emit({
      type: "clash",
      actorId: attacker.id,
      targetId: defender.id,
      message: result.tie
        ? result.cancelled
          ? `${attacker.name} (${attackerSkill.name}) y ${defender.name} (${defenderSkill.name}) empatan el clash.`
          : result.winner === "defender"
            ? `El clash se resuelve a favor de ${defender.name} (${defenderSkill.name}) por regla de empate.`
            : `El clash entre ${attacker.name} y ${defender.name} termina en tablas con daño mutuo.`
        : `${winnerName} (${winnerSkill.name}) gana el clash contra ${result.winner === "attacker" ? defender.name : attacker.name}.`,
      data: {
        attackerId: attacker.id,
        defenderId: defender.id,
        attackerSkillId: attackerSkill.id,
        defenderSkillId: defenderSkill.id,
        attackerSlot: attackerAction.slot,
        defenderSlot: defenderAction.slot,
        attackerRoll: result.attackerRoll,
        defenderRoll: result.defenderRoll,
        winner: result.winner,
        tie: result.tie,
        cancelled: result.cancelled,
      },
    });

    if (result.cancelled) return;

    if (result.damageToDefender > 0) {
      applyDamage(defender.id, result.damageToDefender, {
        actorId: attacker.id,
        skillId: attackerSkill.id,
      });
    }
    if (result.damageToAttacker > 0) {
      applyDamage(attacker.id, result.damageToAttacker, {
        actorId: defender.id,
        skillId: defenderSkill.id,
      });
    }

    if (result.winner === "attacker") {
      applySkillEffects(attacker.id, defender.id, attackerSkill);
    } else if (result.winner === "defender") {
      applySkillEffects(defender.id, attacker.id, defenderSkill);
    }

    const attackerNow = current(attacker.id);
    const defenderNow = current(defender.id);
    if (result.winner === "attacker") {
      if (attackerNow) runTriggers(attacker.id, "onClashWin", 0);
      if (defenderNow) runTriggers(defender.id, "onClashLose", 0);
    } else if (result.winner === "defender") {
      if (defenderNow) runTriggers(defender.id, "onClashWin", 0);
      if (attackerNow) runTriggers(attacker.id, "onClashLose", 0);
    }
  };

  const findFirstUnresolvedTargeting = (
    targetId: Id,
    attackerId: Id,
  ): PendingAction | undefined => {
    return (pending.get(targetId) ?? []).find(
      (entry) =>
        !entry.resolved &&
        entry.action.redirectFor === undefined &&
        entry.action.skillId !== undefined &&
        entry.action.targetId === attackerId,
    );
  };

  const findRedirect = (
    attacker: CombatUnit,
    target: CombatUnit,
  ): { entry: PendingAction; unit: CombatUnit; skill: Skill } | undefined => {
    let best:
      | { entry: PendingAction; unit: CombatUnit; skill: Skill }
      | undefined;

    for (const ally of draft.units) {
      if (ally.team !== target.team || ally.id === target.id) continue;
      if (!alive(ally)) continue;
      if (ally.stats.spd <= attacker.stats.spd) continue;

      const entry = (pending.get(ally.id) ?? []).find(
        (candidate) =>
          !candidate.resolved &&
          candidate.action.skillId !== undefined &&
          candidate.action.redirectFor === target.id &&
          candidate.action.targetId === attacker.id,
      );
      if (!entry) continue;
      const skill = skillOf(entry.action.skillId);
      if (!skill) continue;

      if (
        !best ||
        ally.stats.spd > best.unit.stats.spd ||
        (ally.stats.spd === best.unit.stats.spd && ally.id < best.unit.id)
      ) {
        best = { entry, unit: ally, skill };
      }
    }

    return best;
  };

  const resolveSpecial = (
    caster: CombatUnit,
    action: DeclaredAction,
  ): void => {
    const specialId =
      action.special === "domain"
        ? caster.special?.domainId
        : caster.special?.habitatId;
    if (!specialId) return;
    const special = content.specials.find((entry) => entry.id === specialId);
    if (!special) return;

    if (!canUseSpecial(draft, caster.id, special)) {
      emit({
        type: "cooldown",
        actorId: caster.id,
        message: `${special.name} todavía no está disponible para ${caster.name}.`,
        data: { specialId, used: true },
      });
      return;
    }

    markSpecialUsed(draft, caster.id, special);
    const targets = specialTargets(draft, caster, special);
    const nonStatActions = special.effects.filter(
      (entry) => entry.type !== "modifyStat",
    );

    for (const target of targets) {
      const applied = applyEffect(
        target,
        special.id,
        1,
        context,
        caster.id,
      );
      setUnit(applied.unit);
      for (const event of applied.events) emit(event);
      const afterApply = current(target.id);
      if (afterApply && afterApply.hpCurrent <= 0) markDefeated(target.id);

      if (nonStatActions.length > 0) {
        const latest = current(target.id);
        if (!latest) continue;
        const result = executeEffectActions(
          latest,
          nonStatActions,
          1,
          context,
          { specialId: special.id, actorId: caster.id },
        );
        setUnit(result.unit);
        for (const event of result.events) emit(event);
        if (result.events.some((event) => event.type === "defeated")) {
          defeatedAnnounced.add(target.id);
        }
        if (result.damageApplied) {
          runTriggers(target.id, "onTakeDamage", 0);
        }
        const after = current(target.id);
        if (after && after.hpCurrent <= 0) markDefeated(target.id);
      }
    }

    emit({
      type: "special",
      actorId: caster.id,
      message: `${caster.name} activa ${special.name}.`,
      data: {
        specialId: special.id,
        target: special.target,
        duration: special.duration,
        targetIds: targets.map((target) => target.id),
      },
    });
  };

  const resolveUtility = (
    caster: CombatUnit,
    action: DeclaredAction,
  ): void => {
    const item = action.utilityId
      ? content.items.find((entry) => entry.id === action.utilityId)
      : undefined;
    if (!item) return;

    const casterNow = current(caster.id);
    if (!casterNow || casterNow.utilityUses <= 0) {
      emit({
        type: "cooldown",
        actorId: caster.id,
        message: `${caster.name} no tiene usos de ${item.name}.`,
        data: { itemId: item.id, utilityUses: 0 },
      });
      return;
    }

    setUnit({
      ...casterNow,
      utilityUses: Math.max(0, casterNow.utilityUses - 1),
    });

    const requested = action.targetId
      ? current(action.targetId)
      : current(caster.id);
    const target =
      requested && alive(requested) ? requested : current(caster.id);
    if (!target || !alive(target)) return;

    const useEffect = item.useEffect ?? [];
    const statActions = useEffect.filter(
      (entry) => entry.type === "modifyStat",
    );
    const instantActions = useEffect.filter(
      (entry) => entry.type !== "modifyStat",
    );

    // Un buff de utilidad se representa como efecto permanente del combate;
    // así `effectiveStats` lo aplica y no hay que revertir deltas a mano.
    if (statActions.length > 0) {
      const applied = applyEffect(target, item.id, 1, context, caster.id);
      setUnit(applied.unit);
      for (const event of applied.events) emit(event);
      const afterBuff = current(target.id);
      if (afterBuff && afterBuff.hpCurrent <= 0) markDefeated(target.id);
    }

    if (instantActions.length > 0) {
      const latestTarget = current(target.id);
      if (!latestTarget) return;
      const result = executeEffectActions(
        latestTarget,
        instantActions,
        1,
        context,
        { itemId: item.id, actorId: caster.id },
      );
      setUnit(result.unit);
      for (const event of result.events) emit(event);
      if (result.events.some((event) => event.type === "defeated")) {
        defeatedAnnounced.add(target.id);
      }
      if (result.damageApplied) {
        runTriggers(target.id, "onTakeDamage", 0);
      }
      const after = current(target.id);
      if (after && after.hpCurrent <= 0) markDefeated(target.id);
    }
  };

  const resolveOneSided = (
    attacker: CombatUnit,
    skill: Skill,
    target: CombatUnit,
    action: DeclaredAction,
  ): void => {
    if (!alive(target)) return;
    const roll = rollCoins(skill, attacker.stats, rng, rules);
    const final = computeDamage(
      roll.rawDamage,
      target.stats.def,
      rules,
      "physical",
      { overcharged: target.overcharged },
    );
    emit({
      type: "clash",
      actorId: attacker.id,
      targetId: target.id,
      message: `${attacker.name} ataca sin respuesta con ${skill.name}.`,
      data: {
        oneSided: true,
        attackerId: attacker.id,
        defenderId: target.id,
        attackerSkillId: skill.id,
        attackerSlot: action.slot,
        attackerRoll: roll,
        winner: "attacker",
        tie: false,
        cancelled: false,
      },
    });
    applyDamage(target.id, final, {
      actorId: attacker.id,
      skillId: skill.id,
    });
    applySkillEffects(attacker.id, target.id, skill);
  };

  const resolveSkill = (
    attacker: CombatUnit,
    action: DeclaredAction,
  ): void => {
    const skill = skillOf(action.skillId);
    const target = action.targetId
      ? current(action.targetId)
      : undefined;
    if (!skill || !target || !alive(target)) return;

    runTriggers(attacker.id, "onUseSkill", 0);
    const attackerNow = current(attacker.id);
    if (!attackerNow || !alive(attackerNow)) {
      markAllResolved(attacker.id);
      return;
    }

    // Redirección: una por ataque, la del aliado más rápido con SPD mayor.
    const redirect = findRedirect(attackerNow, target);
    if (redirect) {
      redirect.entry.resolved = true;
      emit({
        type: "redirect",
        actorId: redirect.unit.id,
        targetId: attacker.id,
        message: `${redirect.unit.name} intercepta el ataque contra ${target.name}.`,
        data: {
          redirectorId: redirect.unit.id,
          attackerId: attacker.id,
          protectedId: target.id,
          spd: redirect.unit.stats.spd,
        },
      });

      runTriggers(redirect.unit.id, "onUseSkill", 0);
      const redirectorNow = current(redirect.unit.id);
      if (redirectorNow && alive(redirectorNow)) {
        resolveClashBetween(
          attackerNow,
          redirectorNow,
          skill,
          redirect.skill,
          action,
          redirect.entry.action,
        );
        return;
      }
    }

    const defenderEntry = findFirstUnresolvedTargeting(
      target.id,
      attacker.id,
    );
    if (defenderEntry) {
      defenderEntry.resolved = true;
      runTriggers(target.id, "onUseSkill", 0);
      const defenderNow = current(target.id);
      // Si el propio Bleed/trigger la mata antes del clash, el ataque se
      // pierde: no hay un objetivo vivo al que golpear.
      if (defenderNow && !alive(defenderNow)) return;
      const defenderSkill = skillOf(defenderEntry.action.skillId);
      if (defenderNow && alive(defenderNow) && defenderSkill) {
        resolveClashBetween(
          attackerNow,
          defenderNow,
          skill,
          defenderSkill,
          action,
          defenderEntry.action,
        );
        return;
      }
    }

    resolveOneSided(attackerNow, skill, target, action);
  };

  /* ---------------------------------------------------------------------- */
  /* 1. Inicio de ronda                                                     */
  /* ---------------------------------------------------------------------- */

  for (const unit of draft.units) {
    setUnit(refreshUnitStats(unit, context));
  }
  if (draft.round > 1) {
    emit({
      type: "roundStart",
      message: `Comienza la ronda ${draft.round}.`,
      data: { round: draft.round },
    });
  }

  const startOrder = draft.units
    .filter((unit) => alive(unit))
    .sort(
      (a, b) =>
        b.stats.spd - a.stats.spd ||
        (a.team === b.team ? 0 : a.team === "players" ? -1 : 1) ||
        byId(a, b),
    );
  for (const unit of startOrder) {
    runTriggers(unit.id, "roundStart", 0);
  }

  /* ---------------------------------------------------------------------- */
  /* 2–4. Acciones                                                          */
  /* ---------------------------------------------------------------------- */

  const order = [...units.values()]
    .filter((unit) => alive(unit))
    .sort(
      (a, b) =>
        b.stats.spd - a.stats.spd ||
        (a.team === b.team ? 0 : a.team === "players" ? -1 : 1) ||
        byId(a, b),
    );

  for (const unit of order) {
    const actor = current(unit.id);
    if (!actor || !alive(actor)) {
      markAllResolved(unit.id);
      continue;
    }

    for (const entry of pending.get(unit.id) ?? []) {
      const latest = current(unit.id);
      if (!latest || !alive(latest)) {
        markAllResolved(unit.id);
        break;
      }
      if (entry.resolved) continue;

      // Las acciones de redirección se quedan a la espera: no atacan por su
      // cuenta. Solo se consumen si `findRedirect` las usa para interceptar.
      if (entry.action.redirectFor) continue;

      entry.resolved = true;
      if (entry.action.special) {
        resolveSpecial(latest, entry.action);
      } else if (entry.action.utilityId) {
        resolveUtility(latest, entry.action);
      } else if (entry.action.skillId) {
        resolveSkill(latest, entry.action);
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 5. Fin de ronda                                                        */
  /* ---------------------------------------------------------------------- */

  const endOrder = [...units.values()]
    .filter((unit) => alive(unit))
    .sort(
      (a, b) =>
        b.stats.spd - a.stats.spd ||
        (a.team === b.team ? 0 : a.team === "players" ? -1 : 1) ||
        byId(a, b),
    );
  for (const unit of endOrder) {
    runTriggers(unit.id, "roundEnd", 0);
  }

  emit({
    type: "roundEnd",
    message: `Termina la ronda ${draft.round}.`,
    data: { round: draft.round },
  });

  for (const unit of [...units.values()]) {
    const result = tickEffects(unit, context);
    setUnit(result.unit);
    for (const event of result.events) emit(event);
  }

  for (const event of tickSpecialCooldowns(draft, content.specials)) {
    emit(event);
  }

  /* ---------------------------------------------------------------------- */
  /* 5b. Cambio de fase de jefes                                            */
  /* ---------------------------------------------------------------------- */

  // Se evalúa al final de la ronda, después de daño/efectos y antes de
  // avanzar `round`: las acciones declaradas esta ronda usaron la fase 1 y
  // los nuevos overrides están listos para declarar en la siguiente. Un jefe
  // que muere en esta ronda (hpCurrent 0) no entra en fase 2.
  for (const unit of [...units.values()]) {
    const phase = bossPhaseToActivate(unit);
    if (!phase) continue;
    const transformed = applyBossPhase(unit, phase);
    setUnit(transformed);
    emit(bossPhaseEvent(unit, transformed, phase));
  }

  /* ---------------------------------------------------------------------- */
  /* 6. Estado listo para la siguiente declaración                          */
  /* ---------------------------------------------------------------------- */

  draft.units = draft.units.map((unit) => units.get(unit.id) ?? unit);
  draft.actions = {};
  for (const unit of draft.units) draft.actions[unit.id] = [];
  draft.round += 1;
  draft.phase = "declaring";

  // Señal para 3C: el ganador se calcula, pero cerrar/persistir es su trabajo.
  const winner = winnerOf(draft);
  if (winner) draft.winner = winner;
  else delete draft.winner;

  return { state: draft, events };
}

/** Utilidad pura para 3C: detecta bando con unidades activas. */
export function winnerOf(state: CombatState): "players" | "enemies" | undefined {
  const players = state.units.some(
    (unit) => unit.team === "players" && alive(unit),
  );
  const enemies = state.units.some(
    (unit) => unit.team === "enemies" && alive(unit),
  );
  if (players && !enemies) return "players";
  if (!players && enemies) return "enemies";
  return undefined;
}


