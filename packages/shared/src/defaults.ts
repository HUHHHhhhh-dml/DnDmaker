import type {
  CampaignContent,
  CampaignSettings,
  Character,
  EffectDefinition,
  EffectTrigger,
  EquipmentSlot,
  Ruleset,
  StatKey,
  Stats,
} from "./types";

export const SCHEMA_VERSION = 1 as const;

/** Moneda de campaña. Nunca dinero real. */
export const CURRENCY_NAME = "Clean Shards";

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

export const DEFAULT_SETTINGS: CampaignSettings = {
  maxPlayers: 6,
  allowPlayerEdit: true,
  allowPlayerEditDuringCombat: false,
  requirePin: false,
  baseCharacterImage: DEFAULT_BASE_CHARACTER_IMAGE,
};

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
