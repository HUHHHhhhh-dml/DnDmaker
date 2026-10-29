import {
  CHARACTER_SKILL_SLOTS,
  EQUIPMENT_SLOTS,
  isEnemyKind,
} from "./defaults";
import { calculateStats } from "./stats";
import type {
  Campaign,
  CampaignContent,
  CampaignSettings,
  Character,
  Dungeon,
  EffectAction,
  EffectDefinition,
  Encounter,
  Item,
  Ruleset,
  Shop,
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

  // `applyEffect.target: "opponent"` solo tiene sentido si el trigger tiene
  // un rival asociado en combate.
  const targetableTriggers = new Set([
    "onUseSkill",
    "onDealDamage",
    "onTakeDamage",
    "onClashWin",
    "onClashLose",
  ]);
  effect.triggers.forEach((trigger, triggerIndex) => {
    trigger.actions.forEach((action, actionIndex) => {
      if (
        action.type === "applyEffect" &&
        action.target === "opponent" &&
        !targetableTriggers.has(trigger.when)
      ) {
        issues.push(
          issue(
            `effects[${effect.id}].triggers[${triggerIndex}].actions[${actionIndex}]`,
            "Este trigger no tiene un rival: la acción «Aplicar efecto al rival» se ignorará.",
            "warning",
          ),
        );
      }
    });
  });

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
  settings?: Pick<CampaignSettings, "leveling">,
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

  if (character.bossPhase) {
    const phase = character.bossPhase;
    if (character.kind !== "boss") {
      issues.push(
        issue(
          `${path}.bossPhase`,
          "Solo los jefes usan el cambio de fase; se ignorará en combate.",
          "warning",
        ),
      );
    }
    if (
      !Number.isInteger(phase.thresholdPct) ||
      phase.thresholdPct < 1 ||
      phase.thresholdPct > 99
    ) {
      issues.push(
        issue(
          `${path}.bossPhase.thresholdPct`,
          "El umbral de fase debe ser un entero entre 1 y 99.",
        ),
      );
    }
    if (phase.skills) {
      if (phase.skills.length !== CHARACTER_SKILL_SLOTS) {
        issues.push(
          issue(
            `${path}.bossPhase.skills`,
            `La fase 2 debe tener exactamente ${CHARACTER_SKILL_SLOTS} slots de skill.`,
          ),
        );
      }
      phase.skills.forEach((skillId, index) => {
        if (skillId && !skills.has(skillId)) {
          issues.push(
            issue(
              `${path}.bossPhase.skills[${index}]`,
              "La skill de la fase 2 no existe en la campaña.",
            ),
          );
        }
      });
    }
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

  const derived = calculateStats(character, content, rules, settings);
  if (
    character.hpCurrent !== undefined &&
    character.hpCurrent > derived.stats.hpMax
  ) {
    issues.push(
      issue(
        `${path}.hpCurrent`,
        "El HP actual supera el máximo derivado; se ajustará al máximo al iniciar el combate.",
        "warning",
      ),
    );
  }
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
    if (!isEnemyKind(character.kind)) {
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

/**
 * Fase 4 — coherencia de una tienda frente al contenido de la campaña.
 * El precio y el stock los acota Zod; aquí se comprueban referencias y
 * duplicados, que es lo que puede romper la compra.
 */
export function validateShop(
  shop: Shop,
  content: Pick<CampaignContent, "items" | "skills">,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const items = groupById(content.items);
  const skills = groupById(content.skills);
  const path = `shops[${shop.id}]`;
  const seen = new Set<string>();

  shop.items.forEach((entry, index) => {
    if (seen.has(entry.itemId)) {
      issues.push(
        issue(`${path}.items[${index}]`, "El objeto está repetido en la tienda."),
      );
    }
    seen.add(entry.itemId);

    const item = items.get(entry.itemId);
    if (!item) {
      issues.push(
        issue(`${path}.items[${index}].itemId`, "El objeto de la tienda no existe."),
      );
      return;
    }
    if (item.unlocked === true) {
      issues.push(
        issue(
          `${path}.items[${index}].itemId`,
          `"${item.name}" ya está desbloqueado para la campaña: no se podrá comprar.`,
          "warning",
        ),
      );
    }
  });

  const seenSkills = new Set<string>();
  (shop.skills ?? []).forEach((entry, index) => {
    if (seenSkills.has(entry.skillId)) {
      issues.push(
        issue(
          `${path}.skills[${index}]`,
          "La skill está repetida en la tienda.",
        ),
      );
    }
    seenSkills.add(entry.skillId);

    const skill = skills.get(entry.skillId);
    if (!skill) {
      issues.push(
        issue(
          `${path}.skills[${index}].skillId`,
          "La skill de la tienda no existe.",
        ),
      );
      return;
    }
    if (skill.unlocked === true) {
      issues.push(
        issue(
          `${path}.skills[${index}].skillId`,
          `"${skill.name}" ya está desbloqueada para la campaña: no se podrá comprar.`,
          "warning",
        ),
      );
    }
  });

  return result(issues);
}

/**
 * Fase 4B — coherencia de una mazmorra frente al contenido de la campaña.
 * Zod ya acota la forma (kinds, ids); aquí se comprueban las referencias que
 * pueden romper la run: entrada inexistente, encuentros u objetos borrados.
 * Las salas sin encuentro y los cofres vacíos son avisos, no errores.
 */
export function validateDungeon(
  dungeon: Dungeon,
  content: Pick<CampaignContent, "items" | "skills" | "encounters">,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const path = `dungeons[${dungeon.id}]`;
  const encounters = groupById(content.encounters);
  const items = groupById(content.items);
  const skills = groupById(content.skills);
  const roomIds = new Set<string>();

  if (dungeon.rooms.length === 0) {
    issues.push(issue(`${path}.rooms`, "La mazmorra necesita al menos una sala."));
  }

  dungeon.rooms.forEach((room, index) => {
    const roomPath = `${path}.rooms[${index}]`;

    if (roomIds.has(room.id)) {
      issues.push(issue(`${roomPath}.id`, "ID de sala duplicado en la mazmorra."));
    }
    roomIds.add(room.id);

    if (room.encounterId) {
      if (!encounters.has(room.encounterId)) {
        issues.push(
          issue(`${roomPath}.encounterId`, "El encuentro de la sala no existe."),
        );
      }
    } else if (room.kind !== "rest" && room.kind !== "treasure") {
      issues.push(
        issue(
          roomPath,
          `"${room.name}" no tiene encuentro vinculado: será una sala de ambientación.`,
          "warning",
        ),
      );
    }

    if (room.kind === "treasure" && !room.rewards) {
      issues.push(
        issue(roomPath, `"${room.name}" no tiene recompensa de cofre.`, "warning"),
      );
    }

    (room.rewards?.itemIds ?? []).forEach((itemId, itemIndex) => {
      if (!items.has(itemId)) {
        issues.push(
          issue(
            `${roomPath}.rewards.itemIds[${itemIndex}]`,
            "La recompensa del cofre no existe.",
          ),
        );
      }
    });

    (room.rewards?.skillIds ?? []).forEach((skillId, skillIndex) => {
      if (!skills.has(skillId)) {
        issues.push(
          issue(
            `${roomPath}.rewards.skillIds[${skillIndex}]`,
            "La skill del cofre no existe.",
          ),
        );
      }
    });
  });

  if (dungeon.entryRoomId && !roomIds.has(dungeon.entryRoomId)) {
    issues.push(
      issue(`${path}.entryRoomId`, "La sala de entrada no existe en la mazmorra."),
    );
  }

  return result(issues);
}

/* -------------------------------------------------------------------------- */
/* Campaña completa                                                           */
/* -------------------------------------------------------------------------- */

export function validateContent(
  content: CampaignContent,
  rules: Ruleset = DEFAULT_RULES,
  settings?: Pick<CampaignSettings, "leveling">,
): ValidationResult {
  const issues: ValidationIssue[] = [
    ...findDuplicateIds(content.items, "items"),
    ...findDuplicateIds(content.skills, "skills"),
    ...findDuplicateIds(content.effects, "effects"),
    ...findDuplicateIds(content.characters, "characters"),
    ...findDuplicateIds(content.encounters, "encounters"),
    ...findDuplicateIds(content.specials, "specials"),
    ...findDuplicateIds(content.shops, "shops"),
    ...findDuplicateIds(content.dungeons, "dungeons"),
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
    issues.push(...validateCharacter(character, content, rules, settings).issues);
  }
  for (const encounter of content.encounters) {
    issues.push(...validateEncounter(encounter, content).issues);
  }
  for (const shop of content.shops) {
    issues.push(...validateShop(shop, content).issues);
  }
  for (const dungeon of content.dungeons) {
    issues.push(...validateDungeon(dungeon, content).issues);
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

  issues.push(
    ...validateContent(campaign.content, rules, campaign.settings).issues,
  );
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
    if (character.bossPhase?.skills?.includes(id)) {
      refs.push({
        label: `fase 2 de "${character.name}"`,
        id: character.id,
      });
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
    if (shop.skills?.some((entry) => entry.skillId === id)) {
      refs.push({ label: `tienda "${shop.name}"`, id: shop.id });
    }
  }

  for (const dungeon of content.dungeons) {
    if (dungeon.rooms.some((room) => room.encounterId === id)) {
      refs.push({ label: `mazmorra "${dungeon.name}"`, id: dungeon.id });
    }
    if (dungeon.rooms.some((room) => room.rewards?.itemIds?.includes(id))) {
      refs.push({
        label: `recompensa de la mazmorra "${dungeon.name}"`,
        id: dungeon.id,
      });
    }
    if (dungeon.rooms.some((room) => room.rewards?.skillIds?.includes(id))) {
      refs.push({
        label: `recompensa de la mazmorra "${dungeon.name}"`,
        id: dungeon.id,
      });
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
