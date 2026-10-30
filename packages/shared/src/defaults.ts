import type {
  CampaignContent,
  CampaignSettings,
  Character,
  CharacterKind,
  EffectDefinition,
  EffectTrigger,
  EquipmentSlot,
  LevelingSettings,
  Ruleset,
  StatKey,
  Stats,
  VisualMode,
} from "./types";

export const SCHEMA_VERSION = 1 as const;

/** Moneda de campaña. Nunca dinero real. */
export const CURRENCY_NAME = "Clean Shards";

/** Dados disponibles en la mesa (Fase 4E+). */
export const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

/** Bolsa inicial de la party: vacía. */
export const DEFAULT_WALLET = { cleanShards: 0 } as const;

export const DEFAULT_STATS: Stats = {
  hpMax: 50,
  def: 0,
  atk: 0,
  spd: 10,
  luck: 0,
  skillSlots: 2,
};

export const DEFAULT_RULES: Ruleset = {
  defenseConstant: 100,
  minDamage: 1,
  maxSkillSlots: 6,
  tieRule: "cancel_both",
  fullHeadsMultiplier: 2,
  luckCap: 0.9,
  luckFloor: 0.1,
  hpPersistence: "persist",
};

export const DEFAULT_BASE_CHARACTER_IMAGE = "/assets/base-character.png";

/** Capacidad inicial de Soul Points de cualquier personaje. */
export const BASE_SOUL_POINTS = 10;

/**
 * Progresión por nivel por defecto. Las campañas antiguas sin `leveling`
 * usan estos valores; los personajes sin nivel cuentan como nivel 1.
 */
export const DEFAULT_LEVELING: LevelingSettings = {
  hp: true,
  def: true,
  soulPoints: true,
  hpPerLevel: 5,
  defPerLevel: 1,
  soulPointsPerLevel: 2,
};

/** Mezcla la configuración guardada con los defaults (campañas viejas). */
export function resolveLeveling(
  leveling?: Partial<LevelingSettings> | null,
): LevelingSettings {
  return { ...DEFAULT_LEVELING, ...(leveling ?? {}) };
}

/** Nivel efectivo de una ficha: ausente/inválido = 1. */
export function characterLevel(
  character: Pick<Character, "level">,
): number {
  return Math.max(1, Math.trunc(character.level ?? 1));
}

export const DEFAULT_SETTINGS: CampaignSettings = {
  maxPlayers: 6,
  allowPlayerEdit: true,
  allowPlayerEditDuringCombat: false,
  allowPlayerSpecials: false,
  requirePin: false,
  baseCharacterImage: DEFAULT_BASE_CHARACTER_IMAGE,
  shareLoot: true,
  leveling: { ...DEFAULT_LEVELING },
};

/**
 * ¿El botín de objetos se duplica para cada jugador? Ausente = sí (Fase 3
 * no tenía la opción y las campañas viejas deben seguir igual).
 */
export function sharesLoot(settings: { shareLoot?: boolean }): boolean {
  return settings.shareLoot !== false;
}

export const EQUIPMENT_SLOTS = [
  "horns",
  "hand",
  "armor",
  "leg",
  "utility",
] as const satisfies readonly EquipmentSlot[];

export const CHARACTER_SKILL_SLOTS = 3;

export const STAT_KEYS = [
  "hpMax",
  "def",
  "atk",
  "spd",
  "luck",
  "skillSlots",
] as const satisfies readonly StatKey[];

export const STAT_LABELS: Record<StatKey, string> = {
  hpMax: "HP máx.",
  def: "DEF",
  atk: "ATK",
  spd: "SPD",
  luck: "LUCK",
  skillSlots: "Skill Slots",
};

export const STAT_HINTS: Record<StatKey, string> = {
  hpMax: "Puntos de vida máximos.",
  def: "Mitiga daño: DEF / (DEF + 100).",
  atk: "Se suma al daño de cada golpe.",
  spd: "Ordena los turnos; redirigir exige más SPD.",
  luck: "Puntos porcentuales de probabilidad de cara.",
  skillSlots: "Acciones por ronda (base 2, tope 6).",
};

export const EQUIPMENT_SLOT_LABELS: Record<EquipmentSlot, string> = {
  horns: "Cuernos",
  hand: "Mano",
  armor: "Armadura",
  leg: "Piernas",
  utility: "Utilidad",
};

export const VISUAL_MODE_LABELS: Record<VisualMode, string> = {
  portrait: "Sprite único",
  layered: "Capas",
};

/**
 * Modo por defecto del side-view híbrido:
 * enemigos y jefes → sprite único; el resto → capas.
 */
export function defaultVisualMode(kind: Character["kind"]): VisualMode {
  return kind === "enemy" || kind === "boss" ? "portrait" : "layered";
}

/**
 * Tipos que cuentan como enemigo a efectos de combate, encuentros,
 * recompensas y victoria/derrota. `boss` es un enemigo con cambio de fase.
 */
export function isEnemyKind(kind: CharacterKind): boolean {
  return kind === "enemy" || kind === "boss";
}

/** Modo efectivo respetando el campo de la ficha y su default por tipo. */
export function resolveVisualMode(
  character: Pick<Character, "kind" | "visualMode">,
): VisualMode {
  return character.visualMode ?? defaultVisualMode(character.kind);
}

/** HP actual efectivo: si la ficha no guarda uno, está a máximo. */
export function currentHp(
  character: Pick<Character, "hpCurrent">,
  hpMax: number,
): number {
  return clamp(character.hpCurrent ?? hpMax, 0, Math.max(0, hpMax));
}

export const EQUIPMENT_SLOT_HINTS: Record<EquipmentSlot, string> = {
  horns: "Identidad y rango.",
  hand: "Arma o herramienta.",
  armor: "Protección del torso.",
  leg: "Botas y soportes.",
  utility: "Objeto consumible de combate.",
};

export const EFFECT_TRIGGER_LABELS: Record<EffectTrigger, string> = {
  roundStart: "Inicio de ronda",
  roundEnd: "Fin de ronda",
  onUseSkill: "Al usar skill",
  onDealDamage: "Al golpear",
  onTakeDamage: "Al recibir daño",
  onClashWin: "Al ganar clash",
  onClashLose: "Al perder clash",
  onDefeat: "Al ser derrotado",
};

export const EFFECT_TRIGGERS = Object.keys(
  EFFECT_TRIGGER_LABELS,
) as EffectTrigger[];

export const DAMAGE_TYPE_LABELS = {
  physical: "Físico",
  mystic: "Místico",
  pure: "Puro",
} as const;

export const CHARACTER_KIND_LABELS = {
  player: "Jugador",
  npc: "NPC",
  enemy: "Enemigo",
  boss: "Jefe enemigo",
} as const;

export const STACK_MODE_LABELS = {
  add: "Acumular",
  refresh: "Refrescar",
  replace: "Reemplazar",
} as const;

export const TIE_RULE_LABELS = {
  cancel_both: "Se cancelan ambas acciones",
  defender_wins: "Gana el defensor",
  both_half: "Ambos hacen medio daño",
} as const;

export const HP_PERSISTENCE_LABELS = {
  persist: "Persistente entre combates",
  restore: "Se restaura al terminar",
} as const;

export function emptyContent(): CampaignContent {
  return {
    items: [],
    skills: [],
    effects: [],
    characters: [],
    encounters: [],
    specials: [],
    shops: [],
    dungeons: [],
  };
}

export function newCharacter(partial?: Partial<Character>): Character {
  return {
    id: newId("chr"),
    name: "Nuevo personaje",
    kind: "player",
    level: 1,
    baseStats: { ...DEFAULT_STATS },
    equipment: {
      horns: null,
      hand: null,
      armor: null,
      leg: null,
      utility: null,
    },
    skills: [null, null, null],
    inventory: [],
    ...partial,
  };
}

export function newEffect(partial?: Partial<EffectDefinition>): EffectDefinition {
  return {
    id: newId("eff"),
    name: "Nuevo efecto",
    maxStacks: 1,
    stackMode: "add",
    duration: { type: "turns", default: 3 },
    triggers: [],
    ...partial,
  };
}

export function cloneRules(rules: Ruleset = DEFAULT_RULES): Ruleset {
  return { ...rules };
}

export function cloneSettings(
  settings: CampaignSettings = DEFAULT_SETTINGS,
): CampaignSettings {
  return { ...settings };
}

/** ID interno con prefijo legible; estable e inmutable una vez creado. */
export function newId(prefix: string): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : fallbackUuid();
  return `${prefix}_${uuid.replaceAll("-", "").slice(0, 20)}`;
}

function fallbackUuid(): string {
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
