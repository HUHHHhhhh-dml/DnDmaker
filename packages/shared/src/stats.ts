import {
  DEFAULT_RULES,
  EQUIPMENT_SLOTS,
  STAT_KEYS,
  clamp,
} from "./defaults";
import type {
  CampaignContent,
  Character,
  EffectDefinition,
  EquipmentSlot,
  Item,
  Ruleset,
  Skill,
  StatKey,
  Stats,
} from "./types";

/**
 * Motor de stats derivados del estudio del DM.
 *
 * Fórmula v0.1 (diseño §7.1):
 *   stat = (base + suma de modificadores planos) × (1 + suma de % / 100)
 *   Skill Slots se limita a 1..rules.maxSkillSlots.
 *   HP máximo nunca baja de 1.
 *
 * Los `modifyStat` de los efectos pasivos equipados se aplican con sus stacks.
 * Los triggers se usarán en combate (Fase 3); para la ficha, el modificador
 * representa el estado pasivo del efecto mientras está activo.
 */

export interface StatContribution {
  stat: StatKey;
  kind: "flat" | "percent";
  amount: number;
  sourceId: string;
  sourceName: string;
  sourceKind: "item" | "effect";
}

export interface ActiveEffectSummary {
  effectId: string;
  name: string;
  stacks: number;
  maxStacks?: number;
  duration?: EffectDefinition["duration"];
  sourceId: string;
  sourceName: string;
}

export interface EquippedItem {
  slot: EquipmentSlot;
  itemId: string;
  item: Item | null;
}

export interface DerivedStats {
  base: Stats;
  stats: Stats;
  contributions: StatContribution[];
  activeEffects: ActiveEffectSummary[];
  equipment: EquippedItem[];
  skills: (Skill | null)[];
  warnings: string[];
}

export function calculateStats(
  character: Character,
  content: Pick<CampaignContent, "items" | "skills" | "effects">,
  rules: Ruleset = DEFAULT_RULES,
): DerivedStats {
  const itemById = new Map(content.items.map((item) => [item.id, item]));
  const effectById = new Map(content.effects.map((effect) => [effect.id, effect]));
  const skillById = new Map(content.skills.map((skill) => [skill.id, skill]));

  const contributions: StatContribution[] = [];
  const activeEffects: ActiveEffectSummary[] = [];
  const warnings: string[] = [];
  const equipment: EquippedItem[] = [];
  const seenEffects = new Map<
    string,
    { effect: EffectDefinition; stacks: number; sourceId: string; sourceName: string }
  >();

  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = character.equipment?.[slot] ?? null;
    if (!itemId) continue;

    const item = itemById.get(itemId) ?? null;
    equipment.push({ slot, itemId, item });

    if (!item) {
      warnings.push(`El objeto equipado en ${slot} ya no existe en la biblioteca.`);
      continue;
    }

    if (item.slot !== slot) {
      warnings.push(
        `"${item.name}" está equipado en ${slot}, pero su slot natural es ${item.slot}.`,
      );
    }

    for (const stat of STAT_KEYS) {
      const amount = item.stats?.[stat];
      if (typeof amount === "number" && amount !== 0) {
        contributions.push({
          stat,
          kind: "flat",
          amount,
          sourceId: item.id,
          sourceName: item.name,
          sourceKind: "item",
        });
      }
    }

    for (const ref of item.effects ?? []) {
      const effect = effectById.get(ref.effectId);
      if (!effect) {
        warnings.push(`"${item.name}" referencia un efecto que ya no existe.`);
        continue;
      }
      const stacks = clampStacks(ref.stacks ?? 1, effect);
      const existing = seenEffects.get(effect.id);
      if (existing) {
        existing.stacks = clampStacks(existing.stacks + stacks, effect);
      } else {
        seenEffects.set(effect.id, {
          effect,
          stacks,
          sourceId: item.id,
          sourceName: item.name,
        });
      }
    }
  }

  // Los stacks se acumulan primero y los modificadores se calculan una sola
  // vez con el total, para que dos fuentes del mismo efecto sumen bien.
  for (const { effect, stacks, sourceId, sourceName } of seenEffects.values()) {
    activeEffects.push({
      effectId: effect.id,
      name: effect.name,
      stacks,
      maxStacks: effect.maxStacks,
      duration: effect.duration,
      sourceId,
      sourceName,
    });

    for (const trigger of effect.triggers ?? []) {
      for (const action of trigger.actions) {
        if (action.type !== "modifyStat") continue;
        const amount = action.amount + (action.perStack ?? 0) * stacks;
        if (amount === 0) continue;
        contributions.push({
          stat: action.stat,
          kind: action.mode,
          amount,
          sourceId: effect.id,
          sourceName: effect.name,
          sourceKind: "effect",
        });
      }
    }
  }

  const stats = { ...character.baseStats };

  for (const stat of STAT_KEYS) {
    const relevant = contributions.filter((entry) => entry.stat === stat);
    const flat = relevant
      .filter((entry) => entry.kind === "flat")
      .reduce((total, entry) => total + entry.amount, 0);
    const percent = relevant
      .filter((entry) => entry.kind === "percent")
      .reduce((total, entry) => total + entry.amount, 0);

    const beforePercent = character.baseStats[stat] + flat;
    let value = Math.round(beforePercent * (1 + percent / 100));

    if (stat === "skillSlots") {
      const clamped = clamp(value, 1, rules.maxSkillSlots);
      if (clamped !== value) {
        warnings.push(
          `Skill Slots ajustados de ${value} a ${clamped} (límite de la campaña: 1..${rules.maxSkillSlots}).`,
        );
      }
      value = clamped;
    }

    if (stat === "hpMax" && value < 1) {
      warnings.push("El HP máximo derivado es menor que 1; se muestra 1.");
      value = 1;
    }

    stats[stat] = value;
  }

  const skills = character.skills.map((skillId) => {
    if (!skillId) return null;
    const skill = skillById.get(skillId) ?? null;
    if (!skill) warnings.push("Una de las skills equipadas ya no existe.");
    return skill;
  });

  return {
    base: { ...character.baseStats },
    stats,
    contributions,
    activeEffects,
    equipment,
    skills,
    warnings,
  };
}

function clampStacks(stacks: number, effect: EffectDefinition): number {
  const max = effect.maxStacks ?? Number.POSITIVE_INFINITY;
  return Math.max(1, Math.min(max, stacks));
}

/** Chance de cara por moneda: 0.5 + LUCK/100, con suelo y techo de la campaña. */
export function coinChance(luck: number, rules: Ruleset = DEFAULT_RULES): number {
  return clamp(0.5 + luck / 100, rules.luckFloor, rules.luckCap);
}

/** Mitigación porcentual de DEF: DEF / (DEF + defenseConstant), mínimo 0. */
export function mitigation(def: number, rules: Ruleset = DEFAULT_RULES): number {
  const safeDef = Math.max(0, def);
  if (safeDef === 0) return 0;
  return clamp(
    safeDef / (safeDef + Math.max(1, rules.defenseConstant)),
    0,
    0.999,
  );
}
