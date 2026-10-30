import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SpecialAbility } from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "../components/Icons";
import {
  Button,
  EmptyState,
  LinkButton,
  PageHeader,
  TextInput,
  cx,
} from "../components/ui";

/** Etiqueta visible del tipo de habilidad especial. */
export function specialKindLabel(kind: SpecialAbility["kind"]): string {
  return kind === "habitat" ? "Hábitat" : "Dominio";
}

/** Número de acciones configuradas en las dos listas (o en la legacy). */
export function specialActionCount(special: SpecialAbility): number {
  if (
    special.allyEffects !== undefined ||
    special.enemyEffects !== undefined
  ) {
    return (
      (special.allyEffects?.length ?? 0) + (special.enemyEffects?.length ?? 0)
    );
  }
  return special.effects.length;
}

function SpecialCard({ special }: { special: SpecialAbility }) {
  const ally = special.allyEffects?.length ?? 0;
  const enemy = special.enemyEffects?.length ?? 0;
  const legacy = special.allyEffects === undefined && special.enemyEffects === undefined;

  return (
    <Link
      to={`/specials/${special.id}`}
      className="panel group flex flex-col overflow-hidden transition-transform duration-100 hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3 border-b border-ui-line-strong bg-ui-surface-3 p-3">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-ui-line-strong bg-ui-surface-2">
          {special.image ? (
            <img
              src={special.image}
              alt={special.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <Icon name="spark" size={20} className="text-ui-faint" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={cx(
              "inline-block border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.14em]",
              special.kind === "habitat"
                ? "border-moss bg-moss text-ui-on-accent"
                : "border-amber bg-amber text-ui-on-accent",
            )}
          >
            {specialKindLabel(special.kind)}
          </span>
          <h3 className="display mt-1 truncate text-xl group-hover:text-rust">
            {special.name}
          </h3>
          <p className="truncate font-mono text-[9px] text-ui-faint">
            {special.duration} ronda{special.duration === 1 ? "" : "s"} ·{" "}
            {special.oncePerCombat === false
              ? `cooldown ${special.cooldown ?? 0}`
              : "1 vez por combate"}
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-[11px] leading-relaxed text-ui-muted">
          {special.description || "Sin descripción."}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {legacy ? (
            <span className="chip">{specialActionCount(special)} efectos</span>
          ) : (
            <>
              <span className="chip">{ally} aliados</span>
              <span className="chip chip-rust">{enemy} enemigos</span>
            </>
          )}
          {special.scene ? <span className="chip chip-accent">Escena</span> : null}
        </div>
      </div>
    </Link>
  );
}

export function SpecialsPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "domain" | "habitat">("all");
  if (!campaign) return null;

  const specials = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return campaign.content.specials.filter((special) => {
      if (kind !== "all" && (special.kind ?? "domain") !== kind) return false;
      if (!needle) return true;
      return (
        special.name.toLowerCase().includes(needle) ||
        (special.code ?? "").toLowerCase().includes(needle) ||
        (special.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [campaign.content.specials, kind, search]);

  const domains = campaign.content.specials.filter(
    (special) => (special.kind ?? "domain") === "domain",
  ).length;
  const habitats = campaign.content.specials.length - domains;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Biblioteca · Dominios y hábitats"
        title="Dominios y hábitats"
        description="Habilidades especiales de una vez por combate. No hacen clash: se declaran, ocupan 1 Skill Slot y aplican sus efectos a aliados y enemigos. Pueden cambiar el escenario mientras duren."
        actions={
          <LinkButton to="/specials/new" variant="accent" size="sm" icon="plus">
            Nuevo dominio o hábitat
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
            placeholder="Buscar dominio, hábitat o código…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {(
            [
              ["all", "Todos"],
              ["domain", "Dominios"],
              ["habitat", "Hábitats"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={cx(
                "border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]",
                kind === value
                  ? "border-ui-line-strong bg-amber text-ui-on-accent"
                  : "border-ui-line bg-ui-surface-1 text-ui-muted hover:text-ui",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mono-label tnum">
          {domains} dominios · {habitats} hábitats
        </div>
      </div>

      {specials.length === 0 ? (
        <EmptyState
          icon="spark"
          title={
            campaign.content.specials.length === 0
              ? "Sin dominios ni hábitats"
              : "Nada coincide"
          }
          description={
            campaign.content.specials.length === 0
              ? "Crea un dominio o hábitat para tu campaña: efectos para aliados y enemigos, y opcionalmente un cambio de escenario temporal."
              : "Prueba otra búsqueda o cambia el filtro."
          }
          action={
            campaign.content.specials.length === 0 ? (
              <LinkButton to="/specials/new" icon="plus" size="sm">
                Crear el primero
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
        <div className="grid gap-3 sm:grid-cols-2">
          {specials.map((special) => (
            <SpecialCard key={special.id} special={special} />
          ))}
        </div>
      )}
    </div>
  );
}
