import {
  STAT_KEYS,
  clamp,
} from "../defaults";
import { calculateStats } from "../stats";
import type {
  AppliedEffect,
  Character,
  CombatUnit,
  EffectAction,
  EffectDefinition,
  EffectTrigger,
  Id,
  StatKey,
  Stats,
} from "../types";
import { computeDamage } from "./damage";
import type {
  ActionSource,
  EffectContext,
  EffectResult,
  EngineEvent,
  TriggerGroup,
} from "./types";

/**
 * Efectos y stats dinámicos del combate.
 *
 * El snapshot guarda `baseStats` (ficha base) y `stats` (derivados con equipo
 * y pasivos). El motor recalcula `stats` desde `baseStats` + equipo + efectos
 * activos cada vez que entra o sale un efecto, sin acumular deltas a mano.
 *
 * Los efectos pasivos del equipo ya están incluidos en el cálculo de
 * `calculateStats`; se marcan con `passive: true` para no aplicarlos dos veces.
 */

const TURNS_DURATION = "turns" as const;

export function buildEffectCatalog(
  content: EffectContext["content"],
): Map<Id, EffectDefinition> {
  const catalog = new Map<Id, EffectDefinition>();
  for (const effect of content.effects) catalog.set(effect.id, effect);

  // Los dominios/hábitats se representan como efectos sintéticos para poder
  // Reutilizar duración, triggers y modifyStat sin un tipo aparte en el estado.
  for (const special of content.specials) {
    if (catalog.has(special.id)) continue;
    const statActions = special.effects.filter(
      (action) => action.type === "modifyStat",
    );
    catalog.set(special.id, {
      id: special.id,
      code: special.code,
      name: special.name,
      description: special.description,
      icon: special.image,
      maxStacks: 1,
      stackMode: "refresh",
      duration: {
        type: TURNS_DURATION,
        default: Math.max(1, Math.trunc(special.duration)),
      },
      triggers:
        statActions.length > 0
          ? [{ when: "roundStart", actions: statActions }]
          : [],
      tags: ["special"],
    });
  }

  // Buffs de utilidad: si el useEffect toca stats, se representa como un
  // efecto permanente del combate con id = id del objeto. Las acciones
  // puntuales (curación, daño, aplicar efecto) se ejecutan al usarlo.
  for (const item of content.items) {
    if (catalog.has(item.id)) continue;
    const statActions = (item.useEffect ?? []).filter(
      (action) => action.type === "modifyStat",
    );
    if (statActions.length === 0) continue;
    catalog.set(item.id, {
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description,
      icon: item.image,
      maxStacks: 1,
      stackMode: "refresh",
      duration: { type: "permanent" },
      triggers: [{ when: "roundStart", actions: statActions }],
      tags: ["utility"],
    });
  }

  return catalog;
}

function durationOf(definition: EffectDefinition): number | undefined {
  return definition.duration?.type === TURNS_DURATION
    ? Math.max(1, Math.trunc(definition.duration.default))
    : undefined;
}

function maxStacksOf(definition: EffectDefinition): number {
  return Math.max(1, Math.trunc(definition.maxStacks ?? 99));
}

/** Stats efectivos: base + equipo + pasivos + modificadores de efectos activos. */
export function effectiveStats(
  unit: CombatUnit,
  context: EffectContext,
): Stats {
  // Los estados antiguos sin `baseStats` no pueden recalcularse sin arriesgar
  // reaplicar modificadores en cada refresh. Los snapshots de 3A siempre lo
  // incluyen; si falta, conservamos `stats` tal cual.
  if (!unit.baseStats) return { ...unit.stats };

  const stats: Stats = {
    ...calculateStats(characterFor(unit), context.content, context.rules).stats,
  };

  const catalog = buildEffectCatalog(context.content);
  const modifiers = new Map<StatKey, { flat: number; percent: number }>();

  for (const effect of unit.effects) {
    if (effect.passive) continue;
    const definition = catalog.get(effect.effectId);
    if (!definition) continue;
    for (const trigger of definition.triggers) {
      for (const action of trigger.actions) {
        if (action.type !== "modifyStat") continue;
        const amount =
          action.amount + (action.perStack ?? 0) * effect.stacks;
        if (amount === 0) continue;
        const entry = modifiers.get(action.stat) ?? { flat: 0, percent: 0 };
        if (action.mode === "flat") entry.flat += amount;
        else entry.percent += amount;
        modifiers.set(action.stat, entry);
      }
    }
  }

  for (const stat of STAT_KEYS) {
    const modifier = modifiers.get(stat);
    if (!modifier) continue;
    let value = Math.round(
      (stats[stat] + modifier.flat) * (1 + modifier.percent / 100),
    );
    if (stat === "skillSlots") {
      value = clamp(value, 1, context.rules.maxSkillSlots);
    }
    if (stat === "hpMax" && value < 1) value = 1;
    stats[stat] = value;
  }

  // Excepción 3F.5: la tirada de SPD del combate se suma una sola vez, después
  // de derivar equipo/efectos. Sin esto se perdería al refrescar stats en cada
  // ronda y dejaría de ordenar turnos/redirecciones. Old states: 0/undefined.
  if (unit.spdRoll) stats.spd += unit.spdRoll;

  return stats;
}

/** Devuelve una copia de la unidad con stats y HP coherentes. */
export function refreshUnitStats(
  unit: CombatUnit,
  context: EffectContext,
): CombatUnit {
  const stats = effectiveStats(unit, context);
  const hpCurrent = clamp(unit.hpCurrent, 0, stats.hpMax);
  return {
    ...unit,
    stats,
    hpCurrent,
    defeated: unit.defeated || hpCurrent <= 0,
  };
}

/**
 * Aplica (o refresca) un efecto. Los pasivos del equipo se dejan intactos y,
 * si una skill aplica el mismo efecto, se crea una entrada activa separada.
 */
export function applyEffect(
  unit: CombatUnit,
  effectId: Id,
  stacks: number,
  context: EffectContext,
  sourceId?: Id,
): EffectResult {
  const incoming = Math.max(1, Math.trunc(stacks));
  const catalog = buildEffectCatalog(context.content);
  const definition = catalog.get(effectId);
  if (!definition) return { unit, events: [], damageApplied: false };

  const effects = unit.effects.map((effect) => ({ ...effect }));
  const index = effects.findIndex(
    (effect) => effect.effectId === effectId && !effect.passive,
  );
  const maxStacks = maxStacksOf(definition);
  const mode = definition.stackMode ?? "add";
  const duration = durationOf(definition);

  if (index >= 0) {
    const existing = effects[index]!;
    let nextStacks = existing.stacks;
    if (mode === "add") nextStacks = existing.stacks + incoming;
    else if (mode === "refresh") nextStacks = Math.max(existing.stacks, incoming);
    else nextStacks = incoming;
    effects[index] = {
      ...existing,
      stacks: clamp(nextStacks, 1, maxStacks),
      remainingTurns: duration,
      sourceId: sourceId ?? existing.sourceId,
    };
  } else {
    effects.push({
      effectId,
      stacks: clamp(incoming, 1, maxStacks),
      remainingTurns: duration,
      sourceId,
    });
  }

  const finalStacks = effects[index >= 0 ? index : effects.length - 1]!.stacks;
  const event: EngineEvent = {
    type: "effectApplied",
    actorId: sourceId,
    targetId: unit.id,
    message: `${unit.name} recibe ${definition.name} (${finalStacks} stack${finalStacks === 1 ? "" : "s"}).`,
    data: {
      effectId,
      stacks: finalStacks,
      remainingTurns: duration ?? null,
      sourceId,
    },
  };

  return {
    unit: refreshUnitStats({ ...unit, effects }, context),
    events: [event],
    damageApplied: false,
  };
}

/** Consume stacks del efecto activo; si llega a 0, lo elimina. */
export function consumeStacks(
  unit: CombatUnit,
  effectId: Id,
  amount: number,
  context: EffectContext,
): EffectResult {
  const consumed = Math.max(1, Math.trunc(amount));
  const effects = unit.effects.map((effect) => ({ ...effect }));
  const index = effects.findIndex(
    (effect) => effect.effectId === effectId && !effect.passive,
  );
  if (index < 0) return { unit, events: [], damageApplied: false };

  const current = effects[index]!;
  const nextStacks = current.stacks - consumed;
  const name =
    buildEffectCatalog(context.content).get(effectId)?.name ?? effectId;

  if (nextStacks <= 0) {
    effects.splice(index, 1);
  } else {
    effects[index] = { ...current, stacks: nextStacks };
  }

  const event: EngineEvent = {
    type: "effectTick",
    targetId: unit.id,
    message:
      nextStacks <= 0
        ? `${name} se agota en ${unit.name}.`
        : `${name} pierde ${consumed} stack${consumed === 1 ? "" : "s"} en ${unit.name}.`,
    data: {
      effectId,
      consumed,
      stacks: Math.max(0, nextStacks),
      expired: nextStacks <= 0,
    },
  };

  return {
    unit: refreshUnitStats({ ...unit, effects }, context),
    events: [event],
    damageApplied: false,
  };
}

/** Aumenta stacks del efecto activo, respetando su `maxStacks`. */
export function addStacks(
  unit: CombatUnit,
  effectId: Id,
  amount: number,
  context: EffectContext,
): EffectResult {
  const requested = Math.max(1, Math.trunc(amount));
  const effects = unit.effects.map((effect) => ({ ...effect }));
  const index = effects.findIndex(
    (effect) => effect.effectId === effectId && !effect.passive,
  );
  if (index < 0) return { unit, events: [], damageApplied: false };

  const current = effects[index]!;
  const definition = buildEffectCatalog(context.content).get(effectId);
  const maxStacks = Math.max(
    1,
    Math.trunc(definition?.maxStacks ?? 99),
  );
  const nextStacks = Math.min(maxStacks, current.stacks + requested);
  if (nextStacks === current.stacks) {
    return { unit, events: [], damageApplied: false };
  }

  const gained = nextStacks - current.stacks;
  effects[index] = { ...current, stacks: nextStacks };
  const name = definition?.name ?? effectId;

  return {
    unit: refreshUnitStats({ ...unit, effects }, context),
    events: [
      {
        type: "effectTick",
        targetId: unit.id,
        message: `${name} gana ${gained} stack${gained === 1 ? "" : "s"} en ${unit.name}.`,
        data: {
          effectId,
          added: gained,
          stacks: nextStacks,
          expired: false,
        },
      },
    ],
    damageApplied: false,
  };
}

/**
 * Tick de duración al final de la ronda. Solo afecta a efectos activos con
 * `remainingTurns`; los pasivos del equipo no caducan.
 */
export function tickEffects(
  unit: CombatUnit,
  context: EffectContext,
): EffectResult {
  const effects: AppliedEffect[] = [];
  const events: EngineEvent[] = [];
  const catalog = buildEffectCatalog(context.content);

  for (const effect of unit.effects) {
    if (effect.passive || effect.remainingTurns === undefined) {
      effects.push(effect);
      continue;
    }

    const remaining = effect.remainingTurns - 1;
    if (remaining > 0) {
      effects.push({ ...effect, remainingTurns: remaining });
      continue;
    }

    const name = catalog.get(effect.effectId)?.name ?? effect.effectId;
    events.push({
      type: "effectTick",
      targetId: unit.id,
      message: `${name} termina en ${unit.name}.`,
      data: { effectId: effect.effectId, expired: true },
    });
  }

  return {
    unit: refreshUnitStats({ ...unit, effects }, context),
    events,
    damageApplied: false,
  };
}

/** Triggers de los efectos activos para un momento concreto. */
export function collectTriggers(
  unit: CombatUnit,
  when: EffectTrigger,
  content: EffectContext["content"],
): TriggerGroup[] {
  const catalog = buildEffectCatalog(content);
  const groups: TriggerGroup[] = [];
  for (const effect of unit.effects) {
    const definition = catalog.get(effect.effectId);
    if (!definition) continue;
    for (const trigger of definition.triggers) {
      if (trigger.when === when) {
        groups.push({ effect, definition, trigger });
      }
    }
  }
  return groups;
}

/**
 * Ejecuta las acciones de un trigger sobre la propia unidad y, opcionalmente,
 * sobre el rival o todas las demás unidades.
 *
 * `modifyStat` no se aplica aquí: `effectiveStats` lo calcula de forma
 * continua mientras el efecto exista. Así Protection/Haste no se acumulan una
 * vez por ronda ni hace falta revertir deltas al caducar.
 *
 * `applyEffect` admite `target: "opponent"` y `damage` admite además
 * `"allOthers"` (todas las demás unidades vivas, aliadas y enemigas). Si una
 * acción apunta a un rival que no existe, se ignora.
 */
export function executeEffectActions(
  unit: CombatUnit,
  actions: EffectAction[],
  stacks: number,
  context: EffectContext,
  source: ActionSource = {},
  targetUnit?: CombatUnit,
  allUnits?: readonly CombatUnit[],
): EffectResult {
  let current = refreshUnitStats(unit, context);
  const others = new Map<Id, CombatUnit>();
  for (const entry of allUnits ?? []) {
    if (entry.id !== unit.id) {
      others.set(entry.id, refreshUnitStats(entry, context));
    }
  }
  const opponentId =
    targetUnit && targetUnit.id !== unit.id ? targetUnit.id : undefined;
  if (opponentId && !others.has(opponentId)) {
    others.set(opponentId, refreshUnitStats(targetUnit!, context));
  }
  const changedOthers = new Set<Id>();
  const damagedIds = new Set<Id>();
  const events: EngineEvent[] = [];
  let damageApplied = false;

  const getCombatUnit = (id: Id): CombatUnit | undefined =>
    id === unit.id ? current : others.get(id);

  const setCombatUnit = (id: Id, next: CombatUnit): void => {
    if (id === unit.id) {
      current = next;
      return;
    }
    others.set(id, next);
    changedOthers.add(id);
  };

  for (const action of actions) {
    if (action.type === "modifyStat") continue;

    if (action.type === "damage") {
      const raw = (action.base ?? 0) + (action.perStack ?? 0) * stacks;
      if (raw <= 0) continue;
      const damageType = action.damageType ?? "physical";

      let damageTargets: CombatUnit[];
      if (action.target === "allOthers") {
        damageTargets = [...others.values()];
      } else if (action.target === "opponent") {
        const opponent = opponentId ? others.get(opponentId) : undefined;
        damageTargets = opponent ? [opponent] : [];
      } else {
        damageTargets = [current];
      }

      for (const target of damageTargets) {
        const latest = getCombatUnit(target.id);
        if (!latest || latest.defeated || latest.hpCurrent <= 0) continue;
        const final = computeDamage(
          raw,
          latest.stats.def,
          context.rules,
          damageType,
          { overcharged: latest.overcharged },
        );
        if (final <= 0) continue;
        const hpBefore = latest.hpCurrent;
        const hpAfter = Math.max(0, hpBefore - final);
        const wasDefeated = latest.defeated;
        setCombatUnit(latest.id, {
          ...latest,
          hpCurrent: hpAfter,
          defeated: latest.defeated || hpAfter <= 0,
        });
        damagedIds.add(latest.id);
        damageApplied = true;
        events.push({
          type: "damage",
          actorId: source.actorId ?? source.effectId,
          targetId: latest.id,
          message: `${latest.name} recibe ${final} de daño (${damageType}).`,
          data: {
            raw,
            final,
            def: latest.stats.def,
            damageType,
            hpBefore,
            hpAfter,
            overcharged: latest.overcharged === true,
            ...source,
          },
        });
        if (!wasDefeated && hpAfter <= 0) {
          events.push({
            type: "defeated",
            targetId: latest.id,
            message: `${latest.name} cae.`,
            data: { ...source },
          });
        }
      }
    } else if (action.type === "heal") {
      if (current.defeated) continue;
      const amount = (action.base ?? 0) + (action.perStack ?? 0) * stacks;
      if (amount <= 0) continue;
      const hpBefore = current.hpCurrent;
      const hpAfter = Math.min(current.stats.hpMax, hpBefore + amount);
      if (hpAfter === hpBefore) continue;
      current = { ...current, hpCurrent: hpAfter };
      events.push({
        type: "heal",
        actorId: source.actorId ?? source.effectId,
        targetId: unit.id,
        message: `${unit.name} recupera ${hpAfter - hpBefore} HP.`,
        data: { amount: hpAfter - hpBefore, hpBefore, hpAfter, ...source },
      });
    } else if (action.type === "applyEffect") {
      const applyToOpponent = action.target === "opponent";
      const destination = applyToOpponent
        ? opponentId
          ? getCombatUnit(opponentId)
          : undefined
        : current;
      // Sin rival asociado al trigger, una acción al rival no tiene destino.
      if (!destination || (applyToOpponent && destination.defeated)) continue;
      const applied = applyEffect(
        destination,
        action.effectId,
        action.stacks ?? 1,
        context,
        source.actorId ?? source.effectId,
      );
      if (applyToOpponent) setCombatUnit(destination.id, applied.unit);
      else current = applied.unit;
      events.push(...applied.events);
    } else if (action.type === "consumeStacks") {
      const effectId = source.effectId ?? source.specialId;
      if (!effectId) continue;
      const consumed = consumeStacks(current, effectId, action.amount, context);
      current = consumed.unit;
      events.push(...consumed.events);
    } else if (action.type === "addStacks") {
      const effectId = source.effectId ?? source.specialId;
      if (!effectId) continue;
      const added = addStacks(current, effectId, action.amount, context);
      current = added.unit;
      events.push(...added.events);
    }
  }

  current = refreshUnitStats(current, context);
  const targets: CombatUnit[] = [];
  for (const id of changedOthers) {
    const entry = others.get(id);
    if (!entry) continue;
    const refreshed = refreshUnitStats(entry, context);
    others.set(id, refreshed);
    targets.push(refreshed);
  }
  return {
    unit: current,
    ...(targets.length > 0 ? { targets } : {}),
    ...(damagedIds.size > 0 ? { damagedIds: [...damagedIds] } : {}),
    events,
    damageApplied,
  };
}

function characterFor(unit: CombatUnit): Character {
  return {
    id: unit.characterId,
    name: unit.name,
    kind: unit.kind,
    baseStats: unit.baseStats ?? unit.stats,
    equipment: unit.equipment,
    skills: unit.skills,
    special: unit.special,
    inventory: [],
  };
}
