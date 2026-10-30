import type {
  Campaign,
  CampaignContent,
  CampaignSettings,
  CampaignWallet,
  Character,
  CombatRewardSummary,
  ContentType,
  DiceRoll,
  DiceSides,
  DiceThrowInput,
  Dungeon,
  DungeonInput,
  DungeonPatchInput,
  DungeonStartInput,
  EffectDefinition,
  Encounter,
  HostSessionResponse,
  Item,
  JoinSessionResponse,
  LootDraft,
  PublicDungeonRun,
  PublicSession,
  SessionInfo,
  SessionJoinInput,
  SessionStateResponse,
  Shop,
  ShopScene,
  Skill,
  SpecialAbility,
  ValidationIssue,
} from "@protocol-life/shared";
import { getSessionToken } from "./sessionAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface ContentEntityMap {
  items: Item;
  skills: Skill;
  effects: EffectDefinition;
  specials: SpecialAbility;
  characters: Character;
  encounters: Encounter;
}

export type ContentEntity = ContentEntityMap[ContentType];

/** `shops` y `dungeons` viven en `extras`, no en `content` (Fase 4). */
export type CampaignCounts = Record<ContentType | "shops" | "dungeons", number>;

export type CampaignSummary = {
  id: string;
  name: string;
  description?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  counts: CampaignCounts;
};

/**
 * Resultado de comprar en la escena de tienda (Fase 4A-3): `kind` distingue
 * la compra de un objeto de la de una skill (comprar una skill solo la
 * desbloquea para la campaña, no la equipa).
 */
export type ShopBuyResult =
  | {
      kind: "item";
      shop: ShopScene;
      wallet: CampaignWallet;
      item: Item;
      spent: number;
    }
  | {
      kind: "skill";
      shop: ShopScene;
      wallet: CampaignWallet;
      skill: Skill;
      spent: number;
    };

/** Abrir un cofre de la run (Fase 4C): run actualizada + lo entregado. */
export interface DungeonChestResult {
  run: PublicDungeonRun;
  rewards: CombatRewardSummary | null;
}

export interface CharacterSheet {
  character: Character;
  derived: unknown;
  items: Record<string, Item>;
  skills: Record<string, Skill>;
  specials: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const token = getSessionToken();
  if (token) headers.set("x-session-token", token);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "No se pudo conectar con el servidor local. ¿Está corriendo `npm run dev`?",
    );
  }

  if (!response.ok) {
    interface ErrorPayload {
      error?: {
        code?: string;
        message?: string;
        issues?: ValidationIssue[];
      };
    }
    let payload: ErrorPayload | null = null;
    try {
      payload = (await response.json()) as ErrorPayload;
    } catch {
      payload = null;
    }
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "request_failed",
      payload?.error?.message ?? `El servidor respondió ${response.status}.`,
      payload?.error?.issues,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const body = (value: unknown): string => JSON.stringify(value);

export const api = {
  listCampaigns(): Promise<CampaignSummary[]> {
    return request("/api/campaigns");
  },

  getCampaign(id: string): Promise<Campaign> {
    return request(`/api/campaigns/${id}`);
  },

  createCampaign(input: {
    name: string;
    description?: string;
    seed?: boolean;
    settings?: Partial<CampaignSettings>;
  }): Promise<Campaign> {
    return request("/api/campaigns", {
      method: "POST",
      body: body(input),
    });
  },

  patchCampaign(id: string, patch: unknown): Promise<Campaign> {
    return request(`/api/campaigns/${id}`, {
      method: "PATCH",
      body: body(patch),
    });
  },

  deleteCampaign(id: string): Promise<void> {
    return request(`/api/campaigns/${id}`, { method: "DELETE" });
  },

  /** Fase 3F: cura a la party fuera de combate. */
  restParty(campaignId: string): Promise<Campaign> {
    return request(`/api/campaigns/${campaignId}/rest-party`, {
      method: "POST",
    });
  },

  /* -------------------------------------------------------------------- */
  /* Fase 4A — tiendas y bolsa de la party                                */
  /* -------------------------------------------------------------------- */

  createShop(campaignId: string, input: unknown): Promise<Shop> {
    return request(`/api/campaigns/${campaignId}/shops`, {
      method: "POST",
      body: body(input),
    });
  },

  updateShop(campaignId: string, shopId: string, patch: unknown): Promise<Shop> {
    return request(`/api/campaigns/${campaignId}/shops/${shopId}`, {
      method: "PATCH",
      body: body(patch),
    });
  },

  deleteShop(campaignId: string, shopId: string): Promise<void> {
    return request(`/api/campaigns/${campaignId}/shops/${shopId}`, {
      method: "DELETE",
    });
  },

  adjustWallet(campaignId: string, delta: number): Promise<Campaign> {
    return request(`/api/campaigns/${campaignId}/wallet`, {
      method: "POST",
      body: body({ delta }),
    });
  },

  /* -------------------------------------------------------------------- */
  /* Fase 4B — mazmorras lineales                                         */
  /* -------------------------------------------------------------------- */

  listDungeons(campaignId: string): Promise<Dungeon[]> {
    return request(`/api/campaigns/${campaignId}/dungeons`);
  },

  createDungeon(campaignId: string, input: DungeonInput): Promise<Dungeon> {
    return request(`/api/campaigns/${campaignId}/dungeons`, {
      method: "POST",
      body: body(input),
    });
  },

  updateDungeon(
    campaignId: string,
    dungeonId: string,
    patch: DungeonPatchInput,
  ): Promise<Dungeon> {
    return request(`/api/campaigns/${campaignId}/dungeons/${dungeonId}`, {
      method: "PATCH",
      body: body(patch),
    });
  },

  deleteDungeon(campaignId: string, dungeonId: string): Promise<void> {
    return request(`/api/campaigns/${campaignId}/dungeons/${dungeonId}`, {
      method: "DELETE",
    });
  },

  /* -------------------------------------------------------------------- */
  /* Fase 4A-3 — escena de tienda en vivo                                 */
  /* -------------------------------------------------------------------- */

  getActiveShop(code: string): Promise<ShopScene | null> {
    return request(
      `/api/sessions/${encodeURIComponent(code)}/shop`,
    );
  },

  openShop(code: string, shopId: string): Promise<ShopScene> {
    return request(`/api/sessions/${encodeURIComponent(code)}/shop/open`, {
      method: "POST",
      body: body({ shopId }),
    });
  },

  closeShop(code: string): Promise<void> {
    return request(`/api/sessions/${encodeURIComponent(code)}/shop/close`, {
      method: "POST",
    });
  },

  buyShopItem(code: string, itemId: string): Promise<ShopBuyResult> {
    return request(`/api/sessions/${encodeURIComponent(code)}/shop/buy`, {
      method: "POST",
      body: body({ itemId }),
    });
  },

  buyShopSkill(code: string, skillId: string): Promise<ShopBuyResult> {
    return request(`/api/sessions/${encodeURIComponent(code)}/shop/buy`, {
      method: "POST",
      body: body({ skillId }),
    });
  },

  /* -------------------------------------------------------------------- */
  /* Fase 4C — run de mazmorra en vivo                                    */
  /* -------------------------------------------------------------------- */

  /** Run activa de la mesa, o `null` si no hay ninguna. */
  getDungeon(code: string): Promise<PublicDungeonRun | null> {
    return request(`/api/sessions/${encodeURIComponent(code)}/dungeon`);
  },

  /** Solo DM: inicia (o reinicia) la run; el servidor cierra la tienda. */
  startDungeon(
    code: string,
    dungeonId: string,
    entryRoomId?: string,
  ): Promise<PublicDungeonRun> {
    const input: DungeonStartInput = {
      dungeonId,
      ...(entryRoomId ? { entryRoomId } : {}),
    };
    return request(`/api/sessions/${encodeURIComponent(code)}/dungeon/start`, {
      method: "POST",
      body: body(input),
    });
  },

  /** Solo DM: lanza el encuentro vinculado a la sala actual. */
  startDungeonEncounter(code: string): Promise<PublicDungeonRun> {
    return request(
      `/api/sessions/${encodeURIComponent(code)}/dungeon/encounter`,
      { method: "POST" },
    );
  },

  /** Solo DM: descansa una vez y cura a la party. */
  restDungeon(code: string): Promise<PublicDungeonRun> {
    return request(`/api/sessions/${encodeURIComponent(code)}/dungeon/rest`, {
      method: "POST",
    });
  },

  /** Solo DM: abre el cofre de la sala actual (puede crear un reparto). */
  openDungeonChest(code: string): Promise<DungeonChestResult> {
    return request(`/api/sessions/${encodeURIComponent(code)}/dungeon/chest`, {
      method: "POST",
    });
  },

  /** Solo DM: pasa a la sala siguiente; `null` si era la última. */
  advanceDungeon(code: string): Promise<PublicDungeonRun | null> {
    return request(
      `/api/sessions/${encodeURIComponent(code)}/dungeon/advance`,
      { method: "POST" },
    );
  },

  /** Solo DM: termina la run y devuelve a los jugadores a su hoja. */
  endDungeon(code: string): Promise<void> {
    return request(`/api/sessions/${encodeURIComponent(code)}/dungeon/end`, {
      method: "POST",
    });
  },

  listContent<T extends ContentType>(
    campaignId: string,
    type: T,
  ): Promise<ContentEntityMap[T][]> {
    return request(`/api/campaigns/${campaignId}/${type}`);
  },

  createContent<T extends ContentType>(
    campaignId: string,
    type: T,
    input: unknown,
  ): Promise<ContentEntityMap[T]> {
    return request(`/api/campaigns/${campaignId}/${type}`, {
      method: "POST",
      body: body(input),
    });
  },

  patchContent<T extends ContentType>(
    type: T,
    id: string,
    patch: unknown,
  ): Promise<ContentEntityMap[T]> {
    return request(`/api/content/${type}/${id}`, {
      method: "PATCH",
      body: body(patch),
    });
  },

  deleteContent(type: ContentType, id: string): Promise<void> {
    return request(`/api/content/${type}/${id}`, { method: "DELETE" });
  },

  getSheet(campaignId: string, characterId: string): Promise<CharacterSheet> {
    return request(
      `/api/campaigns/${campaignId}/characters/${characterId}/sheet`,
    );
  },

  async exportCampaign(id: string, fallbackName: string): Promise<void> {
    const campaign = await request<Campaign>(`/api/campaigns/${id}/export`);
    const blob = new Blob([JSON.stringify(campaign, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName =
      fallbackName
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "campana";
    anchor.href = url;
    anchor.download = `protocol-life-${safeName}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  importCampaign(campaign: unknown): Promise<Campaign> {
    return request("/api/campaigns/import", {
      method: "POST",
      body: body(campaign),
    });
  },

  uploadImage(file: File): Promise<{ url: string; size: number; mime: string }> {
    const form = new FormData();
    form.append("file", file);
    return request("/api/uploads", { method: "POST", body: form });
  },

  /* -------------------------------------------------------------------- */
  /* Fase 2 — mesa en vivo                                                */
  /* -------------------------------------------------------------------- */

  hostSession(
    campaignId: string,
    input: { requirePin?: boolean; pin?: string } = {},
  ): Promise<HostSessionResponse & { lanIps: string[] }> {
    return request(`/api/campaigns/${campaignId}/session`, {
      method: "POST",
      body: body(input),
    });
  },

  getSessionInfo(code: string): Promise<SessionInfo> {
    return request(`/api/sessions/${encodeURIComponent(code)}`);
  },

  getSessionState(code: string): Promise<SessionStateResponse> {
    return request(`/api/sessions/${encodeURIComponent(code)}/state`);
  },

  joinSession(
    code: string,
    input: SessionJoinInput,
  ): Promise<JoinSessionResponse> {
    return request(`/api/sessions/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: body(input),
    });
  },

  leaveSession(code: string): Promise<PublicSession> {
    return request(`/api/sessions/${encodeURIComponent(code)}/leave`, {
      method: "POST",
    });
  },

  closeSession(code: string): Promise<void> {
    return request(`/api/sessions/${encodeURIComponent(code)}/close`, {
      method: "POST",
    });
  },

  /* -------------------------------------------------------------------- */
  /* Fase 4A-2 — reparto de botín por turnos                              */
  /* -------------------------------------------------------------------- */

  getLoot(code: string): Promise<LootDraft | null> {
    return request(`/api/sessions/${encodeURIComponent(code)}/loot`);
  },

  pickLoot(
    code: string,
    itemIndex: number,
  ): Promise<{ draft: LootDraft; itemId: string; character: Character }> {
    return request(`/api/sessions/${encodeURIComponent(code)}/loot/pick`, {
      method: "POST",
      body: body({ itemIndex }),
    });
  },

  skipLoot(code: string): Promise<LootDraft> {
    return request(`/api/sessions/${encodeURIComponent(code)}/loot/skip`, {
      method: "POST",
    });
  },

  closeLoot(code: string): Promise<LootDraft> {
    return request(`/api/sessions/${encodeURIComponent(code)}/loot/close`, {
      method: "POST",
    });
  },

  /* -------------------------------------------------------------------- */
  /* Dados de mesa (Fase 4E+)                                             */
  /* -------------------------------------------------------------------- */

  /**
   * Tirada compartida: el servidor decide el resultado y la emite a la sala.
   * `throwInput` es opcional; si se manda, la simulación usa esa dirección.
   */
  rollDice(
    code: string,
    sides: DiceSides,
    count = 1,
    throwInput?: DiceThrowInput,
  ): Promise<DiceRoll> {
    return request(`/api/sessions/${encodeURIComponent(code)}/dice`, {
      method: "POST",
      body: body({
        sides,
        count,
        ...(throwInput ? { throw: throwInput } : {}),
      }),
    });
  },

  getNetwork(): Promise<{ lanIps: string[] }> {
    return request("/api/network");
  },
};

export type { Campaign, CampaignContent };
