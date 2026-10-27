import {
  canUseSpecial,
  newId,
  type CampaignContent,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type DeclaredAction,
  type SpecialAbility,
} from "@protocol-life/shared";

/**
 * Helpers de presentación/validación del combate en el cliente (Fase 3E).
 *
 * Aquí no se resuelve ninguna regla de daño/monedas: solo se preparan las
 * intenciones que el servidor validará y se formatean datos que ya vienen
 * resueltos en `CombatState`/`CombatEvent`.
 */

export type CombatDeclaration = Omit<DeclaredAction, "unitId" | "locked">;

export type CombatActionKind = "skill" | "utility" | "domain" | "habitat";

/** Borrador local de una acción; `slot` se deriva de su posición. */
export interface CombatDraftAction {
  id: string;
  kind: CombatActionKind;
  skillId?: string;
  utilityId?: string;
  targetId?: string;
  redirectFor?: string;
}

export interface CombatDraftContext {
  /** Estado público o completo; solo se leen unidades/cooldowns. */
  combat: Pick<CombatState, "units" | "specialCooldowns">;
  unit: CombatUnit;
  content: CampaignContent;
}

export function isAliveUnit(unit: CombatUnit): boolean {
  return !unit.defeated && unit.hpCurrent > 0;
}

/**
 * Orden de resolución por SPD descendente. Empate: primero la party, luego
 * el id. Es solo presentación; el servidor manda.
 */
export function turnOrder(units: CombatUnit[]): Map<string, number> {
  const ordered = [...units]
    .filter(isAliveUnit)
    .sort(
      (a, b) =>
        b.stats.spd - a.stats.spd ||
        (a.team === b.team ? 0 : a.team === "players" ? -1 : 1) ||
        a.id.localeCompare(b.id),
    );
  return new Map(ordered.map((unit, index) => [unit.id, index + 1]));
}

/**
 * ¿El combate referencia skills/objetos/efectos que la campaña saneada todavía
 * no trae? Sirve para pedir un refresco si el cliente perdió el
 * `campaign:refresh` del inicio del combate.
 */
export function combatHasMissingContent(
  combat: Pick<CombatState, "units">,
  content: Pick<CampaignContent, "items" | "skills" | "effects" | "specials">,
): boolean {
  const skillIds = new Set(content.skills.map((skill) => skill.id));
  const itemIds = new Set(content.items.map((item) => item.id));
  const effectIds = new Set<string>([
    ...content.effects.map((effect) => effect.id),
    ...content.specials.map((special) => special.id),
    ...content.items.map((item) => item.id),
  ]);

  return combat.units.some((unit) => {
    if (
      unit.skills.some(
        (skillId) => Boolean(skillId) && !skillIds.has(skillId!),
      )
    ) {
      return true;
    }
    if (
      Object.values(unit.equipment).some(
        (itemId) => Boolean(itemId) && !itemIds.has(itemId!),
      )
    ) {
      return true;
    }
    return unit.effects.some((effect) => !effectIds.has(effect.effectId));
  });
}

export function isUnitLocked(
  combat: Pick<CombatState, "lockedUnits" | "actions">,
  unitId: string,
): boolean {
  if (combat.lockedUnits?.[unitId] === true) return true;
  const actions = combat.actions[unitId] ?? [];
  return actions.length > 0 && actions.every((action) => action.locked);
}

export function hpPercent(unit: CombatUnit): number {
  if (unit.stats.hpMax <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((unit.hpCurrent / unit.stats.hpMax) * 100)),
  );
}

export function unitById(
  combat: Pick<CombatState, "units">,
  unitId: string | undefined,
): CombatUnit | null {
  if (!unitId) return null;
  return combat.units.find((unit) => unit.id === unitId) ?? null;
}

export function findSkill(
  content: Pick<CampaignContent, "skills">,
  skillId: string | undefined,
) {
  if (!skillId) return null;
  return content.skills.find((skill) => skill.id === skillId) ?? null;
}

export function findItem(
  content: Pick<CampaignContent, "items">,
  itemId: string | undefined,
) {
  if (!itemId) return null;
  return content.items.find((item) => item.id === itemId) ?? null;
}

export function findSpecial(
  content: Pick<CampaignContent, "specials">,
  specialId: string | undefined,
): SpecialAbility | null {
  if (!specialId) return null;
  return content.specials.find((special) => special.id === specialId) ?? null;
}

export function specialForUnit(
  content: Pick<CampaignContent, "specials">,
  unit: CombatUnit,
  kind: "domain" | "habitat",
): SpecialAbility | null {
  const id = kind === "domain" ? unit.special?.domainId : unit.special?.habitatId;
  return findSpecial(content, id ?? undefined);
}

export function specialUsed(
  combat: Pick<CombatState, "specialCooldowns">,
  unit: CombatUnit,
  special: SpecialAbility | null,
): boolean {
  if (!special) return true;
  return !canUseSpecial(combat, unit.id, special);
}

export function equippedSkillIds(unit: CombatUnit): string[] {
  return unit.skills.filter((id): id is string => Boolean(id));
}

export function utilityItemForUnit(
  content: Pick<CampaignContent, "items">,
  unit: CombatUnit,
) {
  return findItem(content, unit.equipment.utility ?? undefined);
}

export function declaredActionsForUnit(
  actions: Record<string, DeclaredAction[]>,
  unitId: string,
): DeclaredAction[] {
  return [...(actions[unitId] ?? [])].sort((a, b) => a.slot - b.slot);
}

export function draftActionLabel(
  action: CombatDraftAction,
  content: CampaignContent,
): string {
  if (action.kind === "skill") {
    return findSkill(content, action.skillId)?.name ?? "Skill sin elegir";
  }
  if (action.kind === "utility") {
    return findItem(content, action.utilityId)?.name ?? "Utilidad sin elegir";
  }
  return action.kind === "domain" ? "Dominio" : "Hábitat";
}

export function serverActionLabel(
  action: DeclaredAction,
  content: CampaignContent,
): string {
  if (action.skillId) return findSkill(content, action.skillId)?.name ?? "Skill";
  if (action.utilityId) return findItem(content, action.utilityId)?.name ?? "Utilidad";
  if (action.special === "domain") return "Dominio";
  if (action.special === "habitat") return "Hábitat";
  return "Acción";
}

export function newDraftAction(
  kind: CombatActionKind,
  defaults: Partial<CombatDraftAction> = {},
): CombatDraftAction {
  return {
    id: newId("act"),
    kind,
    ...defaults,
  };
}

export function payloadToDraft(actions: DeclaredAction[]): CombatDraftAction[] {
  return [...actions]
    .sort((a, b) => a.slot - b.slot)
    .map((action) => ({
      id: newId("act"),
      kind: action.skillId
        ? "skill"
        : action.utilityId
          ? "utility"
          : action.special === "habitat"
            ? "habitat"
            : "domain",
      skillId: action.skillId,
      utilityId: action.utilityId,
      targetId: action.targetId,
      redirectFor: action.redirectFor,
    }));
}

export function draftToPayload(draft: CombatDraftAction[]): CombatDeclaration[] {
  return draft.map((action, index) => {
    const slot = index + 1;
    if (action.kind === "skill") {
      return {
        slot,
        skillId: action.skillId,
        targetId: action.targetId,
        ...(action.redirectFor ? { redirectFor: action.redirectFor } : {}),
      };
    }
    if (action.kind === "utility") {
      return {
        slot,
        utilityId: action.utilityId,
        targetId: action.targetId,
      };
    }
    return { slot, special: action.kind };
  });
}

function canonicalAction(action: CombatDeclaration): Record<string, unknown> {
  return {
    slot: action.slot,
    skillId: action.skillId ?? null,
    utilityId: action.utilityId ?? null,
    special: action.special ?? null,
    targetId: action.targetId ?? null,
    redirectFor: action.redirectFor ?? null,
  };
}

export function draftSignature(draft: CombatDraftAction[]): string {
  return JSON.stringify(draftToPayload(draft).map(canonicalAction));
}

export function serverActionsSignature(actions: DeclaredAction[]): string {
  return JSON.stringify(
    [...actions]
      .sort((a, b) => a.slot - b.slot)
      .map((action) =>
        canonicalAction({
          slot: action.slot,
          skillId: action.skillId,
          utilityId: action.utilityId,
          special: action.special,
          targetId: action.targetId,
          redirectFor: action.redirectFor,
        }),
      ),
  );
}

/**
 * Valida lo que la UI puede comprobar antes de mandar la intención. El
 * servidor vuelve a validar todo; esto solo evita errores tontos y explica
 * por qué un borrador no se puede bloquear.
 */
export function validateDraft(
  draft: CombatDraftAction[],
  { combat, unit, content }: CombatDraftContext,
): string | null {
  if (draft.length > unit.stats.skillSlots) {
    return `Solo puedes declarar ${unit.stats.skillSlots} acciones.`;
  }

  const living = new Set(
    combat.units.filter(isAliveUnit).map((entry) => entry.id),
  );
  const unitSkills = new Set(equippedSkillIds(unit));
  const declaredSpecials = new Set<string>();
  let utilityCount = 0;

  for (const [index, action] of draft.entries()) {
    const label = `Acción ${index + 1}`;

    if (action.kind === "skill") {
      const skill = findSkill(content, action.skillId);
      if (!skill || !unitSkills.has(skill.id)) {
        return `${label}: elige una skill equipada.`;
      }
      const target = unitById(combat, action.targetId);
      if (!target || !living.has(target.id)) {
        return `${label}: elige un objetivo vivo.`;
      }
      if (action.redirectFor) {
        const protectedUnit = unitById(combat, action.redirectFor);
        if (!protectedUnit || !living.has(protectedUnit.id)) {
          return `${label}: el aliado a proteger no está disponible.`;
        }
        if (protectedUnit.team !== unit.team || protectedUnit.id === unit.id) {
          return `${label}: solo puedes redirigir hacia otro aliado vivo.`;
        }
        if (target.team === unit.team) {
          return `${label}: una redirección debe apuntar a un atacante enemigo.`;
        }
        if (unit.stats.spd <= target.stats.spd) {
          return `${label}: necesitas más SPD que el atacante para redirigir.`;
        }
      }
      continue;
    }

    if (action.kind === "utility") {
      const item = findItem(content, action.utilityId);
      if (!item || unit.equipment.utility !== item.id) {
        return `${label}: elige la utilidad equipada.`;
      }
      utilityCount += 1;
      if (utilityCount > unit.utilityUses) {
        return `${label}: no te quedan usos de ${item.name}.`;
      }
      const target = unitById(combat, action.targetId);
      if (!target || !living.has(target.id)) {
        return `${label}: elige un objetivo vivo.`;
      }
      continue;
    }

    const special = specialForUnit(content, unit, action.kind);
    if (!special) {
      return `${label}: no tienes ${action.kind === "domain" ? "dominio" : "hábitat"} equipado.`;
    }
    if (declaredSpecials.has(special.id)) {
      return `${label}: ya declaraste ${special.name}.`;
    }
    declaredSpecials.add(special.id);
    if (specialUsed(combat, unit, special)) {
      return `${label}: ${special.name} ya se usó o está en cooldown.`;
    }
  }

  return null;
}

/** Skill que debe mostrar el arma en el sprite, si el servidor ya la resolvió. */
export function latestSkillIdForUnit(
  events: CombatEvent[],
  unitId: string,
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    const data = event.data ?? {};
    if (event.actorId === unitId && typeof data.skillId === "string") {
      return data.skillId;
    }
    if (data.attackerId === unitId && typeof data.attackerSkillId === "string") {
      return data.attackerSkillId;
    }
    if (data.defenderId === unitId && typeof data.defenderSkillId === "string") {
      return data.defenderSkillId;
    }
  }
  return null;
}

export function declaredSkillId(
  actions: DeclaredAction[] | undefined,
): string | null {
  const action = (actions ?? []).find((entry) => entry.skillId);
  return action?.skillId ?? null;
}

export function unitName(
  combat: Pick<CombatState, "units">,
  unitId: string | undefined,
): string {
  return unitById(combat, unitId)?.name ?? "—";
}

export function effectLabel(
  content: CampaignContent,
  effectId: string,
): string {
  return (
    content.effects.find((effect) => effect.id === effectId)?.name ??
    content.specials.find((special) => special.id === effectId)?.name ??
    content.items.find((item) => item.id === effectId)?.name ??
    "Efecto"
  );
}

export function isSkillAvailableForUnit(
  content: CampaignContent,
  unit: CombatUnit,
  skillId: string,
): boolean {
  return (
    equippedSkillIds(unit).includes(skillId) &&
    content.skills.some((skill) => skill.id === skillId)
  );
}
