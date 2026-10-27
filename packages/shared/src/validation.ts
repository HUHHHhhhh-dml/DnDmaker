import { CHARACTER_SKILL_SLOTS, EQUIPMENT_SLOTS } from "./defaults";
import { calculateStats } from "./stats";
import type {
  Campaign,
  CampaignContent,
  Character,
  EffectAction,
  EffectDefinition,
  Encounter,
  Item,
  Ruleset,
  Skill,
} from "./types";
import { DEFAULT_RULES } from "./defaults";

/**
 * Validación de negocio (referencias, slots, límites que dependen del
 * contenido). Zod valida la forma; esto valida la coherencia de la campaña.
 */

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  path: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

function issue(
  path: string,
  message: string,
  severity: ValidationSeverity = "error",
): ValidationIssue {
  return { path, message, severity };
}

function result(issues: ValidationIssue[]): ValidationResult {
  return { valid: !issues.some((entry) => entry.severity === "error"), issues };
}

function groupById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function findDuplicateIds<T extends { id: string }>(
  items: T[],
  label: string,
): ValidationIssue[] {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      issues.push(issue(`${label}[${item.id}]`, "ID duplicado dentro de la campaña."));
    }
    seen.add(item.id);
  }
  return issues;
}

function checkActionRefs(
  actions: EffectAction[],
  effects: Map<string, EffectDefinition>,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  actions.forEach((action, index) => {
    if (action.type === "applyEffect" && !effects.has(action.effectId)) {
      issues.push(
        issue(
          `${path}.actions[${index}]`,
          "El efecto referenciado no existe en la campaña.",
        ),
      );
    }
  });
  return issues;
}

/* -------------------------------------------------------------------------- */
/* Entidades sueltas                                                          */
/* -------------------------------------------------------------------------- */

export function validateItem(
  item: Item,
  content: Pick<CampaignContent, "effects">,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const effects = groupById(content.effects);
  const path = `items[${item.id}]`;

  (item.effects ?? []).forEach((ref, index) => {
    if (!effects.has(ref.effectId)) {
      issues.push(
        issue(`${path}.effects[${index}]`, "El efecto pasivo no existe en la campaña."),
      );
    }
  });

  (item.useEffect ?? []).forEach((action, index) => {
    if (action.type === "applyEffect" && !effects.has(action.effectId)) {
      issues.push(
        issue(
          `${path}.useEffect[${index}]`,
          "El efecto aplicado por la utilidad no existe.",
        ),
      );
    }
  });

  if (item.slot !== "utility" && (item.uses !== undefined || item.useEffect?.length)) {
    issues.push(
      issue(
        `${path}.slot`,
        "Solo los objetos de utilidad pueden tener usos o efecto de uso.",
        "warning",
      ),
    );
  }

  if (item.slot === "utility" && !item.uses && !item.useEffect?.length) {
    issues.push(
      issue(
        `${path}.uses`,
        "Esta utilidad no tiene usos ni efecto; no podrá usarse en combate.",
        "warning",
      ),
    );
  }

  return result(issues);
}

export function validateSkill(
  skill: Skill,
  content: Pick<CampaignContent, "effects">,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const effects = groupById(content.effects);
  const path = `skills[${skill.id}]`;

  (skill.effects ?? []).forEach((ref, index) => {
    if (!effects.has(ref.effectId)) {
      issues.push(
        issue(`${path}.effects[${index}]`, "El efecto de la skill no existe."),
      );
    }
  });

  if (skill.coinDamage < 0 || skill.coinClash < 0) {
    issues.push(
      issue(
        `${path}.coinDamage`,
        "Hay monedas con valor negativo: las caras restarán (permitido en v0.1).",
        "warning",
      ),
    );
  }

  return result(issues);
}

export function validateEffect(
  effect: EffectDefinition,
  content: Pick<CampaignContent, "effects">,
): ValidationResult {
  const effects = groupById(content.effects);
  const issues = checkActionRefs(
    effect.triggers.flatMap((trigger) => trigger.actions),
    effects,
    `effects[${effect.id}]`,
  );

  if (effect.maxStacks === undefined) {
    issues.push(
      issue(
        `effects[${effect.id}].maxStacks`,
        "Sin tope de stacks: puede acumularse sin límite.",
        "warning",
      ),
    );
  }

  return result(issues);
}

export function validateCharacter(
  character: Character,
  content: Pick<CampaignContent, "items" | "skills" | "effects" | "specials">,
  rules: Ruleset = DEFAULT_RULES,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const items = groupById(content.items);
  const skills = groupById(content.skills);
  const specials = groupById(content.specials);
  const path = `characters[${character.id}]`;

  if (character.skills.length !== CHARACTER_SKILL_SLOTS) {
    issues.push(
      issue(
        `${path}.skills`,
        `La ficha debe tener exactamente ${CHARACTER_SKILL_SLOTS} slots de skill.`,
      ),
    );
  }

  character.skills.forEach((skillId, index) => {
    if (skillId && !skills.has(skillId)) {
      issues.push(
        issue(`${path}.skills[${index}]`, "La skill equipada no existe en la campaña."),
      );
    }
  });

  const usedSlots = new Map<string, string>();
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = character.equipment?.[slot];
    if (!itemId) continue;

    const item = items.get(itemId);
    if (!item) {
      issues.push(
        issue(`${path}.equipment.${slot}`, "El objeto equipado no existe."),
      );
      continue;
    }

    if (item.slot !== slot) {
      issues.push(
        issue(
          `${path}.equipment.${slot}`,
          `"${item.name}" pertenece al slot ${item.slot}, no a ${slot}.`,
          "warning",
        ),
      );
    }

    if (usedSlots.has(itemId)) {
      issues.push(
        issue(
          `${path}.equipment.${slot}`,
          `El mismo objeto ya está equipado en ${usedSlots.get(itemId)}.`,
          "warning",
        ),
      );
    }
    usedSlots.set(itemId, slot);
  }

  if (character.special?.domainId && !specials.has(character.special.domainId)) {
    issues.push(
      issue(`${path}.special.domainId`, "El dominio equipado no existe."),
    );
  }
  if (character.special?.habitatId && !specials.has(character.special.habitatId)) {
    issues.push(
      issue(`${path}.special.habitatId`, "El hábitat equipado no existe."),
    );
  }

  character.inventory.forEach((entry, index) => {
    if (!items.has(entry.itemId)) {
      issues.push(
        issue(`${path}.inventory[${index}]`, "El objeto del inventario no existe."),
      );
    }
    if (entry.qty < 1) {
      issues.push(
        issue(`${path}.inventory[${index}].qty`, "La cantidad debe ser al menos 1."),
      );
    }
  });

  if (character.kind === "player" && !character.name.trim()) {
    issues.push(issue(`${path}.name`, "El personaje necesita un nombre."));
  }

  const derived = calculateStats(character, content, rules);
  for (const warning of derived.warnings) {
    issues.push(issue(path, warning, "warning"));
  }

  return result(issues);
}

export function validateEncounter(
  encounter: Encounter,
  content: Pick<CampaignContent, "characters" | "items">,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const characters = groupById(content.characters);
  const items = groupById(content.items);
  const path = `encounters[${encounter.id}]`;

  if (encounter.enemies.length === 0) {
    issues.push(
      issue(`${path}.enemies`, "El encuentro no tiene enemigos.", "warning"),
    );
  }

  encounter.enemies.forEach((enemy, index) => {
    const character = characters.get(enemy.characterId);
    if (!character) {
      issues.push(
        issue(
          `${path}.enemies[${index}].characterId`,
          "El personaje del encuentro no existe.",
        ),
      );
      return;
    }
    if (character.kind !== "enemy") {
      issues.push(
        issue(
          `${path}.enemies[${index}].characterId`,
          `"${character.name}" no es un enemigo (es ${character.kind}).`,
          "warning",
        ),
      );
    }
  });

  (encounter.rewards?.itemIds ?? []).forEach((itemId, index) => {
    if (!items.has(itemId)) {
      issues.push(
        issue(`${path}.rewards.itemIds[${index}]`, "La recompensa no existe."),
      );
    }
  });

  return result(issues);
}

/* -------------------------------------------------------------------------- */
/* Campaña completa                                                           */
/* -------------------------------------------------------------------------- */

export function validateContent(
  content: CampaignContent,
  rules: Ruleset = DEFAULT_RULES,
): ValidationResult {
  const issues: ValidationIssue[] = [
    ...findDuplicateIds(content.items, "items"),
    ...findDuplicateIds(content.skills, "skills"),
    ...findDuplicateIds(content.effects, "effects"),
    ...findDuplicateIds(content.characters, "characters"),
    ...findDuplicateIds(content.encounters, "encounters"),
    ...findDuplicateIds(content.specials, "specials"),
  ];

  for (const item of content.items) {
    issues.push(...validateItem(item, content).issues);
  }
  for (const skill of content.skills) {
    issues.push(...validateSkill(skill, content).issues);
  }
  for (const effect of content.effects) {
    issues.push(...validateEffect(effect, content).issues);
  }
  for (const character of content.characters) {
    issues.push(...validateCharacter(character, content, rules).issues);
  }
  for (const encounter of content.encounters) {
    issues.push(...validateEncounter(encounter, content).issues);
  }
  for (const special of content.specials) {
    issues.push(
      ...checkActionRefs(
        special.effects,
        groupById(content.effects),
        `specials[${special.id}]`,
      ).map((entry) => issue(entry.path, entry.message, "error")),
    );
  }

  return result(issues);
}

export function validateCampaign(campaign: Campaign): ValidationResult {
  const issues: ValidationIssue[] = [];
  const rules = campaign.rules;

  if (rules.luckFloor > rules.luckCap) {
    issues.push(
      issue("rules.luckFloor", "El suelo de suerte no puede superar al techo."),
    );
  }
  if (rules.maxSkillSlots < 1) {
    issues.push(issue("rules.maxSkillSlots", "Debe haber al menos 1 Skill Slot."));
  }
  if (campaign.settings.requirePin && !campaign.settings.pin) {
    issues.push(
      issue(
        "settings.pin",
        "El PIN es obligatorio pero está vacío.",
        "warning",
      ),
    );
  }
  if (campaign.settings.maxPlayers > 6) {
    issues.push(
      issue("settings.maxPlayers", "v0.1 admite 6 jugadores como máximo.", "warning"),
    );
  }

  issues.push(...validateContent(campaign.content, rules).issues);
  return result(issues);
}

/* -------------------------------------------------------------------------- */
/* Referencias entrantes (para bloquear borrados)                             */
/* -------------------------------------------------------------------------- */

export interface ReferenceInfo {
  label: string;
  id: string;
}

/** Busca quién referencia a `id` dentro del contenido, para no romper datos. */
export function findReferences(id: string, content: CampaignContent): ReferenceInfo[] {
  const refs: ReferenceInfo[] = [];

  for (const item of content.items) {
    if (item.effects?.some((ref) => ref.effectId === id)) {
      refs.push({ label: `objeto "${item.name}"`, id: item.id });
    }
    if (item.useEffect?.some((action) => action.type === "applyEffect" && action.effectId === id)) {
      refs.push({ label: `objeto "${item.name}"`, id: item.id });
    }
  }

  for (const skill of content.skills) {
    if (skill.effects?.some((ref) => ref.effectId === id)) {
      refs.push({ label: `skill "${skill.name}"`, id: skill.id });
    }
  }

  for (const effect of content.effects) {
    if (
      effect.triggers.some((trigger) =>
        trigger.actions.some(
          (action) => action.type === "applyEffect" && action.effectId === id,
        ),
      )
    ) {
      refs.push({ label: `efecto "${effect.name}"`, id: effect.id });
    }
  }

  for (const special of content.specials) {
    if (
      special.effects.some(
        (action) => action.type === "applyEffect" && action.effectId === id,
      )
    ) {
      refs.push({ label: `habilidad especial "${special.name}"`, id: special.id });
    }
  }

  for (const character of content.characters) {
    if (Object.values(character.equipment ?? {}).includes(id)) {
      refs.push({ label: `personaje "${character.name}"`, id: character.id });
    }
    if (character.skills.includes(id)) {
      refs.push({ label: `personaje "${character.name}"`, id: character.id });
    }
    if (character.special?.domainId === id || character.special?.habitatId === id) {
      refs.push({ label: `personaje "${character.name}"`, id: character.id });
    }
    if (character.inventory.some((entry) => entry.itemId === id)) {
      refs.push({ label: `inventario de "${character.name}"`, id: character.id });
    }
  }

  for (const encounter of content.encounters) {
    if (encounter.enemies.some((enemy) => enemy.characterId === id)) {
      refs.push({ label: `encuentro "${encounter.name}"`, id: encounter.id });
    }
    if (encounter.rewards?.itemIds?.includes(id)) {
      refs.push({ label: `recompensas de "${encounter.name}"`, id: encounter.id });
    }
  }

  for (const shop of content.shops) {
    if (shop.items.some((entry) => entry.itemId === id)) {
      refs.push({ label: `tienda "${shop.name}"`, id: shop.id });
    }
  }

  for (const dungeon of content.dungeons) {
    if (dungeon.rooms.some((room) => room.encounterId === id)) {
      refs.push({ label: `mazmorra "${dungeon.name}"`, id: dungeon.id });
    }
  }

  return refs;
}

export function formatIssues(issues: ValidationIssue[]): string[] {
  return issues.map((entry) =>
    entry.severity === "error"
      ? `${entry.path}: ${entry.message}`
      : `${entry.path} (aviso): ${entry.message}`,
  );
}
