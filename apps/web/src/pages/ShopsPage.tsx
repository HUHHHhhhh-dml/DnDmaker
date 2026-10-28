import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CURRENCY_NAME, type Shop } from "@protocol-life/shared";
import { api } from "../lib/api";
import { describeError, useAppStore } from "../store/useAppStore";
import { useLiveStore } from "../store/useLiveStore";
import { Icon } from "../components/Icons";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  PageHeader,
  TextInput,
  cx,
} from "../components/ui";

/** Stock total de la tienda: `∞` si algún objeto no tiene stock limitado. */
function totalStock(shop: Shop): number | "∞" {
  if (shop.items.some((entry) => entry.stock === undefined)) return "∞";
  return shop.items.reduce((sum, entry) => sum + (entry.stock ?? 0), 0);
}

function ShopCard({ shop }: { shop: Shop }) {
  const campaignId = useAppStore((state) => state.campaign?.id);
  const notify = useAppStore((state) => state.notify);
  const refreshCampaign = useAppStore((state) => state.refreshCampaign);

  const liveSession = useLiveStore((state) => state.session);
  const liveCampaignId = useLiveStore((state) => state.campaignId);
  const activeShop = useLiveStore((state) => state.activeShop);
  const openShop = useLiveStore((state) => state.openShop);

  const [mutating, setMutating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const stock = totalStock(shop);
  const onThisCampaign =
    Boolean(liveSession) && liveCampaignId === campaignId;
  const openedHere = activeShop?.shopId === shop.id;
  const anotherShopOpen = Boolean(activeShop) && !openedHere;

  const openHint = !liveSession
    ? "Abre una sala en la mesa para lanzarla en vivo."
    : !onThisCampaign
      ? "La sala abierta pertenece a otra campaña."
      : anotherShopOpen
        ? `Ya hay una tienda abierta${activeShop ? `: «${activeShop.name}»` : ""}.`
        : null;

  async function handleOpenInTable() {
    if (!onThisCampaign || anotherShopOpen) return;
    setMutating(true);
    try {
      const ok = await openShop(shop.id);
      if (ok) notify("ok", `«${shop.name}» abierta en la mesa.`);
    } finally {
      setMutating(false);
    }
  }

  async function handleDelete() {
    if (!campaignId) return;
    setMutating(true);
    try {
      await api.deleteShop(campaignId, shop.id);
      await refreshCampaign();
      notify("ok", `«${shop.name}» eliminada.`);
      setConfirmDelete(false);
    } catch (error) {
      notify("error", describeError(error));
      setConfirmDelete(false);
    } finally {
      setMutating(false);
    }
  }

  return (
    <article className="panel flex flex-col overflow-hidden">
      <div className="border-b border-ui-line-strong bg-ui-surface-3 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="display min-w-0 truncate text-xl text-ui">{shop.name}</h3>
          {openedHere ? (
            <span className="chip shrink-0 border-moss/50 bg-moss/10 text-ui-ok">
              <Icon name="broadcast" size={10} />
              En la mesa
            </span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs leading-snug text-ui-muted">
          {shop.description || "Sin descripción."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-ui-line bg-ui-surface-1">
        <div className="bg-ui-surface-2 px-3 py-2">
          <div className="mono-label">Objetos</div>
          <div className="mt-0.5 font-display text-xl leading-none text-ui">
            {String(shop.items.length).padStart(2, "0")}
          </div>
        </div>
        <div className="bg-ui-surface-2 px-3 py-2">
          <div className="mono-label">Stock total</div>
          <div
            className={cx(
              "tnum mt-0.5 font-display text-xl leading-none",
              stock === "∞" ? "text-ui-gold" : "text-ui",
            )}
          >
            {stock}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 p-3">
        <LinkButton to={`/shops/${shop.id}`} variant="ghost" size="sm" icon="edit">
          Editar
        </LinkButton>
        <Button
          type="button"
          variant="primary"
          size="sm"
          icon="unlock"
          loading={mutating && !confirmDelete}
          disabled={
            mutating || !onThisCampaign || openedHere || anotherShopOpen
          }
          onClick={() => void handleOpenInTable()}
        >
          Abrir en la mesa
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon="trash"
          disabled={mutating}
          onClick={() => setConfirmDelete(true)}
        >
          Eliminar
        </Button>
      </div>

      {openHint ? (
        <p className="border-t border-ui-line px-3 py-2 text-[10px] leading-snug text-ui-faint">
          {openHint}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar tienda"
        message={
          <>
            Vas a eliminar <strong>«{shop.name}»</strong>. Los objetos que la party
            ya compró siguen desbloqueados en la campaña.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={mutating}
      />
    </article>
  );
}

export function ShopsPage() {
  const campaign = useAppStore((state) => state.campaign);
  const activeShop = useLiveStore((state) => state.activeShop);
  const [search, setSearch] = useState("");

  const shops = campaign?.content.shops ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      shops.filter(
        (shop) =>
          !needle ||
          shop.name.toLowerCase().includes(needle) ||
          (shop.description ?? "").toLowerCase().includes(needle),
      ),
    [shops, needle],
  );

  if (!campaign) return null;

  const totalItems = shops.reduce((sum, shop) => sum + shop.items.length, 0);
  const totalStockAll = shops.reduce((sum, shop) => {
    const stock = totalStock(shop);
    return sum + (stock === "∞" ? 0 : stock);
  }, 0);
  const anyUnlimited = shops.some((shop) => totalStock(shop) === "∞");

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Economía · Tiendas"
        title="Tiendas"
        description={`El DM abre una tienda en la mesa y la sala entera ve la escena en vivo. La party compra con ${CURRENCY_NAME} de la bolsa común: pagar el precio desbloquea el objeto para toda la campaña, no lo mete en el inventario.`}
        actions={
          <LinkButton to="/shops/new" variant="accent" size="sm" icon="plus">
            Nueva tienda
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-col gap-2 border border-ui-line-strong bg-ui-surface-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ui-muted">
          <span className="chip">
            <span className="text-ui-faint">Tiendas</span>
            <span className="tnum font-bold text-ui">{shops.length}</span>
          </span>
          <span className="chip">
            <span className="text-ui-faint">Objetos a la venta</span>
            <span className="tnum font-bold text-ui">{totalItems}</span>
          </span>
          <span className="chip">
            <span className="text-ui-faint">Stock total</span>
            <span className="tnum font-bold text-ui">
              {anyUnlimited ? `${totalStockAll}+∞` : totalStockAll}
            </span>
          </span>
          {activeShop ? (
            <span className="chip border-moss/50 bg-moss/10 text-ui-ok">
              <Icon name="broadcast" size={10} />
              Abierta: {activeShop.name}
            </span>
          ) : null}
        </div>
        <p className="max-w-lg text-[10px] leading-snug text-ui-muted">
          Cada tienda se lanza desde su tarjeta con{" "}
          <strong className="text-ui">Abrir en la mesa</strong>; solo puede haber
          una abierta a la vez.
        </p>
      </div>

      <div className="mb-5 flex flex-col gap-3 border border-ui-line-strong bg-ui-surface-2 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui-faint"
          />
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Buscar tienda por nombre o descripción…"
            className="pl-9"
          />
        </div>
        <span className="mono-label tnum shrink-0">
          {filtered.length} de {shops.length} tiendas
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="book"
          title={shops.length === 0 ? "Todavía no hay tiendas" : "Ninguna tienda coincide"}
          description={
            shops.length === 0
              ? `Crea la primera tienda, elige sus objetos y ponles precio en ${CURRENCY_NAME}. Después ábrela en la mesa para que la party compre en vivo.`
              : "Prueba con otro nombre o descripción."
          }
          action={
            shops.length === 0 ? (
              <LinkButton to="/shops/new" size="sm" icon="plus">
                Crear la primera tienda
              </LinkButton>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                Limpiar búsqueda
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((shop) => (
            <ShopCard key={shop.id} shop={shop} />
          ))}
        </div>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-ui-faint">
        La bolsa de la party se ajusta desde la{" "}
        <Link
          to="/table"
          className="font-semibold text-ui-accent hover:underline"
        >
          mesa del DM
        </Link>
        . Abrir una tienda bloquea el combate y viceversa.
      </p>
    </div>
  );
}
