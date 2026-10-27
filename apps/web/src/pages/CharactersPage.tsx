import { useMemo, useState } from "react";
import {
  CHARACTER_KIND_LABELS,
  type CharacterKind,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { CharacterCard } from "../components/cards";
import { Icon } from "../components/Icons";
import {
  Button,
  EmptyState,
  LinkButton,
  PageHeader,
  TextInput,
  cx,
} from "../components/ui";

const KIND_FILTERS: Array<{ value: CharacterKind | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "player", label: "Jugadores" },
  { value: "npc", label: "NPCs" },
  { value: "enemy", label: "Enemigos" },
];

export function CharactersPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<CharacterKind | "all">("all");
  if (!campaign) return null;

  const characters = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return campaign.content.characters.filter((character) => {
      const matchesKind = kind === "all" || character.kind === kind;
      const matchesSearch =
        !needle ||
        character.name.toLowerCase().includes(needle) ||
        (character.description ?? "").toLowerCase().includes(needle) ||
        (character.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
      return matchesKind && matchesSearch;
    });
  }, [campaign.content.characters, search, kind]);

  const counts = campaign.content.characters.reduce<Record<string, number>>(
    (acc, character) => {
      acc[character.kind] = (acc[character.kind] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Mesa · Personajes"
        title="Fichas"
        description="Jugadores, NPCs y enemigos. Equipa objetos, elige hasta tres skills y observa cómo cambian los stats derivados en vivo."
        actions={
          <LinkButton to="/characters/new" variant="accent" size="sm" icon="plus">
            Nueva ficha
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
            placeholder="Buscar por nombre, tag…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setKind(filter.value)}
              className={cx(
                "border border-ink px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] transition-colors",
                kind === filter.value
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink-soft hover:bg-paper-deep",
              )}
            >
              {filter.label}
              <span className="ml-1 opacity-60">
                {filter.value === "all"
                  ? campaign.content.characters.length
                  : (counts[filter.value] ?? 0)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {characters.length === 0 ? (
        <EmptyState
          icon="users"
          title={
            campaign.content.characters.length === 0 ? "No hay fichas" : "Nada coincide"
          }
          description={
            campaign.content.characters.length === 0
              ? "Crea el personaje de un jugador, un NPC o el enemigo de tu primer encuentro."
              : "Prueba con otro nombre o tipo de personaje."
          }
          action={
            campaign.content.characters.length === 0 ? (
              <LinkButton to="/characters/new" icon="plus" size="sm">
                Crear la primera ficha
              </LinkButton>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setKind("all");
                }}
              >
                Limpiar filtros
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              content={campaign.content}
              rules={campaign.rules}
            />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2 border-t border-ink/15 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        {(["player", "npc", "enemy"] as CharacterKind[]).map((value) => (
          <span key={value} className="chip">
            {CHARACTER_KIND_LABELS[value]}
            <span className="font-bold text-ink">{counts[value] ?? 0}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
