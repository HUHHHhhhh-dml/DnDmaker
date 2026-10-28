import { useMemo, useState } from "react";
import { EQUIPMENT_SLOT_LABELS, type EquipmentSlot } from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { ItemCard } from "../components/cards";
import { Icon } from "../components/Icons";
import {
  Button,
  EmptyState,
  LinkButton,
  PageHeader,
  TextInput,
  cx,
} from "../components/ui";

const SLOT_FILTERS: Array<{ value: EquipmentSlot | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  ...Object.entries(EQUIPMENT_SLOT_LABELS).map(([value, label]) => ({
    value: value as EquipmentSlot,
    label,
  })),
];

type LibraryView = "dm" | "players";
type LockFilter = "all" | "unlocked" | "locked";

export function ItemsPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");
  const [slot, setSlot] = useState<EquipmentSlot | "all">("all");
  const [view, setView] = useState<LibraryView>("dm");
  const [lockFilter, setLockFilter] = useState<LockFilter>("all");
  if (!campaign) return null;

  const viewItems = useMemo(
    () =>
      campaign.content.items.filter((item) =>
        view === "dm" ? true : item.unlocked === true,
      ),
    [campaign.content.items, view],
  );

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return viewItems.filter((item) => {
      const unlocked = item.unlocked === true;
      const matchesLock =
        view === "players" ||
        lockFilter === "all" ||
        (lockFilter === "unlocked" ? unlocked : !unlocked);
      const matchesSlot = slot === "all" || item.slot === slot;
      const matchesSearch =
        !needle ||
        item.name.toLowerCase().includes(needle) ||
        (item.code ?? "").toLowerCase().includes(needle) ||
        (item.description ?? "").toLowerCase().includes(needle) ||
        (item.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
      return matchesLock && matchesSlot && matchesSearch;
    });
  }, [viewItems, search, slot, lockFilter, view]);

  const slotCounts = viewItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.slot] = (acc[item.slot] ?? 0) + 1;
    return acc;
  }, {});

  const unlockedCount = campaign.content.items.filter(
    (item) => item.unlocked === true,
  ).length;
  const lockedCount = campaign.content.items.length - unlockedCount;

  function resetFilters() {
    setSearch("");
    setSlot("all");
    setLockFilter("all");
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Biblioteca · Objetos"
        title="Arsenal"
        description="El DM ve toda la biblioteca; los jugadores solo ven lo desbloqueado. Cada objeto tiene su interruptor de visibilidad y los que ya lleva un personaje se conservan en su ficha."
        actions={
          <LinkButton to="/items/new" variant="accent" size="sm" icon="plus">
            Nuevo objeto
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-col gap-3 border border-ui-line-strong bg-ui-surface-3 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex border border-ui-line-strong bg-ui-surface-1">
          <button
            type="button"
            onClick={() => setView("dm")}
            className={cx(
              "px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-colors",
              view === "dm"
                ? "bg-amber/20 text-ui"
                : "text-ui-muted hover:bg-paper-light hover:text-[color:var(--ui-text)]",
            )}
          >
            <Icon name="lock" size={11} className="mr-1 inline" />
            DM · todo
            <span className="ml-1 opacity-60">{campaign.content.items.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setView("players")}
            className={cx(
              "border-l border-ui-line-strong px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-colors",
              view === "players"
                ? "bg-moss/20 text-ui-ok"
                : "text-ui-muted hover:bg-paper-light hover:text-[color:var(--ui-text)]",
            )}
          >
            <Icon name="unlock" size={11} className="mr-1 inline" />
            Jugadores · desbloqueados
            <span className="ml-1 opacity-60">{unlockedCount}</span>
          </button>
        </div>

        {view === "dm" ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mono-label">Visibilidad</span>
            {(
              [
                ["all", "Todos", campaign.content.items.length],
                ["unlocked", "Desbloqueados", unlockedCount],
                ["locked", "Solo DM", lockedCount],
              ] as Array<[LockFilter, string, number]>
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLockFilter(value)}
                className={cx(
                  "border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] transition-colors",
                  lockFilter === value
                    ? "border-ui-accent bg-amber/20 text-ui"
                    : "border-ui-line bg-ui-surface-2 text-ui-muted hover:bg-paper-deep hover:text-[color:var(--ui-text)]",
                )}
              >
                {label}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="max-w-md px-1 text-[10px] leading-snug text-ui-muted">
            Solo aparecen los objetos desbloqueados. Si un personaje ya lleva uno
            bloqueado, su ficha lo conserva.
          </p>
        )}
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
            placeholder="Buscar por nombre, código, tag…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {SLOT_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setSlot(filter.value)}
              className={cx(
                "border px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] transition-colors",
                slot === filter.value
                  ? "border-ui-accent bg-amber/20 text-ui"
                  : "border-ui-line bg-ui-surface-2 text-ui-muted hover:bg-paper-deep hover:text-[color:var(--ui-text)]",
              )}
            >
              {filter.label}
              <span className="ml-1 opacity-60">
                {filter.value === "all"
                  ? viewItems.length
                  : (slotCounts[filter.value] ?? 0)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mono-label tnum mb-4 flex items-center justify-between">
        <span>
          {items.length} de {viewItems.length} objetos ·{" "}
          {view === "dm" ? "biblioteca del DM" : "visibles para jugadores"}
        </span>
        <button type="button" onClick={resetFilters} className="hover:text-amber">
          Limpiar filtros
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={view === "players" ? "unlock" : "cube"}
          title={
            campaign.content.items.length === 0
              ? "La biblioteca está vacía"
              : view === "players" && unlockedCount === 0
                ? "Nada desbloqueado todavía"
                : "Nada coincide"
          }
          description={
            campaign.content.items.length === 0
              ? "Empieza con un par de cuernos, una armadura y un arma. Todo se puede editar después."
              : view === "players" && unlockedCount === 0
                ? "El DM irá desbloqueando objetos desde esta biblioteca. Mientras tanto, la lista de jugadores estará vacía."
                : "Prueba con otro nombre, código, slot o filtro de visibilidad."
          }
          action={
            campaign.content.items.length === 0 ? (
              <LinkButton to="/items/new" icon="plus" size="sm">
                Crear el primer objeto
              </LinkButton>
            ) : view === "players" && unlockedCount === 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("dm")}
              >
                Ver biblioteca del DM
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Limpiar filtros
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} effects={campaign.content.effects} />
          ))}
        </div>
      )}
    </div>
  );
}
