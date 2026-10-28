import { Link, useOutletContext } from "react-router-dom";
import {
  CHARACTER_KIND_LABELS,
  EQUIPMENT_SLOT_LABELS,
  HP_PERSISTENCE_LABELS,
  TIE_RULE_LABELS,
  type CharacterKind,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { CharacterCard, EncounterCard, ItemCard } from "../components/cards";
import { Icon, type IconName } from "../components/Icons";
import {
  Button,
  EmptyState,
  LinkButton,
  PageHeader,
  SectionTitle,
} from "../components/ui";
import { formatDateTime, plural } from "../lib/format";

export function DashboardPage() {
  const campaign = useAppStore((state) => state.campaign);
  const exportCampaign = useAppStore((state) => state.exportCampaign);
  const context = useOutletContext<{ onEditCampaign?: () => void } | null>();
  if (!campaign) return null;

  const counts = [
    { key: "items", label: "Objetos", icon: "cube" as IconName, to: "/items", value: campaign.content.items.length },
    { key: "skills", label: "Skills", icon: "sword" as IconName, to: "/skills", value: campaign.content.skills.length },
    { key: "effects", label: "Efectos", icon: "flame" as IconName, to: "/effects", value: campaign.content.effects.length },
    { key: "characters", label: "Personajes", icon: "users" as IconName, to: "/characters", value: campaign.content.characters.length },
    { key: "encounters", label: "Encuentros", icon: "skull" as IconName, to: "/encounters", value: campaign.content.encounters.length },
  ];

  const party = campaign.content.characters.filter((character) =>
    ["player", "npc"].includes(character.kind),
  );
  const players = campaign.content.characters.filter((character) => character.kind === "player");
  const enemies = campaign.content.characters.filter((character) => character.kind === "enemy");
  const featuredItems = campaign.content.items.slice(0, 3);
  const featuredEncounters = campaign.content.encounters.slice(0, 2);

  const kindCounts = campaign.content.characters.reduce<Record<CharacterKind, number>>(
    (acc, character) => {
      acc[character.kind] += 1;
      return acc;
    },
    { player: 0, npc: 0, enemy: 0 },
  );

  const hasContent =
    campaign.content.items.length +
      campaign.content.skills.length +
      campaign.content.characters.length >
    0;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Panel de campaña"
        title={campaign.name}
        description={
          campaign.description ||
          "El estudio está listo. Crea contenido y arma las fichas de tu mesa."
        }
        actions={
          <>
            <Button variant="ghost" icon="edit" size="sm" onClick={() => context?.onEditCampaign?.()}>
              Ajustes
            </Button>
            <LinkButton to="/table" variant="ghost" size="sm" icon="broadcast">
              Mesa
            </LinkButton>
            <Button
              variant="ghost"
              icon="download"
              size="sm"
              onClick={() => void exportCampaign()}
            >
              Exportar
            </Button>
            <LinkButton to="/items/new" variant="accent" size="sm" icon="plus">
              Nuevo objeto
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-7">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {counts.map((entry) => (
              <Link
                key={entry.key}
                to={entry.to}
                className="group border border-ui-line-strong bg-ui-surface-2 p-3 transition-colors hover:bg-paper-deep"
              >
                <div className="flex items-center justify-between text-ui-faint">
                  <Icon name={entry.icon} size={15} />
                  <span className="font-mono text-[9px] opacity-0 transition-opacity group-hover:opacity-100">
                    →
                  </span>
                </div>
                <div className="mt-2 font-display text-3xl leading-none">
                  {String(entry.value).padStart(2, "0")}
                </div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-ui-muted">
                  {entry.label}
                </div>
              </Link>
            ))}
          </div>

          {!hasContent ? (
            <EmptyState
              icon="spark"
              title="Campaña sin contenido"
              description="Crea tu primer objeto, skill o personaje. También puedes volver a generar el contenido de ejemplo importando una campaña exportada."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <LinkButton to="/items/new" icon="plus" size="sm">
                    Nuevo objeto
                  </LinkButton>
                  <LinkButton to="/characters/new" variant="ghost" icon="users" size="sm">
                    Nuevo personaje
                  </LinkButton>
                </div>
              }
            />
          ) : null}

          <section>
            <SectionTitle
              title="La party"
              count={party.length}
              action={
                <Link
                  to="/characters"
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ui-accent hover:underline"
                >
                  Ver todas →
                </Link>
              }
            />
            {party.length === 0 ? (
              <EmptyState
                icon="users"
                title="Todavía no hay fichas"
                description="Crea la ficha de tus jugadores o de tus NPCs. El equipo y las skills se eligen después."
                action={
                  <LinkButton to="/characters/new" size="sm" icon="plus">
                    Crear personaje
                  </LinkButton>
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {party.slice(0, 4).map((character) => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    content={campaign.content}
                    rules={campaign.rules}
                  />
                ))}
              </div>
            )}
          </section>

          {featuredItems.length > 0 ? (
            <section>
              <SectionTitle
                title="Objetos destacados"
                count={campaign.content.items.length}
                action={
                  <Link
                    to="/items"
                    className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ui-accent hover:underline"
                  >
                    Biblioteca →
                  </Link>
                }
              />
              <div className="grid gap-3 sm:grid-cols-3">
                {featuredItems.map((item) => (
                  <ItemCard key={item.id} item={item} effects={campaign.content.effects} />
                ))}
              </div>
            </section>
          ) : null}

          {featuredEncounters.length > 0 ? (
            <section>
              <SectionTitle
                title="Encuentros preparados"
                count={campaign.content.encounters.length}
                action={
                  <Link
                    to="/encounters"
                    className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ui-accent hover:underline"
                  >
                    Ver todos →
                  </Link>
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {featuredEncounters.map((encounter) => (
                  <EncounterCard
                    key={encounter.id}
                    encounter={encounter}
                    characters={campaign.content.characters}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                Reglas de la mesa
              </h2>
              <button
                type="button"
                onClick={() => context?.onEditCampaign?.()}
                className="text-ui-faint transition-colors hover:text-amber"
                aria-label="Editar reglas"
              >
                <Icon name="edit" size={14} />
              </button>
            </div>
            <dl className="space-y-2 text-xs">
              {[
                ["Mitigación", `DEF / (DEF + ${campaign.rules.defenseConstant})`],
                ["Daño mínimo", String(campaign.rules.minDamage)],
                ["Skill Slots", `2 base · máx. ${campaign.rules.maxSkillSlots}`],
                ["Empate de clash", TIE_RULE_LABELS[campaign.rules.tieRule]],
                ["Full heads", `×${campaign.rules.fullHeadsMultiplier}`],
                ["Suerte", `${campaign.rules.luckFloor} – ${campaign.rules.luckCap}`],
                ["HP entre combates", HP_PERSISTENCE_LABELS[campaign.rules.hpPersistence]],
                ["Jugadores", `máx. ${campaign.settings.maxPlayers}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3 border-b border-ui-line pb-1.5">
                  <dt className="text-ui-muted">{label}</dt>
                  <dd className="text-right font-mono text-[10px] font-semibold text-ui">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="panel-dark p-4">
            <div className="mb-2 flex items-center gap-2">
              <Icon name="spark" size={16} className="text-amber" />
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                Estado del estudio
              </h2>
            </div>
            <p className="text-[11px] leading-relaxed text-ui-muted">
              {plural(campaign.content.characters.length, "ficha", "fichas")} ·{" "}
              {players.length} jugador{players.length === 1 ? "" : "es"} · {enemies.length}{" "}
              enemigo{enemies.length === 1 ? "" : "s"}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {(["player", "npc", "enemy"] as CharacterKind[]).map((kind) => (
                <div key={kind} className="border border-ui-line px-1 py-2">
                  <div className="font-display text-xl">{kindCounts[kind]}</div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-ui-faint">
                    {CHARACTER_KIND_LABELS[kind]}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-ui-line pt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ui-faint">
              Actualizada {formatDateTime(campaign.updatedAt)}
            </div>
          </div>

          <div className="panel p-4">
            <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              Slots de equipo
            </h2>
            <div className="flex flex-wrap gap-1">
              {Object.entries(EQUIPMENT_SLOT_LABELS).map(([slot, label]) => {
                const equipped = campaign.content.characters.filter((character) =>
                  Object.entries(character.equipment).some(
                    ([equippedSlot, itemId]) => equippedSlot === slot && itemId,
                  ),
                ).length;
                return (
                  <span key={slot} className="chip">
                    {label}
                    <span className="font-bold text-ui">{equipped}</span>
                  </span>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {campaign.content.effects.slice(0, 4).map((effect) => (
                <Link key={effect.id} to={`/effects/${effect.id}`} className="chip chip-rust hover:bg-rust/20">
                  <Icon name="flame" size={10} />
                  {effect.name}
                </Link>
              ))}
            </div>
          </div>

          <div className="border border-dashed border-ui-line p-4">
            <div className="mono-label mb-2">Fase 2 · mesa en vivo</div>
            <ul className="space-y-1.5 text-[11px] leading-snug text-ui-muted">
              {[
                "Sala LAN con link + PIN",
                "Fichas compartidas en vivo",
                "Permisos por token de sesión",
                "Biblioteca por desbloqueo",
                "Party y presencia en tiempo real",
              ].map((entry) => (
                <li key={entry} className="flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-ui-ok" />
                  {entry}
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-ui-line pt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
              Combate y encuentros: Fase 3
            </p>
            <Link
              to="/table"
              className="mt-3 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ui-accent hover:underline"
            >
              Abrir la mesa →
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
