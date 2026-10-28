import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { EffectCard } from "../components/cards";
import { Icon } from "../components/Icons";
import {
  Button,
  EmptyState,
  LinkButton,
  PageHeader,
  TextInput,
} from "../components/ui";

export function EffectsPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");
  if (!campaign) return null;

  const effects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return campaign.content.effects.filter(
      (effect) =>
        !needle ||
        effect.name.toLowerCase().includes(needle) ||
        (effect.code ?? "").toLowerCase().includes(needle) ||
        (effect.description ?? "").toLowerCase().includes(needle) ||
        (effect.tags ?? []).some((tag) => tag.toLowerCase().includes(needle)),
    );
  }, [campaign.content.effects, search]);

  const triggerCount = campaign.content.effects.reduce(
    (sum, effect) => sum + effect.triggers.length,
    0,
  );

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Biblioteca · Efectos"
        title="Status effects"
        description="Efectos data-driven: triggers y acciones. El mismo motor que usarán Burn, Bleed, Protection y Haste en combate."
        actions={
          <LinkButton to="/effects/new" variant="accent" size="sm" icon="plus">
            Nuevo efecto
          </LinkButton>
        }
      />

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
            placeholder="Buscar efecto, tag o trigger…"
            className="pl-9"
          />
        </div>
        <div className="mono-label tnum">
          {campaign.content.effects.length} efectos · {triggerCount} triggers
        </div>
      </div>

      {effects.length === 0 ? (
        <EmptyState
          icon="flame"
          title={campaign.content.effects.length === 0 ? "Sin efectos" : "Nada coincide"}
          description={
            campaign.content.effects.length === 0
              ? "Crea Burn, Bleed o el efecto que necesite tu campaña. Los triggers deciden cuándo actúa."
              : "Prueba otra búsqueda."
          }
          action={
            campaign.content.effects.length === 0 ? (
              <LinkButton to="/effects/new" icon="plus" size="sm">
                Crear el primer efecto
              </LinkButton>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                Limpiar búsqueda
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {effects.map((effect) => (
            <EffectCard key={effect.id} effect={effect} />
          ))}
        </div>
      )}
    </div>
  );
}
