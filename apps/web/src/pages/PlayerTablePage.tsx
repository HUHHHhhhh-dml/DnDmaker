import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  SESSION_STATUS_LABELS,
  STAT_KEYS,
  STAT_LABELS,
  calculateStats,
  type CampaignContent,
  type PublicSession,
  type PublicSessionPlayer,
  type Ruleset,
  type Skill,
} from "@protocol-life/shared";
import { usePlayerStore } from "../store/usePlayerStore";
import { EquipmentDoll } from "../components/EquipmentDoll";
import { PlayerSheetEditor } from "../components/PlayerSheetEditor";
import { StatPanel } from "../components/StatPanel";
import { Icon } from "../components/Icons";
import { PlayerCombatView } from "./PlayerCombatView";
import { CombatResultPanel } from "../components/combat/CombatResultPanel";
import {
  Button,
  ConfirmDialog,
  LinkButton,
  LoadingBlock,
  SectionTitle,
  cx,
} from "../components/ui";
import { CoinRow } from "../components/cards";
import { signed } from "../lib/format";

/**
 * Mesa del jugador: su ficha editable y la party de la sala.
 *
 * La página es independiente del Layout del DM y funciona con el token de
 * jugador guardado en `sessionAuth`. Todo lo que se muestra viene saneado por
 * el servidor (sin enemigos, notas ni PIN).
 */
export function PlayerTablePage() {
  const { code: rawCode } = useParams();
  const code = (rawCode ?? "").trim().toUpperCase();
  const navigate = useNavigate();

  const session = usePlayerStore((state) => state.session);
  const campaign = usePlayerStore((state) => state.campaign);
  const character = usePlayerStore((state) => state.character);
  const player = usePlayerStore((state) => state.player);
  const connected = usePlayerStore((state) => state.connected);
  const error = usePlayerStore((state) => state.error);
  const closed = usePlayerStore((state) => state.closed);
  const combat = usePlayerStore((state) => state.combat);
  const recentCombat = usePlayerStore((state) => state.recentCombat);
  const dismissRecentCombat = usePlayerStore(
    (state) => state.dismissRecentCombat,
  );
  const leave = usePlayerStore((state) => state.leave);

  const [booting, setBooting] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBooting(true);
    void (async () => {
      const current = usePlayerStore.getState();
      let ok = Boolean(current.token && current.code === code && current.session);
      if (!ok) ok = await usePlayerStore.getState().restore(code);
      if (cancelled) return;
      setBooting(false);
      if (!ok) navigate(`/join/${code}`, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  useEffect(() => {
    if (combat || session?.status === "combat") {
      setEditing(false);
      setConfirmLeave(false);
    }
  }, [combat, session?.status]);

  const derived = useMemo(
    () =>
      character && campaign
        ? calculateStats(character, campaign.content, campaign.rules)
        : null,
    [character, campaign],
  );

  const combatLocked = session?.status === "combat";
  const canEdit = Boolean(campaign?.settings.allowPlayerEdit) && !combatLocked;

  async function handleLeave() {
    setLeaving(true);
    await leave();
    setLeaving(false);
    setConfirmLeave(false);
    setEditing(false);
    navigate(`/join/${code}`, { replace: true });
  }

  if (closed) {
    return (
      <div className="min-h-screen">
        <PlayerHeader
          campaignName={campaign?.name ?? "Mesa de jugador"}
          code={code}
          connected={false}
          closed
        />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8 sm:py-16">
          <div className="panel animate-rise p-6 text-center sm:p-10">
            <div className="mx-auto flex h-16 w-16 items-center justify-center border-2 border-ink bg-rust/15 pentagon">
              <Icon name="broadcast" size={26} />
            </div>
            <div className="mono-label mt-4 text-center">Conexión terminada</div>
            <h1 className="display mt-2 text-4xl">La sala se cerró</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
              El DM cerró esta mesa. Tu ficha queda guardada en la campaña; puedes
              volver a entrar cuando abra una sala nueva.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <LinkButton to="/" variant="accent" size="sm" icon="arrow-left">
                Volver al inicio
              </LinkButton>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (booting) {
    return (
      <div className="min-h-screen">
        <PlayerHeader
          campaignName={campaign?.name ?? "Mesa de jugador"}
          code={code}
          connected={connected}
        />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
          <LoadingBlock label="Recuperando tu ficha…" />
        </main>
      </div>
    );
  }

  if (!campaign || !character || !player || !session || !derived) {
    return (
      <div className="min-h-screen">
        <PlayerHeader
          campaignName={campaign?.name ?? "Mesa de jugador"}
          code={code}
          connected={connected}
        />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8 sm:py-16">
          <div className="panel animate-rise p-6 text-center sm:p-10">
            <div className="mx-auto flex h-16 w-16 items-center justify-center border-2 border-ink bg-amber/25 hexagon">
              <Icon name="alert" size={26} />
            </div>
            <h1 className="display mt-4 text-3xl">Tu ficha no está disponible</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
              No pudimos cargar tu personaje en esta mesa. Vuelve a la sala de
              espera para entrar de nuevo.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <LinkButton
                to={`/join/${code}`}
                variant="accent"
                size="sm"
                icon="broadcast"
              >
                Ir a la sala de espera
              </LinkButton>
              <LinkButton to="/" variant="ghost" size="sm" icon="arrow-left">
                Volver al estudio
              </LinkButton>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // La mesa entra en combate: la ficha pasa a solo lectura y se muestra la
  // pantalla de combate. Se mantiene el resultado hasta que el jugador vuelve.
  if (session.status === "combat" || combat) {
    return (
      <div className="min-h-screen">
        <PlayerHeader
          campaignName={campaign.name}
          code={code}
          connected={connected}
          hideNav
        />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-10">
          <PlayerCombatView
            campaign={campaign}
            character={character}
            session={session}
            code={code}
            connected={connected}
          />
        </main>
      </div>
    );
  }

  const itemsById = new Map(campaign.content.items.map((item) => [item.id, item]));
  const skillsById = new Map(
    campaign.content.skills.map((skill) => [skill.id, skill]),
  );
  const specialsById = new Map(
    campaign.content.specials.map((special) => [special.id, special]),
  );
  const equippedSkills = character.skills
    .map((skillId) => (skillId ? skillsById.get(skillId) : null))
    .filter((skill): skill is Skill => Boolean(skill));

  return (
    <div className="min-h-screen">
      <PlayerHeader
        campaignName={campaign.name}
        code={code}
        connected={connected}
        onLeave={() => setConfirmLeave(true)}
      />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
        {error ? (
          <div className="mb-4 flex items-start gap-2 border-2 border-rust bg-rust/10 p-3 text-rust-deep">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <p className="text-xs font-semibold leading-relaxed">{error}</p>
          </div>
        ) : null}

        {recentCombat ? (
          <div className="mb-5">
            <CombatResultPanel
              campaign={campaign}
              combat={recentCombat}
              onDismiss={dismissRecentCombat}
              eyebrow="Tu último combate (reconexión)"
            />
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <section className="panel animate-rise overflow-hidden">
              <div className="grid sm:grid-cols-[190px_minmax(0,1fr)]">
                <div className="relative min-h-[190px] border-b-2 border-ink bg-grid bg-paper-deep sm:border-b-0 sm:border-r-2">
                  {character.portrait ? (
                    <img
                      src={character.portrait}
                      alt={character.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full min-h-[190px] items-center justify-center">
                      <div className="flex h-24 w-24 items-center justify-center border-2 border-ink bg-paper-light pentagon">
                        <span className="font-display text-3xl text-ink-faint">
                          {character.name.slice(0, 1).toUpperCase()}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2">
                    <span className="border border-ink bg-paper-light px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
                      Tu ficha
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mono-label">
                        {player.name} · jugador
                      </div>
                      <h1 className="display mt-1 text-3xl sm:text-4xl">
                        {character.name}
                      </h1>
                    </div>
                    {editing ? (
                      <span className="chip chip-accent">Borrador abierto</span>
                    ) : canEdit ? (
                      <Button
                        type="button"
                        variant="accent"
                        size="sm"
                        icon="edit"
                        onClick={() => setEditing(true)}
                      >
                        Editar ficha
                      </Button>
                    ) : (
                      <span className="chip">Solo lectura</span>
                    )}
                  </div>

                  <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                    {character.description || "Sin descripción todavía."}
                  </p>

                  {character.tags?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {character.tags.slice(0, 6).map((tag) => (
                        <span key={tag} className="chip">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 grid grid-cols-3 gap-px border-2 border-ink bg-ink/25 sm:grid-cols-6">
                    {STAT_KEYS.map((key) => (
                      <div key={key} className="bg-paper-light px-2 py-2 text-center">
                        <div className="font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                          {key === "hpMax" ? "HP" : STAT_LABELS[key]}
                        </div>
                        <div className="font-display text-xl leading-tight">
                          {derived.stats[key]}
                        </div>
                      </div>
                    ))}
                  </div>

                  {!canEdit ? (
                    <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-snug text-rust-deep">
                      <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                      {!campaign.settings.allowPlayerEdit
                        ? "El DM no permite que los jugadores editen su ficha."
                        : "No se puede editar la ficha durante el combate."}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            {editing ? (
              <PlayerSheetEditor
                character={character}
                campaign={campaign}
                onCancel={() => setEditing(false)}
                onSaved={() => setEditing(false)}
              />
            ) : (
              <>
                <section className="panel p-4">
                  <SectionTitle
                    title="Stats derivados"
                    action={
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
                        equipo + efectos
                      </span>
                    }
                  />
                  <StatPanel derived={derived} rules={campaign.rules} />
                </section>

                <section className="panel p-4">
                  <SectionTitle title="Equipo y skills" />
                  <EquipmentDoll
                    character={character}
                    items={campaign.content.items}
                    skills={campaign.content.skills}
                    effects={campaign.content.effects}
                    baseImage={campaign.settings.baseCharacterImage}
                    derived={derived.stats}
                    editable={false}
                  />
                </section>

                <section className="panel p-4">
                  <SectionTitle title="Detalle de skills y especiales" />
                  <div className="space-y-2">
                    {character.skills.map((skillId, index) => {
                      const skill = skillId ? skillsById.get(skillId) : null;
                      return (
                        <div
                          key={index}
                          className={cx(
                            "flex flex-wrap items-center gap-3 border-2 p-2",
                            skill
                              ? "border-ink/30 bg-paper/50"
                              : "border-dashed border-ink/20",
                          )}
                        >
                          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                            Slot {index + 1}
                          </span>
                          {skill ? (
                            <>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold">{skill.name}</div>
                                <CoinRow coins={skill.coins} />
                              </div>
                              <div className="font-mono text-[9px] text-ink-soft">
                                clash {skill.baseClash}+{skill.coinClash}/c · daño{" "}
                                {skill.baseDamage}
                                {signed(skill.coinDamage)}/c
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-ink-faint">Vacío</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {(["domainId", "habitatId"] as const).map((field) => {
                      const specialId = character.special?.[field];
                      const special = specialId ? specialsById.get(specialId) : null;
                      return (
                        <div
                          key={field}
                          className="border-2 border-ink/30 bg-paper/50 p-2"
                        >
                          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ink-faint">
                            {field === "domainId" ? "Dominio" : "Hábitat"}
                          </div>
                          <div className="text-xs font-semibold">
                            {special?.name ?? "Vacío"}
                          </div>
                          {special ? (
                            <div className="mt-0.5 font-mono text-[9px] text-ink-faint">
                              {special.duration} turnos ·{" "}
                              {special.oncePerCombat ? "1/combate" : "reusable"}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {equippedSkills.length === 0 ? (
                    <p className="mt-3 text-[11px] text-ink-faint">
                      No tienes skills equipadas. Puedes añadirlas desde «Editar
                      ficha».
                    </p>
                  ) : null}
                </section>

                <section className="panel p-4">
                  <SectionTitle title="Inventario" count={character.inventory.length} />
                  {character.inventory.length === 0 ? (
                    <p className="text-sm text-ink-soft">
                      Sin objetos en el inventario.
                    </p>
                  ) : (
                    <div className="divide-y divide-ink/10">
                      {character.inventory.map((entry, index) => {
                        const item = itemsById.get(entry.itemId);
                        return (
                          <div
                            key={index}
                            className="flex items-center justify-between gap-2 py-1.5"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <Icon
                                name="cube"
                                size={13}
                                className="shrink-0 text-ink-faint"
                              />
                              <span className="truncate text-xs font-semibold">
                                {item?.name ?? "Objeto borrado"}
                              </span>
                              {item?.code ? (
                                <span className="font-mono text-[9px] text-ink-faint">
                                  {item.code}
                                </span>
                              ) : null}
                            </div>
                            <span className="font-mono text-[10px] text-ink-soft">
                              ×{entry.qty}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          <PartyColumn
            session={session}
            content={campaign.content}
            rules={campaign.rules}
            selfId={player.id}
          />
        </div>
      </main>

      <ConfirmDialog
        open={confirmLeave}
        title="Salir de la mesa"
        message={
          <>
            ¿Quieres salir de la sala <strong>«{code}»</strong>? Tu ficha se libera
            para que otro jugador pueda elegirla.
          </>
        }
        confirmLabel="Salir"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => void handleLeave()}
        busy={leaving}
      />
    </div>
  );
}

function PlayerHeader({
  campaignName,
  code,
  connected,
  onLeave,
  closed = false,
  hideNav = false,
}: {
  campaignName: string;
  code: string;
  connected: boolean;
  onLeave?: () => void;
  closed?: boolean;
  /** Durante el combate no se ofrece salir de la mesa. */
  hideNav?: boolean;
}) {
  return (
    <header className="border-b-2 border-ink bg-ink text-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-paper/60 bg-paper pentagon">
            <span className="font-display text-sm text-rust">PL</span>
          </div>
          <div>
            <div className="font-display text-base leading-none tracking-wide">
              PROTOCOL LIFE
            </div>
            <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.22em] text-paper/50">
              Mesa de jugador
            </div>
          </div>
        </div>

        <div className="hidden h-8 w-px bg-paper/20 sm:block" />

        <div className="min-w-0">
          <div className="truncate font-display text-lg leading-tight">
            {campaignName}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-paper/50">
            Sala <span className="text-amber">{code}</span>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 border border-paper/25 px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-paper/70">
            <span
              className={cx(
                "inline-block h-2 w-2 rounded-full",
                closed
                  ? "bg-rust"
                  : connected
                    ? "bg-emerald-400"
                    : "bg-amber",
              )}
            />
            {closed ? "Sala cerrada" : connected ? "En línea" : "Reconectando"}
          </span>
          {onLeave ? (
            <Button
              type="button"
              variant="dark-ghost"
              size="sm"
              icon="arrow-left"
              onClick={onLeave}
            >
              Salir
            </Button>
          ) : hideNav ? null : (
            <Link
              to="/"
              className="inline-flex items-center gap-2 border border-paper/30 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-paper/70 transition-colors hover:border-paper hover:text-paper"
            >
              <Icon name="arrow-left" size={13} />
              Volver al estudio
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function PartyColumn({
  session,
  content,
  rules,
  selfId,
}: {
  session: PublicSession;
  content: CampaignContent;
  rules: Ruleset;
  selfId: string;
}) {
  return (
    <aside className="space-y-4">
      <div className="panel p-4">
        <SectionTitle title="La party" count={session.players.length} />
        <div className="space-y-2">
          {session.players.length === 0 ? (
            <p className="text-sm text-ink-soft">Todavía no hay jugadores.</p>
          ) : (
            session.players.map((entry) => (
              <PartyCard
                key={entry.id}
                player={entry}
                content={content}
                rules={rules}
                isSelf={entry.id === selfId}
              />
            ))
          )}
        </div>
      </div>

      <div className="panel p-4">
        <SectionTitle title="Estado de la mesa" />
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
              Fase
            </span>
            <span className="chip chip-accent">
              {SESSION_STATUS_LABELS[session.status]}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
              DM
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft">
              <span
                className={cx(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  session.dmConnected ? "bg-moss" : "bg-ink-faint",
                )}
              />
              {session.dmConnected ? "En la mesa" : "Desconectado"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
              Sala
            </span>
            <span className="font-mono text-[10px] font-bold tracking-[0.14em] text-ink">
              {session.code}
            </span>
          </div>
        </div>
        <p className="mt-3 border-t border-ink/15 pt-2 text-[10px] leading-snug text-ink-faint">
          Solo ves la party y tu ficha. Los enemigos y las notas del DM quedan en su
          pantalla.
        </p>
      </div>
    </aside>
  );
}

function PartyCard({
  player,
  content,
  rules,
  isSelf,
}: {
  player: PublicSessionPlayer;
  content: CampaignContent;
  rules: Ruleset;
  isSelf: boolean;
}) {
  const character = player.characterId
    ? (content.characters.find((entry) => entry.id === player.characterId) ?? null)
    : null;
  const derived = character ? calculateStats(character, content, rules) : null;

  return (
    <div
      className={cx(
        "border-2 p-2.5",
        isSelf ? "border-ink bg-amber/15" : "border-ink/25 bg-paper/50",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="relative h-11 w-10 shrink-0 overflow-hidden border-2 border-ink bg-paper-light">
          {character?.portrait ? (
            <img
              src={character.portrait}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-base text-ink-faint">
              {(character?.name ?? player.name).slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">
              {character?.name ?? player.name}
            </span>
            {isSelf ? <span className="chip shrink-0">Tú</span> : null}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ink-faint">
            <span
              className={cx(
                "inline-block h-1.5 w-1.5 rounded-full",
                player.connected ? "bg-moss" : "bg-ink-faint",
              )}
            />
            {player.connected ? "En línea" : "Desconectado"}
            {!isSelf ? " · jugador" : ""}
          </div>
        </div>
      </div>

      {derived ? (
        <div className="mt-2 grid grid-cols-4 gap-px border border-ink/25 bg-ink/20">
          {[
            ["HP", derived.stats.hpMax],
            ["DEF", derived.stats.def],
            ["ATK", derived.stats.atk],
            ["Slots", derived.stats.skillSlots],
          ].map(([label, value]) => (
            <div key={label} className="bg-paper-light px-1 py-1.5 text-center">
              <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-ink-faint">
                {label}
              </div>
              <div className="font-display text-sm leading-tight">{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-ink-faint">Ficha no disponible.</p>
      )}
    </div>
  );
}
