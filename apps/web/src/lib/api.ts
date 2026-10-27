import type {
  Campaign,
  CampaignContent,
  Character,
  ContentType,
  EffectDefinition,
  Encounter,
  HostSessionResponse,
  Item,
  JoinSessionResponse,
  PublicSession,
  SessionInfo,
  SessionJoinInput,
  SessionStateResponse,
  Skill,
  ValidationIssue,
} from "@protocol-life/shared";
import { getSessionToken } from "./sessionAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface ContentEntityMap {
  items: Item;
  skills: Skill;
  effects: EffectDefinition;
  characters: Character;
  encounters: Encounter;
}

export type ContentEntity = ContentEntityMap[ContentType];

export type CampaignSummary = {
  id: string;
  name: string;
  description?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  counts: Record<ContentType, number>;
};

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

  getNetwork(): Promise<{ lanIps: string[] }> {
    return request("/api/network");
  },
};

export type { Campaign, CampaignContent };
