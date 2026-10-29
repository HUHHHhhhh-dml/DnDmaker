import {
  EQUIPMENT_SLOTS,
  applyEffect,
  calculateStats,
  clamp,
  currentHp,
  newId,
  type AppliedEffect,
  type Campaign,
  type CampaignContent,
  type Character,
  type CharacterOverrides,
  type CombatUnit,
  type Id,
  type Team,
} from "@protocol-life/shared";

/**
 * Snapshot de una ficha al iniciar el combate.
 *
 * El combate nunca vuelve a leer la ficha viva para stats/equipo/skills: todo
 * lo que el motor y el renderer necesitan queda copiado en `CombatUnit`.
 */

export interface SnapshotOptions {
  /** Campaña completa (contenido + reglas) para derivar stats. */
  campaign: Campaign;
  team: Team;
  /**
   * Tirada de SPD de este combate (1..4), inyectada desde `startEncounter`.
   * El snapshot es puro: no genera PRNG. Si falta no se aplica roll.
   */
  speedRoll?: number;
}

/**
 * Aplica los overrides de una aparición de enemigo sin permitir cambiar la
 * identidad ni el tipo base de la ficha (el bando lo decide el encuentro).
 */
export function applyCharacterOverrides(
  base: Character,
  overrides: CharacterOverrides | undefined,
): Character {
  if (!overrides) return { ...base };

  const merged: Character = {
    ...base,
    ...overrides,
    id: base.id,
    kind: base.kind,
    baseStats: { ...base.baseStats, ...(overrides.baseStats ?? {}) },
    equipment: { ...base.equipment, ...(overrides.equipment ?? {}) },
    skills: overrides.skills ? [...overrides.skills] : [...base.skills],
    special: overrides.special
      ? { ...(base.special ?? {}), ...overrides.special }
      : base.special,
    inventory: overrides.inventory
      ? [...overrides.inventory]
      : [...base.inventory],
  };

  return merged;
}

/**
 * Efectos pasivos aportados por el equipo. Sus `modifyStat` ya están
 * incluidos en `stats` (se derivó con `calculateStats`); se copian para que
 * el renderer los muestre y el motor pueda disparar triggers no pasivos.
 */
export function collectEquipmentEffects(
  character: Character,
  content: Pick<CampaignContent, "items" | "effects">,
): AppliedEffect[] {
  const items = new Map(content.items.map((item) => [item.id, item]));
  const definitions = new Map(
    content.effects.map((effect) => [effect.id, effect]),
  );
  const collected = new Map<string, AppliedEffect>();

  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = character.equipment?.[slot];
    if (!itemId) continue;
    const item = items.get(itemId);
    if (!item) continue;

    for (const ref of item.effects ?? []) {
      const definition = definitions.get(ref.effectId);
      if (!definition) continue;
      const max = definition.maxStacks ?? 99;
      const stacks = clamp(ref.stacks ?? 1, 1, Math.max(1, max));
      const existing = collected.get(ref.effectId);
      if (existing) {
        existing.stacks = clamp(existing.stacks + stacks, 1, Math.max(1, max));
      } else {
        collected.set(ref.effectId, {
          effectId: ref.effectId,
          stacks,
          sourceId: item.id,
          passive: true,
        });
      }
    }
  }

  return [...collected.values()];
}

export function utilityUses(
  character: Character,
  content: Pick<CampaignContent, "items">,
): number {
  const utilityId = character.equipment?.utility;
  if (!utilityId) return 0;
  const item = content.items.find((entry) => entry.id === utilityId);
  return Math.max(0, item?.uses ?? 0);
}

/** Efectos activos que aporta el equipo al empezar el combate. */
export function collectStartCombatEffects(
  character: Character,
  content: Pick<CampaignContent, "items">,
): { itemId: Id; effectId: Id; stacks?: number }[] {
  const itemById = new Map(content.items.map((item) => [item.id, item]));
  const refs: { itemId: Id; effectId: Id; stacks?: number }[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = character.equipment?.[slot];
    if (!itemId) continue;
    const item = itemById.get(itemId);
    for (const ref of item?.startCombatEffects ?? []) {
      refs.push({ itemId, effectId: ref.effectId, stacks: ref.stacks });
    }
  }
  return refs;
}

export function snapshotUnit(
  character: Character,
  options: SnapshotOptions,
): CombatUnit {
  const { campaign, team, speedRoll } = options;
  const derived = calculateStats(
    character,
    campaign.content,
    campaign.rules,
    campaign.settings,
  );
  const hpMax = derived.stats.hpMax;
  const hp = currentHp(character, hpMax);
  // La SPD total incluye la tirada del combate; `baseStats` no cambia. El
  // motor preserva el roll al refrescar stats entre rondas.
  const spdRoll =
    speedRoll === undefined ? undefined : clamp(Math.trunc(speedRoll), 1, 4);
  const stats = { ...derived.stats };
  if (spdRoll !== undefined) stats.spd += spdRoll;

  // El motor evalúa la fase sin leer la ficha viva: la configuración viaja en
  // el snapshot. La fase 1 son los campos base; estos overrides son la fase 2.
  const bossPhase = character.bossPhase
    ? {
        ...character.bossPhase,
        ...(character.bossPhase.skills
          ? { skills: [...character.bossPhase.skills] }
          : {}),
      }
    : undefined;

  const unit: CombatUnit = {
    id: newId("unt"),
    characterId: character.id,
    team,
    kind: character.kind,
    name: character.name,
    description: character.description,
    portrait: character.portrait,
    visualMode: character.visualMode,
    battleSprite: character.battleSprite,
    bodyImage: character.bodyImage,
    ...(bossPhase ? { bossPhase, bossPhaseActive: false } : {}),
    stats,
    ...(spdRoll === undefined ? {} : { spdRoll }),
    // Incluye las ganancias de nivel: el motor recalcula stats durante el
    // combate a partir de esta base y no debe perderlas.
    baseStats: { ...derived.base },
    hpCurrent: hp,
    soulPoints: { ...derived.soulPoints },
    overcharged: derived.soulPoints.overcharged,
    equipment: { ...character.equipment },
    skills: [...character.skills],
    special: character.special ? { ...character.special } : undefined,
    effects: collectEquipmentEffects(character, campaign.content),
    utilityUses: utilityUses(character, campaign.content),
    defeated: hp <= 0,
  };

  // Los efectos de inicio se aplican como activos (no pasivos): tendrán
  // duración y podrán consumirse igual que los aplicados por una skill.
  let withStartEffects = unit;
  for (const ref of collectStartCombatEffects(character, campaign.content)) {
    withStartEffects = applyEffect(
      withStartEffects,
      ref.effectId,
      ref.stacks ?? 1,
      { content: campaign.content, rules: campaign.rules },
      ref.itemId,
    ).unit;
  }

  return withStartEffects;
}
