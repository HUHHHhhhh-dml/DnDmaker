import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { EncounterCard } from "../components/cards";
import { Icon } from "../components/Icons";
import {
  Button,
  EmptyState,
  LinkButton,
  PageHeader,
  TextInput,
} from "../components/ui";

export function EncountersPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");
  if (!campaign) return null;

  const encounters = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return campaign.content.encounters.filter(
      (encounter) =>
        !needle ||
        encounter.name.toLowerCase().includes(needle) ||
        (encounter.description ?? "").toLowerCase().includes(needle),
    );
  }, [campaign.content.encounters, search]);

  const enemyCount = campaign.content.characters.filter(
    (character) => character.kind === "enemy",
  ).length;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Mesa · Encuentros"
        title="Encuentros"
        description="Grupos de enemigos con recompensas y condiciones narrativas. El combate que los ejecuta llega en la Fase 3."
        actions={
          <LinkButton to="/encounters/new" variant="accent" size="sm" icon="plus">
            Nuevo encuentro
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
            placeholder="Buscar encuentro…"
            className="pl-9"
          />
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {campaign.content.encounters.length} encuentros · {enemyCount} enemigos
        </div>
      </div>

      {enemyCount === 0 ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-2 border-amber/60 bg-amber/10 p-3">
          <p className="flex items-center gap-2 text-xs text-ink-soft">
            <Icon name="alert" size={14} className="text-rust" />
            Todavía no hay enemigos. Crea una ficha con tipo «Enemigo» para poder usarla
            en un encuentro.
          </p>
          <LinkButton to="/characters/new" variant="ghost" size="sm" icon="skull">
            Crear enemigo
          </LinkButton>
        </div>
      ) : null}

      {encounters.length === 0 ? (
        <EmptyState
          icon="skull"
          title={campaign.content.encounters.length === 0 ? "Sin encuentros" : "Nada coincide"}
          description={
            campaign.content.encounters.length === 0
              ? "Prepara el primer grupo de enemigos y sus recompensas. Se jugará en la Fase 3."
              : "Prueba con otro nombre."
          }
          action={
            campaign.content.encounters.length === 0 ? (
              <LinkButton to="/encounters/new" icon="plus" size="sm">
                Crear el primer encuentro
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
          {encounters.map((encounter) => (
            <EncounterCard
              key={encounter.id}
              encounter={encounter}
              characters={campaign.content.characters}
            />
          ))}
        </div>
      )}
    </div>
  );
}
