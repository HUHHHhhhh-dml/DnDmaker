import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { SkillCard } from "../components/cards";
import { Icon } from "../components/Icons";
import {
  Button,
  EmptyState,
  LinkButton,
  PageHeader,
  TextInput,
} from "../components/ui";

type SortMode = "name" | "coins" | "damage";

export function SkillsPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  if (!campaign) return null;

  const skills = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = campaign.content.skills.filter(
      (skill) =>
        !needle ||
        skill.name.toLowerCase().includes(needle) ||
        (skill.code ?? "").toLowerCase().includes(needle) ||
        (skill.description ?? "").toLowerCase().includes(needle),
    );
    return [...filtered].sort((a, b) => {
      if (sort === "coins") return b.coins - a.coins;
      if (sort === "damage") {
        return b.baseDamage + b.coins * b.coinDamage - (a.baseDamage + a.coins * a.coinDamage);
      }
      return a.name.localeCompare(b.name, "es");
    });
  }, [campaign.content.skills, search, sort]);

  const totalCoins = campaign.content.skills.reduce((sum, skill) => sum + skill.coins, 0);

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Biblioteca · Skills"
        title="Habilidades"
        description="Skills con monedas, clash y daño. Las caras suman clash y daño; si salen todas caras, el multiplicador de full heads entra en juego."
        actions={
          <LinkButton to="/skills/new" variant="accent" size="sm" icon="plus">
            Nueva skill
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
            placeholder="Buscar skill…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              ["name", "Nombre"],
              ["coins", "Monedas"],
              ["damage", "Daño"],
            ] as Array<[SortMode, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSort(value)}
              className={
                sort === value
                  ? "border border-ink bg-ink px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-paper"
                  : "border border-ink bg-paper px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-soft hover:bg-paper-deep"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        <span>
          {skills.length} de {campaign.content.skills.length} skills
        </span>
        <span>
          {totalCoins} monedas en total ·{" "}
          {campaign.content.skills.filter((skill) => (skill.effects ?? []).length > 0).length}{" "}
          con efectos
        </span>
      </div>

      {skills.length === 0 ? (
        <EmptyState
          icon="sword"
          title={campaign.content.skills.length === 0 ? "Sin skills todavía" : "Nada coincide"}
          description={
            campaign.content.skills.length === 0
              ? "Crea la primera habilidad de tu mesa: monedas, poder de clash y daño."
              : "Prueba con otro nombre o código."
          }
          action={
            campaign.content.skills.length === 0 ? (
              <LinkButton to="/skills/new" icon="plus" size="sm">
                Crear la primera skill
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
          {skills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} effects={campaign.content.effects} />
          ))}
        </div>
      )}
    </div>
  );
}
