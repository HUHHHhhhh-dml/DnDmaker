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
  cx,
} from "../components/ui";

type SortMode = "name" | "coins" | "damage";
type LibraryView = "dm" | "players";
type LockFilter = "all" | "unlocked" | "locked";

export function SkillsPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [view, setView] = useState<LibraryView>("dm");
  const [lockFilter, setLockFilter] = useState<LockFilter>("all");
  if (!campaign) return null;

  const viewSkills = useMemo(
    () =>
      campaign.content.skills.filter((skill) =>
        view === "dm" ? true : skill.unlocked === true,
      ),
    [campaign.content.skills, view],
  );

  const skills = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = viewSkills.filter((skill) => {
      const unlocked = skill.unlocked === true;
      const matchesLock =
        view === "players" ||
        lockFilter === "all" ||
        (lockFilter === "unlocked" ? unlocked : !unlocked);
      const matchesSearch =
        !needle ||
        skill.name.toLowerCase().includes(needle) ||
        (skill.code ?? "").toLowerCase().includes(needle) ||
        (skill.description ?? "").toLowerCase().includes(needle);
      return matchesLock && matchesSearch;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "coins") return b.coins - a.coins;
      if (sort === "damage") {
        return (
          b.baseDamage +
          b.coins * b.coinDamage -
          (a.baseDamage + a.coins * a.coinDamage)
        );
      }
      return a.name.localeCompare(b.name, "es");
    });
  }, [viewSkills, search, sort, lockFilter, view]);

  const unlockedCount = campaign.content.skills.filter(
    (skill) => skill.unlocked === true,
  ).length;
  const lockedCount = campaign.content.skills.length - unlockedCount;
  const totalCoins = viewSkills.reduce((sum, skill) => sum + skill.coins, 0);

  function resetFilters() {
    setSearch("");
    setLockFilter("all");
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Biblioteca · Skills"
        title="Habilidades"
        description="El DM ve todas las skills; los jugadores solo las desbloqueadas. Las caras suman clash y daño, y el full heads entra si salen todas caras."
        actions={
          <LinkButton to="/skills/new" variant="accent" size="sm" icon="plus">
            Nueva skill
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-col gap-3 border-2 border-ink bg-paper-deep p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex border-2 border-ink bg-paper-light">
          <button
            type="button"
            onClick={() => setView("dm")}
            className={cx(
              "px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-colors",
              view === "dm" ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper",
            )}
          >
            <Icon name="lock" size={11} className="mr-1 inline" />
            DM · todo
            <span className="ml-1 opacity-60">{campaign.content.skills.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setView("players")}
            className={cx(
              "border-l-2 border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-colors",
              view === "players" ? "bg-moss text-paper" : "text-ink-soft hover:bg-paper",
            )}
          >
            <Icon name="unlock" size={11} className="mr-1 inline" />
            Jugadores · desbloqueadas
            <span className="ml-1 opacity-60">{unlockedCount}</span>
          </button>
        </div>

        {view === "dm" ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
              Visibilidad
            </span>
            {(
              [
                ["all", "Todas", campaign.content.skills.length],
                ["unlocked", "Desbloqueadas", unlockedCount],
                ["locked", "Solo DM", lockedCount],
              ] as Array<[LockFilter, string, number]>
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLockFilter(value)}
                className={cx(
                  "border border-ink px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] transition-colors",
                  lockFilter === value
                    ? "bg-ink text-paper"
                    : "bg-paper text-ink-soft hover:bg-paper-light",
                )}
              >
                {label}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="max-w-md px-1 text-[10px] leading-snug text-ink-soft">
            Solo aparecen las skills desbloqueadas. Si un personaje ya lleva una
            bloqueada, su ficha la conserva.
          </p>
        )}
      </div>

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
          {skills.length} de {viewSkills.length} skills ·{" "}
          {view === "dm" ? "biblioteca del DM" : "visibles para jugadores"}
        </span>
        <span>
          {totalCoins} monedas ·{" "}
          {viewSkills.filter((skill) => (skill.effects ?? []).length > 0).length}{" "}
          con efectos
        </span>
      </div>

      {skills.length === 0 ? (
        <EmptyState
          icon={view === "players" ? "unlock" : "sword"}
          title={
            campaign.content.skills.length === 0
              ? "Sin skills todavía"
              : view === "players" && unlockedCount === 0
                ? "Nada desbloqueado todavía"
                : "Nada coincide"
          }
          description={
            campaign.content.skills.length === 0
              ? "Crea la primera habilidad de tu mesa: monedas, poder de clash y daño."
              : view === "players" && unlockedCount === 0
                ? "El DM irá desbloqueando skills desde esta biblioteca. Mientras tanto, la lista de jugadores estará vacía."
                : "Prueba con otro nombre, código o filtro de visibilidad."
          }
          action={
            campaign.content.skills.length === 0 ? (
              <LinkButton to="/skills/new" icon="plus" size="sm">
                Crear la primera skill
              </LinkButton>
            ) : view === "players" && unlockedCount === 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setView("dm")}>
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
          {skills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} effects={campaign.content.effects} />
          ))}
        </div>
      )}
    </div>
  );
}
