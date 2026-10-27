import { count, desc, eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import {
  CONTENT_SCHEMAS,
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  calculateStats,
  emptyContent,
  findReferences,
  newId,
  validateCampaign,
  validateCharacter,
  validateContent,
  validateEffect,
  validateEncounter,
  validateItem,
  validateSkill,
  type Campaign,
  type CampaignContent,
  type CampaignSettings,
  type Character,
  type CharacterOverrides,
  type ContentType,
  type DerivedStats,
  type EffectAction,
  type EffectDefinition,
  type Encounter,
  type Item,
  type Ruleset,
  type Skill,
  type SpecialAbility,
  type ValidationResult,
} from "@protocol-life/shared";
import type { AppDatabase } from "./db";
import { campaigns, characters, effects, encounters, items, skills, specials } from "./schema";
import {
  SEED_CAMPAIGN_DESCRIPTION,
  SEED_CAMPAIGN_NAME,
  buildSeedContent,
} from "./seed";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface CampaignSummary {
  id: string;
  name: string;
  description?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  counts: Record<ContentType, number>;
}

export interface CharacterSheet {
  character: Character;
  derived: DerivedStats;
  items: Record<string, Item>;
  skills: Record<string, Skill>;
  specials: Record<string, SpecialAbility>;
}

type EntityByType = {
  items: Item;
  skills: Skill;
  effects: EffectDefinition;
  characters: Character;
  encounters: Encounter;
};

type ContentEntity = Item | Skill | EffectDefinition | Character | Encounter;

const PREFIX: Record<ContentType, string> = {
  items: "itm",
  skills: "skl",
  effects: "eff",
  characters: "chr",
  encounters: "enc",
};

const nowIso = (): string => new Date().toISOString();

function assertRules(rules: Ruleset): void {
  if (rules.luckFloor > rules.luckCap) {
    throw new HttpError(
      422,
      "invalid_rules",
      "El suelo de suerte no puede superar al techo.",
      [
        {
          path: "rules.luckFloor",
          message: "El suelo de suerte no puede superar al techo.",
          severity: "error",
        },
      ],
    );
  }
}

function assertValid(result: ValidationResult, label: string): void {
  if (result.valid) return;
  throw new HttpError(
    422,
    "validation_failed",
    `No se pudo guardar ${label}: revisa los datos.`,
    result.issues,
  );
}

function validateEntity(
  type: ContentType,
  entity: ContentEntity,
  content: CampaignContent,
  rules: Ruleset,
): ValidationResult {
  switch (type) {
    case "items":
      return validateItem(entity as Item, content);
    case "skills":
      return validateSkill(entity as Skill, content);
    case "effects":
      return validateEffect(entity as EffectDefinition, content);
    case "characters":
      return validateCharacter(entity as Character, content, rules);
    case "encounters":
      return validateEncounter(entity as Encounter, content);
  }
}

export class Repository {
  constructor(
    private readonly db: AppDatabase,
    private readonly sqlite: Database.Database,
  ) {}

  /**
   * Transacción de SQLite para operaciones de dominio que tocan varias
   * tablas. `better-sqlite3` soporta anidamiento por savepoints, así que las
   * transacciones internas de cada método siguen siendo válidas.
   */
  transaction<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)();
  }

  /* ---------------------------------------------------------------------- */
  /* Campañas                                                               */
  /* ---------------------------------------------------------------------- */

  listCampaigns(): CampaignSummary[] {
    const rows = this.db
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.updatedAt))
      .all();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      schemaVersion: row.schemaVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      counts: {
        items: this.countRows(items, row.id),
        skills: this.countRows(skills, row.id),
        effects: this.countRows(effects, row.id),
        characters: this.countRows(characters, row.id),
        encounters: this.countRows(encounters, row.id),
      },
    }));
  }

  campaignExists(id: string): boolean {
    return Boolean(this.db.select().from(campaigns).where(eq(campaigns.id, id)).get());
  }

  getCampaign(id: string): Campaign {
    const row = this.db.select().from(campaigns).where(eq(campaigns.id, id)).get();
    if (!row) throw new HttpError(404, "campaign_not_found", "La campaña no existe.");

    const extras = row.extras ?? { shops: [], dungeons: [] };
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      schemaVersion: SCHEMA_VERSION,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      rules: row.rules,
      settings: row.settings,
      content: {
        ...emptyContent(),
        items: this.listContent("items", id),
        skills: this.listContent("skills", id),
        effects: this.listContent("effects", id),
        characters: this.listContent("characters", id),
        encounters: this.listContent("encounters", id),
        specials: this.listSpecials(id),
        shops: (extras.shops ?? []) as CampaignContent["shops"],
        dungeons: (extras.dungeons ?? []) as CampaignContent["dungeons"],
      },
    };
  }

  createCampaign(input: {
    name: string;
    description?: string;
    rules?: Partial<Ruleset>;
    settings?: Partial<CampaignSettings>;
    seed?: boolean;
  }): Campaign {
    const id = newId("cmp");
    const now = nowIso();
    const rules: Ruleset = { ...DEFAULT_RULES, ...input.rules };
    const settings: CampaignSettings = {
      ...DEFAULT_SETTINGS,
      ...input.settings,
    };
    assertRules(rules);
    const content = input.seed === false ? emptyContent() : buildSeedContent();

    this.sqlite.transaction(() => {
      this.db
        .insert(campaigns)
        .values({
          id,
          name: input.name,
          description: input.description ?? null,
          schemaVersion: SCHEMA_VERSION,
          rules,
          settings,
          extras: { shops: [], dungeons: [] },
          createdAt: now,
          updatedAt: now,
        })
        .run();
      this.insertContent(id, content, now);
    })();

    return this.getCampaign(id);
  }

  updateCampaign(
    id: string,
    patch: {
      name?: string;
      description?: string;
      rules?: Partial<Ruleset>;
      settings?: Partial<CampaignSettings>;
    },
  ): Campaign {
    const current = this.getCampaign(id);
    const now = nowIso();
    const rules = { ...current.rules, ...patch.rules };
    assertRules(rules);
    this.db
      .update(campaigns)
      .set({
        name: patch.name ?? current.name,
        description:
          patch.description !== undefined ? patch.description : (current.description ?? null),
        rules,
        settings: { ...current.settings, ...patch.settings },
        updatedAt: now,
      })
      .where(eq(campaigns.id, id))
      .run();
    return this.getCampaign(id);
  }

  deleteCampaign(id: string): void {
    if (!this.campaignExists(id)) {
      throw new HttpError(404, "campaign_not_found", "La campaña no existe.");
    }
    this.db.delete(campaigns).where(eq(campaigns.id, id)).run();
  }

  ensureSeedCampaign(): Campaign | null {
    const existing = this.db.select().from(campaigns).limit(1).get();
    if (existing) return null;
    return this.createCampaign({
      name: SEED_CAMPAIGN_NAME,
      description: SEED_CAMPAIGN_DESCRIPTION,
      seed: true,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Contenido                                                              */
  /* ---------------------------------------------------------------------- */

  listContent<T extends ContentType>(type: T, campaignId: string): EntityByType[T][] {
    switch (type) {
      case "items":
        return this.db
          .select()
          .from(items)
          .where(eq(items.campaignId, campaignId))
          .orderBy(items.createdAt)
          .all()
          .map((row) => row.data) as EntityByType[T][];
      case "skills":
        return this.db
          .select()
          .from(skills)
          .where(eq(skills.campaignId, campaignId))
          .orderBy(skills.createdAt)
          .all()
          .map((row) => row.data) as EntityByType[T][];
      case "effects":
        return this.db
          .select()
          .from(effects)
          .where(eq(effects.campaignId, campaignId))
          .orderBy(effects.createdAt)
          .all()
          .map((row) => row.data) as EntityByType[T][];
      case "characters":
        return this.db
          .select()
          .from(characters)
          .where(eq(characters.campaignId, campaignId))
          .orderBy(characters.createdAt)
          .all()
          .map((row) => row.data) as EntityByType[T][];
      case "encounters":
        return this.db
          .select()
          .from(encounters)
          .where(eq(encounters.campaignId, campaignId))
          .orderBy(encounters.createdAt)
          .all()
          .map((row) => row.data) as EntityByType[T][];
      default: {
        const exhaustive: never = type;
        throw new Error(`Tipo de contenido desconocido: ${String(exhaustive)}`);
      }
    }
  }

  listSpecials(campaignId: string): SpecialAbility[] {
    return this.db
      .select()
      .from(specials)
      .where(eq(specials.campaignId, campaignId))
      .orderBy(specials.createdAt)
      .all()
      .map((row) => row.data as SpecialAbility);
  }

  getContent<T extends ContentType>(type: T, id: string): EntityByType[T] {
    const entity = this.findContent(type, id);
    if (!entity) {
      throw new HttpError(404, "content_not_found", "El contenido no existe.");
    }
    return entity;
  }

  createContent<T extends ContentType>(
    type: T,
    campaignId: string,
    input: unknown,
  ): EntityByType[T] {
    const campaign = this.getCampaign(campaignId);
    const parsed = CONTENT_SCHEMAS[type].input.parse(input) as Record<string, unknown>;
    const entity = {
      ...parsed,
      id: newId(PREFIX[type]),
    } as unknown as EntityByType[T];

    assertValid(
      validateEntity(type, entity as ContentEntity, campaign.content, campaign.rules),
      "el contenido",
    );

    const now = nowIso();
    this.sqlite.transaction(() => {
      this.insertEntity(type, campaignId, entity as ContentEntity, now);
      this.touchCampaign(campaignId, now);
    })();

    return entity;
  }

  updateContent<T extends ContentType>(
    type: T,
    id: string,
    patch: unknown,
  ): EntityByType[T] {
    const campaign = this.getCampaignForContent(type, id);
    const existing = this.getContent(type, id);
    const parsedPatch = CONTENT_SCHEMAS[type].patch.parse(patch) as Record<string, unknown>;

    const merged: Record<string, unknown> = {
      ...(existing as unknown as Record<string, unknown>),
      ...parsedPatch,
      id,
    };

    // Merge de objetos anidados que la UI edita por partes.
    if (type === "characters") {
      const base = existing as Character;
      if (parsedPatch.baseStats) {
        merged.baseStats = { ...base.baseStats, ...(parsedPatch.baseStats as object) };
      }
      if (parsedPatch.equipment) {
        merged.equipment = { ...base.equipment, ...(parsedPatch.equipment as object) };
      }
      if (parsedPatch.special) {
        merged.special = { ...(base.special ?? {}), ...(parsedPatch.special as object) };
      }
    }

    const entity = CONTENT_SCHEMAS[type].entity.parse(merged) as unknown as EntityByType[T];
    assertValid(
      validateEntity(type, entity as ContentEntity, campaign.content, campaign.rules),
      "el contenido",
    );

    const now = nowIso();
    this.sqlite.transaction(() => {
      this.updateEntity(type, id, entity as ContentEntity, now);
      this.touchCampaign(campaign.id, now);
    })();

    return entity;
  }

  deleteContent(type: ContentType, id: string): void {
    const campaign = this.getCampaignForContent(type, id);
    const refs = findReferences(id, campaign.content).filter((ref) => ref.id !== id);
    if (refs.length > 0) {
      const labels = refs
        .slice(0, 5)
        .map((ref) => `${ref.label}`)
        .join(", ");
      throw new HttpError(
        409,
        "content_referenced",
        `No se puede borrar: lo usa ${labels}${refs.length > 5 ? " y más" : ""}.`,
        refs,
      );
    }

    const now = nowIso();
    this.sqlite.transaction(() => {
      switch (type) {
        case "items":
          this.db.delete(items).where(eq(items.id, id)).run();
          break;
        case "skills":
          this.db.delete(skills).where(eq(skills.id, id)).run();
          break;
        case "effects":
          this.db.delete(effects).where(eq(effects.id, id)).run();
          break;
        case "characters":
          this.db.delete(characters).where(eq(characters.id, id)).run();
          break;
        case "encounters":
          this.db.delete(encounters).where(eq(encounters.id, id)).run();
          break;
      }
      this.touchCampaign(campaign.id, now);
    })();
  }

  /** Campaña a la que pertenece una entidad (para permisos de sesión). */
  getContentCampaignId(type: ContentType, id: string): string {
    const row = this.findContentRow(type, id);
    if (!row) {
      throw new HttpError(404, "content_not_found", "El contenido no existe.");
    }
    return row.campaignId;
  }

  /**
   * Asigna o libera el dueño de un personaje. Se usa al entrar/salir de una
   * sesión para que los jugadores puedan reclamar su ficha.
   */
  setCharacterOwner(characterId: string, ownerId: string | null): Character {
    const row = this.findContentRow("characters", characterId);
    if (!row) {
      throw new HttpError(404, "content_not_found", "El personaje no existe.");
    }
    const current = row.data as Character;
    const next: Character = { ...current };
    if (ownerId) next.ownerId = ownerId;
    else delete next.ownerId;

    const parsed = CONTENT_SCHEMAS.characters.entity.parse(next) as Character;
    const now = nowIso();
    this.sqlite.transaction(() => {
      this.updateEntity("characters", characterId, parsed, now);
      this.touchCampaign(row.campaignId, now);
    })();
    return parsed;
  }

  /**
   * Persiste el HP actual de una ficha al terminar un combate. Es una
   * escritura interna del motor: no pasa por los permisos de contenido y se
   * usa solo cuando la fase ya está en `ended`.
   */
  setCharacterCurrentHp(characterId: string, hpCurrent: number): Character {
    const row = this.findContentRow("characters", characterId);
    if (!row) {
      throw new HttpError(404, "character_not_found", "El personaje no existe.");
    }
    const current = row.data as Character;
    const next: Character = {
      ...current,
      hpCurrent: Math.max(0, Math.round(hpCurrent)),
    };
    const parsed = CONTENT_SCHEMAS.characters.entity.parse(next) as Character;
    const now = nowIso();
    this.sqlite.transaction(() => {
      this.updateEntity("characters", characterId, parsed, now);
      this.touchCampaign(row.campaignId, now);
    })();
    return parsed;
  }

  /**
   * "Rest party" fuera de combate (Fase 3F): cura al máximo a las fichas de
   * la party (player/npc). Es la única escritura de HP junto con el cierre de
   * `CombatService.endEncounter`; las rutas la bloquean durante el combate.
   */
  restParty(campaignId: string): Campaign {
    const campaign = this.getCampaign(campaignId);
    const now = nowIso();
    this.sqlite.transaction(() => {
      for (const character of campaign.content.characters) {
        if (character.kind === "enemy") continue;
        const derived = calculateStats(
          character,
          campaign.content,
          campaign.rules,
        );
        const next = CONTENT_SCHEMAS.characters.entity.parse({
          ...character,
          hpCurrent: derived.stats.hpMax,
        }) as Character;
        this.updateEntity("characters", character.id, next, now);
      }
      this.touchCampaign(campaignId, now);
    })();
    return this.getCampaign(campaignId);
  }

  getCharacterSheet(campaignId: string, characterId: string): CharacterSheet {
    const campaign = this.getCampaign(campaignId);
    const character = this.getContent("characters", characterId);
    if (!campaign.content.characters.some((entry) => entry.id === characterId)) {
      throw new HttpError(404, "content_not_found", "El personaje no existe en la campaña.");
    }

    const itemMap = Object.fromEntries(
      campaign.content.items.map((item) => [item.id, item]),
    );
    const skillMap = Object.fromEntries(
      campaign.content.skills.map((skill) => [skill.id, skill]),
    );
    const specialMap = Object.fromEntries(
      campaign.content.specials.map((special) => [special.id, special]),
    );

    const derived = calculateStats(character, campaign.content, campaign.rules);
    return { character, derived, items: itemMap, skills: skillMap, specials: specialMap };
  }

  /* ---------------------------------------------------------------------- */
  /* Export / import                                                        */
  /* ---------------------------------------------------------------------- */

  exportCampaign(id: string): Campaign {
    // Exportamos aunque haya avisos de validación; el import los revalidará.
    return this.getCampaign(id);
  }

  importCampaign(imported: Campaign): Campaign {
    const validation = validateCampaign(imported);
    if (!validation.valid) {
      throw new HttpError(
        422,
        "invalid_import",
        "La campaña importada tiene referencias rotas o datos inválidos.",
        validation.issues,
      );
    }

    const content = remapContent(imported.content);
    const campaignId = newId("cmp");
    const now = nowIso();
    const rules = imported.rules;
    const settings = imported.settings;

    assertValid(validateContent(content, rules), "la campaña importada");

    this.sqlite.transaction(() => {
      this.db
        .insert(campaigns)
        .values({
          id: campaignId,
          name: imported.name,
          description: imported.description ?? null,
          schemaVersion: SCHEMA_VERSION,
          rules,
          settings,
          extras: {
            shops: content.shops,
            dungeons: content.dungeons,
          },
          createdAt: now,
          updatedAt: now,
        })
        .run();
      this.insertContent(campaignId, content, now);
    })();

    return this.getCampaign(campaignId);
  }

  /* ---------------------------------------------------------------------- */
  /* Internos                                                               */
  /* ---------------------------------------------------------------------- */

  private countRows(
    table: typeof items | typeof skills | typeof effects | typeof characters | typeof encounters,
    campaignId: string,
  ): number {
    const row = this.db
      .select({ value: count() })
      .from(table as typeof items)
      .where(eq((table as typeof items).campaignId, campaignId))
      .get();
    return row?.value ?? 0;
  }

  private findContent<T extends ContentType>(
    type: T,
    id: string,
  ): EntityByType[T] | null {
    switch (type) {
      case "items": {
        const row = this.db.select().from(items).where(eq(items.id, id)).get();
        return (row?.data ?? null) as EntityByType[T] | null;
      }
      case "skills": {
        const row = this.db.select().from(skills).where(eq(skills.id, id)).get();
        return (row?.data ?? null) as EntityByType[T] | null;
      }
      case "effects": {
        const row = this.db.select().from(effects).where(eq(effects.id, id)).get();
        return (row?.data ?? null) as EntityByType[T] | null;
      }
      case "characters": {
        const row = this.db.select().from(characters).where(eq(characters.id, id)).get();
        return (row?.data ?? null) as EntityByType[T] | null;
      }
      case "encounters": {
        const row = this.db.select().from(encounters).where(eq(encounters.id, id)).get();
        return (row?.data ?? null) as EntityByType[T] | null;
      }
      default: {
        const exhaustive: never = type;
        throw new Error(`Tipo de contenido desconocido: ${String(exhaustive)}`);
      }
    }
  }

  private findContentRow(type: ContentType, id: string) {
    switch (type) {
      case "items":
        return this.db.select().from(items).where(eq(items.id, id)).get();
      case "skills":
        return this.db.select().from(skills).where(eq(skills.id, id)).get();
      case "effects":
        return this.db.select().from(effects).where(eq(effects.id, id)).get();
      case "characters":
        return this.db.select().from(characters).where(eq(characters.id, id)).get();
      case "encounters":
        return this.db.select().from(encounters).where(eq(encounters.id, id)).get();
    }
  }

  private getCampaignForContent(type: ContentType, id: string): Campaign {
    const row = this.findContentRow(type, id);
    if (!row) {
      throw new HttpError(404, "content_not_found", "El contenido no existe.");
    }
    return this.getCampaign(row.campaignId);
  }

  private touchCampaign(campaignId: string, now: string): void {
    this.db
      .update(campaigns)
      .set({ updatedAt: now })
      .where(eq(campaigns.id, campaignId))
      .run();
  }

  private insertContent(campaignId: string, content: CampaignContent, now: string): void {
    for (const item of content.items) this.insertEntity("items", campaignId, item, now);
    for (const skill of content.skills) this.insertEntity("skills", campaignId, skill, now);
    for (const effect of content.effects) this.insertEntity("effects", campaignId, effect, now);
    for (const character of content.characters) {
      this.insertEntity("characters", campaignId, character, now);
    }
    for (const encounter of content.encounters) {
      this.insertEntity("encounters", campaignId, encounter, now);
    }
    for (const special of content.specials) {
      this.db
        .insert(specials)
        .values({
          id: special.id,
          campaignId,
          name: special.name,
          code: special.code ?? null,
          data: special,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  private insertEntity(
    type: ContentType,
    campaignId: string,
    entity: ContentEntity,
    now: string,
  ): void {
    switch (type) {
      case "items": {
        const item = entity as Item;
        this.db
          .insert(items)
          .values({
            id: item.id,
            campaignId,
            name: item.name,
            code: item.code ?? null,
            slot: item.slot,
            rarity: item.rarity ?? null,
            image: item.image ?? null,
            data: item,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        break;
      }
      case "skills": {
        const skill = entity as Skill;
        this.db
          .insert(skills)
          .values({
            id: skill.id,
            campaignId,
            name: skill.name,
            code: skill.code ?? null,
            image: skill.image ?? null,
            data: skill,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        break;
      }
      case "effects": {
        const effect = entity as EffectDefinition;
        this.db
          .insert(effects)
          .values({
            id: effect.id,
            campaignId,
            name: effect.name,
            code: effect.code ?? null,
            data: effect,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        break;
      }
      case "characters": {
        const character = entity as Character;
        this.db
          .insert(characters)
          .values({
            id: character.id,
            campaignId,
            name: character.name,
            kind: character.kind,
            data: character,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        break;
      }
      case "encounters": {
        const encounter = entity as Encounter;
        this.db
          .insert(encounters)
          .values({
            id: encounter.id,
            campaignId,
            name: encounter.name,
            data: encounter,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        break;
      }
    }
  }

  private updateEntity(
    type: ContentType,
    id: string,
    entity: ContentEntity,
    now: string,
  ): void {
    switch (type) {
      case "items": {
        const item = entity as Item;
        this.db
          .update(items)
          .set({
            name: item.name,
            code: item.code ?? null,
            slot: item.slot,
            rarity: item.rarity ?? null,
            image: item.image ?? null,
            data: item,
            updatedAt: now,
          })
          .where(eq(items.id, id))
          .run();
        break;
      }
      case "skills": {
        const skill = entity as Skill;
        this.db
          .update(skills)
          .set({
            name: skill.name,
            code: skill.code ?? null,
            image: skill.image ?? null,
            data: skill,
            updatedAt: now,
          })
          .where(eq(skills.id, id))
          .run();
        break;
      }
      case "effects": {
        const effect = entity as EffectDefinition;
        this.db
          .update(effects)
          .set({
            name: effect.name,
            code: effect.code ?? null,
            data: effect,
            updatedAt: now,
          })
          .where(eq(effects.id, id))
          .run();
        break;
      }
      case "characters": {
        const character = entity as Character;
        this.db
          .update(characters)
          .set({
            name: character.name,
            kind: character.kind,
            data: character,
            updatedAt: now,
          })
          .where(eq(characters.id, id))
          .run();
        break;
      }
      case "encounters": {
        const encounter = entity as Encounter;
        this.db
          .update(encounters)
          .set({
            name: encounter.name,
            data: encounter,
            updatedAt: now,
          })
          .where(eq(encounters.id, id))
          .run();
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Remapeo de IDs para import                                             */
/* ------------------------------------------------------------------------ */

function remapContent(content: CampaignContent): CampaignContent {
  const map = new Map<string, string>();
  const register = <T extends { id: string }>(entries: T[], prefix: string): void => {
    for (const entry of entries) map.set(entry.id, newId(prefix));
  };

  register(content.items, "itm");
  register(content.skills, "skl");
  register(content.effects, "eff");
  register(content.characters, "chr");
  register(content.encounters, "enc");
  register(content.specials, "spc");

  const mapId = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return map.get(id) ?? id;
  };
  const mapIdRequired = (id: string): string => map.get(id) ?? id;

  const mapActions = (actions: EffectAction[]): EffectAction[] =>
    actions.map((action) =>
      action.type === "applyEffect"
        ? { ...action, effectId: mapIdRequired(action.effectId) }
        : action,
    );

  const mapOverrides = (
    overrides: CharacterOverrides | undefined,
  ): CharacterOverrides | undefined => {
    if (!overrides) return undefined;
    return {
      ...overrides,
      // Solo se remapean las claves presentes: un override parcial no debe
      // rellenar los slots de equipo que no toca.
      equipment: overrides.equipment
        ? (Object.fromEntries(
            Object.entries(overrides.equipment).map(([slot, itemId]) => [
              slot,
              mapId(itemId),
            ]),
          ) as CharacterOverrides["equipment"])
        : undefined,
      skills: overrides.skills?.map((skillId) => mapId(skillId)) as (string | null)[] | undefined,
      special: overrides.special
        ? (Object.fromEntries(
            Object.entries(overrides.special).map(([key, specialId]) => [
              key,
              mapId(specialId),
            ]),
          ) as CharacterOverrides["special"])
        : undefined,
      inventory: overrides.inventory?.map((entry) => ({
        ...entry,
        itemId: mapIdRequired(entry.itemId),
      })),
    };
  };

  return {
    items: content.items.map((item) => ({
      ...item,
      id: mapIdRequired(item.id),
      effects: item.effects?.map((ref) => ({
        ...ref,
        effectId: mapIdRequired(ref.effectId),
      })),
      useEffect: item.useEffect ? mapActions(item.useEffect) : undefined,
    })),
    skills: content.skills.map((skill) => ({
      ...skill,
      id: mapIdRequired(skill.id),
      effects: skill.effects?.map((ref) => ({
        ...ref,
        effectId: mapIdRequired(ref.effectId),
      })),
    })),
    effects: content.effects.map((effect) => ({
      ...effect,
      id: mapIdRequired(effect.id),
      triggers: effect.triggers.map((trigger) => ({
        ...trigger,
        actions: mapActions(trigger.actions),
      })),
    })),
    characters: content.characters.map((character) => ({
      ...character,
      id: mapIdRequired(character.id),
      equipment: {
        horns: mapId(character.equipment.horns),
        hand: mapId(character.equipment.hand),
        armor: mapId(character.equipment.armor),
        leg: mapId(character.equipment.leg),
        utility: mapId(character.equipment.utility),
      },
      skills: character.skills.map((skillId) => mapId(skillId)),
      special: character.special
        ? {
            domainId: mapId(character.special.domainId),
            habitatId: mapId(character.special.habitatId),
          }
        : undefined,
      inventory: character.inventory.map((entry) => ({
        ...entry,
        itemId: mapIdRequired(entry.itemId),
      })),
    })),
    encounters: content.encounters.map((encounter) => ({
      ...encounter,
      id: mapIdRequired(encounter.id),
      enemies: encounter.enemies.map((enemy) => ({
        ...enemy,
        characterId: mapIdRequired(enemy.characterId),
        overrides: mapOverrides(enemy.overrides),
      })),
      rewards: encounter.rewards
        ? {
            ...encounter.rewards,
            itemIds: encounter.rewards.itemIds?.map(mapIdRequired),
          }
        : undefined,
    })),
    specials: content.specials.map((special) => ({
      ...special,
      id: mapIdRequired(special.id),
      effects: mapActions(special.effects),
    })),
    shops: content.shops.map((shop) => ({
      ...shop,
      items: shop.items.map((entry) => ({
        ...entry,
        itemId: mapIdRequired(entry.itemId),
      })),
    })),
    dungeons: content.dungeons.map((dungeon) => ({
      ...dungeon,
      entryRoomId: dungeon.entryRoomId,
      rooms: dungeon.rooms.map((room) => ({
        ...room,
        encounterId: room.encounterId ? mapIdRequired(room.encounterId) : undefined,
      })),
    })),
  };
}
