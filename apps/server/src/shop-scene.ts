import { eq } from "drizzle-orm";
import type {
  Campaign,
  CampaignWallet,
  Item,
  Shop,
  ShopScene,
  ShopSceneItem,
  ShopSceneSkill,
  Skill,
} from "@protocol-life/shared";
import type { AppDatabase } from "./db";
import { HttpError, Repository } from "./repository";
import { activeShops } from "./schema";
import { SessionService } from "./sessions";

/**
 * Escena de tienda (Fase 4A-3).
 *
 * El DM abre una tienda en la mesa y toda la sala recibe un snapshot
 * (`shop:state`) con los objetos a la venta, incluidos los que todavía están
 * bloqueados para los jugadores. Comprar **no** añade el objeto al inventario:
 * paga su precio y lo desbloquea para toda la campaña, de modo que aparezca en
 * la biblioteca y se pueda equipar.
 *
 * La fila `active_shops` guarda solo la sesión y la tienda; la escena se
 * reconstruye desde el contenido, así que refleja precios/stock al día.
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

const nowIso = (): string => new Date().toISOString();

export class ShopSceneService {
  constructor(
    private readonly db: AppDatabase,
    private readonly repo: Repository,
    private readonly sessions: SessionService,
  ) {}

  /** Tienda abierta de una sesión, ya montada para la UI. */
  getBySession(sessionId: string): ShopScene | null {
    const row = this.db
      .select()
      .from(activeShops)
      .where(eq(activeShops.sessionId, sessionId))
      .get();
    if (!row) return null;

    const campaign = this.repo.getCampaign(row.campaignId);
    const shop = campaign.content.shops.find((entry) => entry.id === row.shopId);
    if (!shop) {
      // La tienda se borró con la escena abierta: se cierra sola.
      this.closeForSession(sessionId);
      return null;
    }
    return this.buildScene(shop, campaign, row.openedAt);
  }

  /** Abre (o reemplaza) la tienda de la sesión. Solo DM y fuera de combate. */
  open(code: string, token: string | null, shopId: string): ShopScene {
    const identity = this.requireDm(code, token);
    if (identity.session.status === "combat") {
      throw new HttpError(
        423,
        "combat_lock",
        "No se puede abrir una tienda durante el combate.",
      );
    }

    const campaign = this.repo.getCampaign(identity.session.campaignId);
    const shop = campaign.content.shops.find((entry) => entry.id === shopId);
    if (!shop) {
      throw new HttpError(404, "shop_not_found", "La tienda no existe.");
    }

    const openedAt = nowIso();
    this.repo.transaction(() => {
      this.db
        .delete(activeShops)
        .where(eq(activeShops.sessionId, identity.session.id))
        .run();
      this.db
        .insert(activeShops)
        .values({
          sessionId: identity.session.id,
          campaignId: identity.session.campaignId,
          shopId,
          openedAt,
        })
        .run();
    });

    return this.buildScene(shop, campaign, openedAt);
  }

  /** Cierra la tienda de la sesión. Idempotente. */
  close(code: string, token: string | null): void {
    const identity = this.requireDm(code, token);
    this.closeForSession(identity.session.id);
  }

  /** Cierre interno (empezar combate, borrar la tienda, cerrar sesión). */
  closeForSession(sessionId: string): void {
    this.db
      .delete(activeShops)
      .where(eq(activeShops.sessionId, sessionId))
      .run();
  }

  /**
   * Compra de un jugador: paga el precio y desbloquea el objeto para la
   * campaña. No entra en el inventario.
   */
  buy(
    code: string,
    token: string | null,
    input: { itemId: string } | { skillId: string },
  ): ShopBuyResult {
    const identity = this.requirePlayer(code, token);
    if (identity.session.status === "combat") {
      throw new HttpError(
        423,
        "combat_lock",
        "No se puede comprar durante el combate.",
      );
    }

    const row = this.db
      .select()
      .from(activeShops)
      .where(eq(activeShops.sessionId, identity.session.id))
      .get();
    if (!row) {
      throw new HttpError(
        404,
        "shop_not_open",
        "No hay ninguna tienda abierta en la mesa.",
      );
    }

    if ("skillId" in input) {
      const result = this.repo.buyShopSkillUnlock({
        campaignId: row.campaignId,
        shopId: row.shopId,
        skillId: input.skillId,
      });
      return {
        ...result,
        kind: "skill",
        shop: this.rebuild(row.campaignId, row.shopId, row.openedAt),
      };
    }

    const result = this.repo.buyShopItemUnlock({
      campaignId: row.campaignId,
      shopId: row.shopId,
      itemId: input.itemId,
    });

    return {
      ...result,
      kind: "item",
      shop: this.rebuild(row.campaignId, row.shopId, row.openedAt),
    };
  }

  private rebuild(campaignId: string, shopId: string, openedAt: string): ShopScene {
    const campaign = this.repo.getCampaign(campaignId);
    const shop = campaign.content.shops.find((entry) => entry.id === shopId);
    if (!shop) {
      throw new HttpError(404, "shop_not_found", "La tienda no existe.");
    }
    return this.buildScene(shop, campaign, openedAt);
  }

  private buildScene(
    shop: Shop,
    campaign: Campaign,
    openedAt: string,
  ): ShopScene {
    const itemsById = new Map(
      campaign.content.items.map((item) => [item.id, item]),
    );
    const items: ShopSceneItem[] = [];
    for (const entry of shop.items) {
      const item = itemsById.get(entry.itemId);
      if (!item) continue;
      items.push({
        item: {
          id: item.id,
          name: item.name,
          ...(item.code ? { code: item.code } : {}),
          ...(item.description ? { description: item.description } : {}),
          ...(item.icon ? { icon: item.icon } : {}),
          ...(item.image ? { image: item.image } : {}),
          slot: item.slot,
          ...(item.rarity ? { rarity: item.rarity } : {}),
          ...(item.stats ? { stats: item.stats } : {}),
        },
        price: entry.price,
        ...(entry.stock === undefined ? {} : { stock: entry.stock }),
        unlocked: item.unlocked === true,
      });
    }

    const skillsById = new Map(
      campaign.content.skills.map((skill) => [skill.id, skill]),
    );
    const skills: ShopSceneSkill[] = [];
    for (const entry of shop.skills ?? []) {
      const skill = skillsById.get(entry.skillId);
      if (!skill) continue;
      skills.push({
        skill: {
          id: skill.id,
          name: skill.name,
          ...(skill.code ? { code: skill.code } : {}),
          ...(skill.description ? { description: skill.description } : {}),
          ...(skill.image ? { image: skill.image } : {}),
          coins: skill.coins,
          baseClash: skill.baseClash,
          coinClash: skill.coinClash,
          baseDamage: skill.baseDamage,
          coinDamage: skill.coinDamage,
          ...(skill.fullHeadsMultiplier !== undefined
            ? { fullHeadsMultiplier: skill.fullHeadsMultiplier }
            : {}),
          ...(skill.tags ? { tags: skill.tags } : {}),
        },
        price: entry.price,
        ...(entry.stock === undefined ? {} : { stock: entry.stock }),
        unlocked: skill.unlocked === true,
      });
    }

    return {
      shopId: shop.id,
      name: shop.name,
      ...(shop.description ? { description: shop.description } : {}),
      ...(shop.background ? { background: shop.background } : {}),
      ...(shop.currency ? { currency: shop.currency } : {}),
      openedAt,
      items,
      skills,
    };
  }

  private requireDm(code: string, token: string | null) {
    const identity = this.sessions.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
    }
    if (identity.role !== "dm") {
      throw new HttpError(403, "dm_only", "Solo el DM puede hacer esta acción.");
    }
    return identity;
  }

  private requirePlayer(code: string, token: string | null) {
    const identity = this.sessions.authenticate(code, token);
    if (!identity) {
      throw new HttpError(401, "invalid_token", "Tu token de sesión no es válido.");
    }
    if (identity.role !== "player") {
      throw new HttpError(
        403,
        "player_only",
        "Solo los jugadores compran en la tienda.",
      );
    }
    return identity;
  }
}
