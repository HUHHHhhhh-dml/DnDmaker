import {
  canUseSpecial,
  type CampaignContent,
  type CombatState,
  type CombatUnit,
  type DeclaredAction,
  type Id,
} from "@protocol-life/shared";
import { HttpError } from "../repository";
import { isAlive } from "./units";

/**
 * Validación y normalización de declaraciones de una unidad (Fase 3C).
 *
 * El cliente solo elige slot, tipo de acción, objetivo y, si aplica,
 * redirección. El servidor rellena `unitId`/`locked`, valida contra el
 * snapshot del combate y contra el contenido de la campaña, y devuelve las
 * acciones limpias que se persisten en `state.actions[unit.id]`.
 */

/** Acción tal y como la envía el cliente; el servidor añade unitId/locked. */
export type DeclaredActionInput = Omit<DeclaredAction, "unitId" | "locked">;

export interface NormalizeDeclarationsParams {
  state: CombatState;
  unit: CombatUnit;
  actions: readonly DeclaredActionInput[];
  content: CampaignContent;
}

function fail(statusCode: number, code: string, message: string): never {
  throw new HttpError(statusCode, code, message);
}

/**
 * `targetSlot` es SOLO presentación: el cliente puede resaltar un slot del
 * objetivo, pero el emparejamiento de clash sigue siendo por unidad y sin
 * importar slot. Se valida contra el cupo real del objetivo.
 */
function assertTargetSlot(
  target: CombatUnit,
  targetSlot: number | undefined,
): void {
  if (targetSlot === undefined) return;
  if (
    !Number.isInteger(targetSlot) ||
    targetSlot < 1 ||
    targetSlot > target.stats.skillSlots
  ) {
    fail(
      422,
      "target_slot_out_of_range",
      `El slot visual ${String(targetSlot)} no es válido para ${target.name}; tiene ${target.stats.skillSlots}.`,
    );
  }
}

export function normalizeDeclarations({
  state,
  unit,
  actions,
  content,
}: NormalizeDeclarationsParams): DeclaredAction[] {
  const maxSlots = unit.stats.skillSlots;
  if (actions.length > maxSlots) {
    fail(
      422,
      "too_many_actions",
      `${unit.name} solo puede declarar ${maxSlots} acciones; recibí ${actions.length}.`,
    );
  }

  const unitsById = new Map(state.units.map((entry) => [entry.id, entry]));
  const usedSlots = new Set<number>();
  const declaredSpecials = new Set<"domain" | "habitat">();
  let declaredUtilities = 0;
  const normalized: DeclaredAction[] = [];

  const targetOf = (targetId: Id | undefined): CombatUnit => {
    if (!targetId) {
      fail(422, "target_required", "La acción necesita un objetivo.");
    }
    const target = unitsById.get(targetId);
    if (!target) {
      fail(422, "target_not_found", "El objetivo ya no existe en el combate.");
    }
    if (!isAlive(target)) {
      fail(409, "target_defeated", "El objetivo ya está derrotado.");
    }
    return target;
  };

  for (const raw of actions) {
    if (
      !Number.isInteger(raw.slot) ||
      raw.slot < 1 ||
      raw.slot > maxSlots
    ) {
      fail(
        422,
        "slot_out_of_range",
        `El slot ${String(raw.slot)} no es válido; ${unit.name} tiene ${maxSlots}.`,
      );
    }
    if (usedSlots.has(raw.slot)) {
      fail(422, "duplicate_slot", `El slot ${raw.slot} está repetido.`);
    }
    usedSlots.add(raw.slot);

    const kinds = [raw.skillId, raw.utilityId, raw.special].filter(
      (value) => value !== undefined && value !== null,
    );
    if (kinds.length !== 1) {
      fail(
        422,
        "invalid_action",
        "Cada acción debe ser exactamente una skill, una utilidad o un especial.",
      );
    }

    if (raw.skillId) {
      const skillId = raw.skillId;
      if (!unit.skills.includes(skillId)) {
        fail(
          422,
          "skill_not_equipped",
          `${unit.name} no tiene esa skill equipada.`,
        );
      }
      if (!content.skills.some((skill) => skill.id === skillId)) {
        fail(422, "skill_not_found", "La skill ya no existe en la campaña.");
      }
      if (!raw.targetId) {
        fail(422, "target_required", "La skill necesita un objetivo.");
      }
      const target = targetOf(raw.targetId);
      assertTargetSlot(target, raw.targetSlot);

      if (raw.redirectFor) {
        if (raw.redirectFor === unit.id) {
          fail(
            422,
            "redirect_invalid_ally",
            "No puedes redirigir un ataque contra ti mismo.",
          );
        }
        const protectedUnit = unitsById.get(raw.redirectFor);
        if (!protectedUnit) {
          fail(422, "redirect_ally_not_found", "El aliado a proteger no existe.");
        }
        if (protectedUnit.team !== unit.team) {
          fail(422, "redirect_not_ally", "Solo puedes redirigir hacia un aliado.");
        }
        if (!isAlive(protectedUnit)) {
          fail(409, "redirect_ally_defeated", "El aliado a proteger ya cayó.");
        }
        if (target.team === unit.team) {
          fail(
            422,
            "redirect_target_not_enemy",
            "La redirección debe apuntar a un atacante enemigo.",
          );
        }
        if (!(unit.stats.spd > target.stats.spd)) {
          fail(
            422,
            "redirect_speed",
            "La redirección exige SPD estrictamente mayor que la del atacante.",
          );
        }
      }

      normalized.push({
        unitId: unit.id,
        slot: raw.slot,
        skillId,
        targetId: raw.targetId,
        ...(raw.targetSlot !== undefined ? { targetSlot: raw.targetSlot } : {}),
        ...(raw.redirectFor ? { redirectFor: raw.redirectFor } : {}),
        locked: false,
      });
      continue;
    }

    if (raw.utilityId) {
      if (raw.redirectFor) {
        fail(
          422,
          "redirect_requires_skill",
          "La redirección debe declararse con una skill.",
        );
      }
      const utilityId = raw.utilityId;
      if (unit.equipment.utility !== utilityId) {
        fail(
          422,
          "utility_not_equipped",
          `${unit.name} no tiene esa utilidad equipada.`,
        );
      }
      const item = content.items.find((entry) => entry.id === utilityId);
      if (!item) {
        fail(422, "utility_not_found", "La utilidad ya no existe en la campaña.");
      }
      declaredUtilities += 1;
      if (unit.utilityUses <= 0 || declaredUtilities > unit.utilityUses) {
        fail(
          422,
          "utility_no_uses",
          `${unit.name} no tiene usos suficientes de ${item.name}.`,
        );
      }
      const targetId = raw.targetId ?? unit.id;
      const target = targetOf(targetId);
      assertTargetSlot(target, raw.targetSlot);
      normalized.push({
        unitId: unit.id,
        slot: raw.slot,
        utilityId,
        targetId,
        ...(raw.targetSlot !== undefined ? { targetSlot: raw.targetSlot } : {}),
        locked: false,
      });
      continue;
    }

    // Especial (dominio o hábitat).
    if (raw.redirectFor) {
      fail(
        422,
        "redirect_requires_skill",
        "La redirección debe declararse con una skill.",
      );
    }
    const specialKey = raw.special;
    if (specialKey !== "domain" && specialKey !== "habitat") {
      fail(422, "invalid_action", "El especial declarado no es válido.");
    }
    if (declaredSpecials.has(specialKey)) {
      fail(
        422,
        "special_duplicate",
        "No puedes declarar dos veces el mismo dominio/hábitat en la ronda.",
      );
    }
    declaredSpecials.add(specialKey);

    const specialId =
      specialKey === "domain"
        ? unit.special?.domainId
        : unit.special?.habitatId;
    if (!specialId) {
      fail(
        422,
        "special_not_equipped",
        `${unit.name} no tiene ${specialKey === "domain" ? "dominio" : "hábitat"}.`,
      );
    }
    const special = content.specials.find((entry) => entry.id === specialId);
    if (!special) {
      fail(422, "special_not_found", "El especial ya no existe en la campaña.");
    }
    if (!canUseSpecial(state, unit.id, special)) {
      fail(
        409,
        "special_unavailable",
        `${special.name} ya se usó o está en cooldown.`,
      );
    }
    if (raw.targetId) {
      const target = targetOf(raw.targetId);
      assertTargetSlot(target, raw.targetSlot);
    }

    normalized.push({
      unitId: unit.id,
      slot: raw.slot,
      special: specialKey,
      ...(raw.targetId ? { targetId: raw.targetId } : {}),
      ...(raw.targetSlot !== undefined ? { targetSlot: raw.targetSlot } : {}),
      locked: false,
    });
  }

  return normalized.sort((a, b) => a.slot - b.slot);
}
