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

export function ItemsPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");
  const [slot, setSlot] = useState<EquipmentSlot | "all">("all");
  if (!campaign) return null;

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return campaign.content.items.filter((item) => {
      const matchesSlot = slot === "all" || item.slot === slot;
      const matchesSearch =
        !needle ||
        item.name.toLowerCase().includes(needle) ||
        (item.code ?? "").toLowerCase().includes(needle) ||
        (item.description ?? "").toLowerCase().includes(needle) ||
        (item.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
      return matchesSlot && matchesSearch;
    });
  }, [campaign.content.items, search, slot]);

  const slotCounts = campaign.content.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.slot] = (acc[item.slot] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Biblioteca · Objetos"
        title="Arsenal"
        description="Equipo y utilidades. Cada objeto suma stats al equiparse y puede arrastrar efectos pasivos. El código es visible, pero el ID interno manda."
        actions={
          <LinkButton to="/items/new" variant="accent" size="sm" icon="plus">
            Nuevo objeto
          </LinkButton>
        }
      />

      <div className="mb-5 flex flex-col gap-3 border-2 border-ink bg-paper-light p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
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
                "border border-ink px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] transition-colors",
                slot === filter.value
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink-soft hover:bg-paper-deep",
              )}
            >
              {filter.label}
              <span className="ml-1 opacity-60">
                {filter.value === "all"
                  ? campaign.content.items.length
                  : (slotCounts[filter.value] ?? 0)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        <span>
          {items.length} de {campaign.content.items.length} objetos
        </span>
        <button
          type="button"
          onClick={() => {
            setSearch("");
            setSlot("all");
          }}
          className="hover:text-rust"
        >
          Limpiar filtros
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="cube"
          title={campaign.content.items.length === 0 ? "La biblioteca está vacía" : "Nada coincide"}
          description={
            campaign.content.items.length === 0
              ? "Empieza con un par de cuernos, una armadura y un arma. Todo se puede editar después."
              : "Prueba con otro nombre, código o slot."
          }
          action={
            campaign.content.items.length === 0 ? (
              <LinkButton to="/items/new" icon="plus" size="sm">
                Crear el primer objeto
              </LinkButton>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setSlot("all");
                }}
              >
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
