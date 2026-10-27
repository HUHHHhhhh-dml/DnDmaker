import { create } from "zustand";
import type {
  Campaign,
  CampaignSettings,
  ContentType,
  EffectDefinition,
  Item,
} from "@protocol-life/shared";
import {
  ApiError,
  api,
  type CampaignSummary,
  type ContentEntity,
  type ContentEntityMap,
} from "../lib/api";

const ACTIVE_KEY = "protocol-life:active-campaign";

export interface Notice {
  kind: "ok" | "error" | "info";
  message: string;
  id: number;
}

interface AppState {
  campaigns: CampaignSummary[];
  campaign: Campaign | null;
  activeCampaignId: string | null;
  bootLoading: boolean;
  campaignLoading: boolean;
  busy: boolean;
  error: string | null;
  notice: Notice | null;

  loadAll: () => Promise<void>;
  selectCampaign: (id: string) => Promise<void>;
  refreshCampaign: () => Promise<void>;
  createCampaign: (input: {
    name: string;
    description?: string;
    seed?: boolean;
    settings?: Partial<CampaignSettings>;
  }) => Promise<Campaign>;
  updateCampaign: (patch: unknown) => Promise<Campaign>;
  deleteCampaign: (id: string) => Promise<void>;

  saveContent: <T extends ContentType>(
    type: T,
    input: unknown,
    id?: string,
  ) => Promise<ContentEntityMap[T]>;
  removeContent: (type: ContentType, id: string) => Promise<void>;

  uploadImage: (file: File) => Promise<string>;
  exportCampaign: () => Promise<void>;
  importCampaign: (file: File) => Promise<Campaign>;

  notify: (kind: Notice["kind"], message: string) => void;
  clearNotice: () => void;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.issues?.length) {
      return `${error.message} ${error.issues
        .slice(0, 2)
        .map((issue) => issue.message)
        .join(" · ")}`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Algo salió mal.";
}

function readStoredCampaignId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeStoredCampaignId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // localStorage puede no estar disponible; no es la fuente de verdad.
  }
}

function countsFor(campaign: Campaign): Record<ContentType, number> {
  return {
    items: campaign.content.items.length,
    skills: campaign.content.skills.length,
    effects: campaign.content.effects.length,
    characters: campaign.content.characters.length,
    encounters: campaign.content.encounters.length,
  };
}

function upsertContent(
  campaign: Campaign,
  type: ContentType,
  entity: ContentEntity,
): Campaign {
  const replace = <T extends { id: string }>(list: T[]): T[] => {
    const index = list.findIndex((entry) => entry.id === entity.id);
    if (index === -1) return [...list, entity as unknown as T];
    const next = [...list];
    next[index] = entity as unknown as T;
    return next;
  };

  switch (type) {
    case "items":
      return {
        ...campaign,
        content: { ...campaign.content, items: replace<Item>(campaign.content.items) },
      };
    case "skills":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          skills: replace(campaign.content.skills),
        },
      };
    case "effects":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          effects: replace<EffectDefinition>(campaign.content.effects),
        },
      };
    case "characters":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          characters: replace(campaign.content.characters),
        },
      };
    case "encounters":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          encounters: replace(campaign.content.encounters),
        },
      };
  }
}

function removeContentFromCampaign(
  campaign: Campaign,
  type: ContentType,
  id: string,
): Campaign {
  switch (type) {
    case "items":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          items: campaign.content.items.filter((entry) => entry.id !== id),
        },
      };
    case "skills":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          skills: campaign.content.skills.filter((entry) => entry.id !== id),
        },
      };
    case "effects":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          effects: campaign.content.effects.filter((entry) => entry.id !== id),
        },
      };
    case "characters":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          characters: campaign.content.characters.filter((entry) => entry.id !== id),
        },
      };
    case "encounters":
      return {
        ...campaign,
        content: {
          ...campaign.content,
          encounters: campaign.content.encounters.filter((entry) => entry.id !== id),
        },
      };
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  campaigns: [],
  campaign: null,
  activeCampaignId: null,
  bootLoading: true,
  campaignLoading: false,
  busy: false,
  error: null,
  notice: null,

  notify: (kind, message) => {
    set({ notice: { kind, message, id: Date.now() } });
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      set((state) =>
        state.notice?.message === message ? { notice: null } : {},
      );
    }, 5000);
  },

  clearNotice: () => set({ notice: null }),

  async loadAll() {
    set({ bootLoading: true, error: null });
    try {
      const campaigns = await api.listCampaigns();
      set({ campaigns });

      const stored = readStoredCampaignId();
      const preferred =
        (stored && campaigns.find((entry) => entry.id === stored)?.id) ??
        campaigns[0]?.id;

      if (preferred) {
        await get().selectCampaign(preferred);
      } else {
        set({ campaign: null, activeCampaignId: null });
      }
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ bootLoading: false });
    }
  },

  async selectCampaign(id) {
    set({ campaignLoading: true, error: null });
    try {
      const campaign = await api.getCampaign(id);
      set({ campaign, activeCampaignId: campaign.id });
      writeStoredCampaignId(campaign.id);
    } catch (error) {
      const message = describeError(error);
      set({ error: message, campaign: null, activeCampaignId: null });
      get().notify("error", message);
    } finally {
      set({ campaignLoading: false });
    }
  },

  async refreshCampaign() {
    const id = get().activeCampaignId;
    if (!id) return;
    try {
      const campaign = await api.getCampaign(id);
      set((state) => ({
        campaign,
        campaigns: state.campaigns.map((entry) =>
          entry.id === campaign.id
            ? {
                ...entry,
                name: campaign.name,
                description: campaign.description,
                updatedAt: campaign.updatedAt,
                counts: countsFor(campaign),
              }
            : entry,
        ),
      }));
    } catch (error) {
      get().notify("error", describeError(error));
    }
  },

  async createCampaign(input) {
    set({ busy: true });
    try {
      const campaign = await api.createCampaign(input);
      const campaigns = await api.listCampaigns();
      set({ campaigns, campaign, activeCampaignId: campaign.id });
      writeStoredCampaignId(campaign.id);
      get().notify("ok", `Campaña "${campaign.name}" creada.`);
      return campaign;
    } catch (error) {
      get().notify("error", describeError(error));
      throw error;
    } finally {
      set({ busy: false });
    }
  },

  async updateCampaign(patch) {
    const id = get().activeCampaignId;
    if (!id) throw new Error("No hay campaña activa.");
    set({ busy: true });
    try {
      const campaign = await api.patchCampaign(id, patch);
      set((state) => ({
        campaign,
        campaigns: state.campaigns.map((entry) =>
          entry.id === campaign.id
            ? {
                ...entry,
                name: campaign.name,
                description: campaign.description,
                updatedAt: campaign.updatedAt,
                counts: countsFor(campaign),
              }
            : entry,
        ),
      }));
      get().notify("ok", "Campaña actualizada.");
      return campaign;
    } catch (error) {
      get().notify("error", describeError(error));
      throw error;
    } finally {
      set({ busy: false });
    }
  },

  async deleteCampaign(id) {
    set({ busy: true });
    try {
      await api.deleteCampaign(id);
      if (get().activeCampaignId === id) {
        writeStoredCampaignId(null);
        set({ campaign: null, activeCampaignId: null });
      }
      await get().loadAll();
      get().notify("ok", "Campaña eliminada.");
    } catch (error) {
      get().notify("error", describeError(error));
      throw error;
    } finally {
      set({ busy: false });
    }
  },

  async saveContent(type, input, id) {
    const campaign = get().campaign;
    if (!campaign) throw new Error("No hay campaña activa.");
    set({ busy: true });
    try {
      const entity = id
        ? await api.patchContent(type, id, input)
        : await api.createContent(campaign.id, type, input);
      const updated = upsertContent(get().campaign ?? campaign, type, entity);
      set((state) => ({
        campaign: updated,
        campaigns: state.campaigns.map((entry) =>
          entry.id === updated.id
            ? { ...entry, updatedAt: updated.updatedAt, counts: countsFor(updated) }
            : entry,
        ),
      }));
      get().notify(
        "ok",
        id ? "Cambios guardados." : "Contenido creado.",
      );
      return entity;
    } catch (error) {
      get().notify("error", describeError(error));
      throw error;
    } finally {
      set({ busy: false });
    }
  },

  async removeContent(type, id) {
    const campaign = get().campaign;
    if (!campaign) throw new Error("No hay campaña activa.");
    set({ busy: true });
    try {
      await api.deleteContent(type, id);
      const updated = removeContentFromCampaign(get().campaign ?? campaign, type, id);
      set((state) => ({
        campaign: updated,
        campaigns: state.campaigns.map((entry) =>
          entry.id === updated.id
            ? { ...entry, updatedAt: updated.updatedAt, counts: countsFor(updated) }
            : entry,
        ),
      }));
      get().notify("ok", "Contenido eliminado.");
    } catch (error) {
      get().notify("error", describeError(error));
      throw error;
    } finally {
      set({ busy: false });
    }
  },

  async uploadImage(file) {
    try {
      const result = await api.uploadImage(file);
      get().notify("ok", "Imagen subida.");
      return result.url;
    } catch (error) {
      get().notify("error", describeError(error));
      throw error;
    }
  },

  async exportCampaign() {
    const campaign = get().campaign;
    if (!campaign) return;
    try {
      await api.exportCampaign(campaign.id, campaign.name);
      get().notify("ok", "Campaña exportada en JSON.");
    } catch (error) {
      get().notify("error", describeError(error));
    }
  },

  async importCampaign(file) {
    set({ busy: true });
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("El archivo no es un JSON válido.");
      }
      const campaign = await api.importCampaign(parsed);
      const campaigns = await api.listCampaigns();
      set({ campaigns, campaign, activeCampaignId: campaign.id });
      writeStoredCampaignId(campaign.id);
      get().notify("ok", `Campaña "${campaign.name}" importada.`);
      return campaign;
    } catch (error) {
      get().notify("error", describeError(error));
      throw error;
    } finally {
      set({ busy: false });
    }
  },
}));
