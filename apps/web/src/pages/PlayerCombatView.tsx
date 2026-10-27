import { useEffect, useMemo, useRef } from "react";
import {
  SESSION_STATUS_LABELS,
  type Campaign,
  type Character,
  type CombatUnit,
  type PublicCombatState,
  type PublicSession,
} from "@protocol-life/shared";
import { CombatantCard } from "../components/combat/CombatantCard";
import { CombatDeclarationPanel } from "../components/combat/CombatDeclarationPanel";
import { CombatLog } from "../components/combat/CombatLog";
import { Icon } from "../components/Icons";
import { Button, Spinner, cx } from "../components/ui";
import {
  combatHasMissingContent,
  declaredActionsForUnit,
  declaredSkillId,
  isAliveUnit,
  isUnitLocked,
  latestSkillIdForUnit,
  turnOrder,
} from "../lib/combat";
import { usePlayerStore } from "../store/usePlayerStore";

/**
 * Pantalla de combate del jugador (Fase 3E).
 *
 * Side-view híbrido, tarjetas por unidad, declaración por slots y timeline de
 * eventos. Todo el estado y los resultados vienen del servidor: aquí solo se
 * eligen intenciones y se pinta lo que ya llegó por Socket.IO.
 */

const PHASE_LABELS: Record<PublicCombatState["phase"], string> = {
  declaring: "Declaración",
  resolving: "Resolviendo",
  ended: "Terminado",
};

export interface PlayerCombatViewProps {
  campaign: Campaign;
  character: Character;
  session: PublicSession;
  code: string;
  connected: boolean;
}

export function PlayerCombatView({
  campaign,
  character,
  session,
  code,
  connected,
}: PlayerCombatViewProps) {
  const combat = usePlayerStore((state) => state.combat);
  const combatEvents = usePlayerStore((state) => state.combatEvents);
  const combatError = usePlayerStore((state) => state.combatError);
  const error = usePlayerStore((state) => state.error);
  const declareCombat = usePlayerStore((state) => state.declareCombat);
  const lockCombat = usePlayerStore((state) => state.lockCombat);
  const dismissCombat = usePlayerStore((state) => state.dismissCombat);
  const clearCombatError = usePlayerStore((state) => state.clearCombatError);
  const refresh = usePlayerStore((state) => state.refresh);

  const content = campaign.content;
  const units = combat?.units ?? [];
  const events = combatEvents.length > 0 ? combatEvents : combat?.log ?? [];
  const order = useMemo(() => turnOrder(units), [units]);
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const missingCombatContent = useMemo(
    () => (combat ? combatHasMissingContent(combat, content) : false),
    [combat, content],
  );
  const contentRetryRef = useRef<string | null>(null);

  // Red de seguridad si se perdió `campaign:refresh` y el store no pudo
  // completar el refresco al recibir `combat:started`. Un solo reintento por
  // combate evita bucles si el contenido realmente no existe.
  useEffect(() => {
    if (!combat || !connected || !missingCombatContent) return;
    if (contentRetryRef.current === combat.id) return;
    const timer = window.setTimeout(() => {
      contentRetryRef.current = combat.id;
      void refresh();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [combat, connected, missingCombatContent, refresh]);

  if (!combat) {
    return (
      <div className="animate-rise">
        <section className="panel mx-auto max-w-2xl p-6 text-center sm:p-10">
          <div className="mx-auto flex h-16 w-16 items-center justify-center border-2 border-ink bg-amber/25 hexagon">
            {connected ? <Spinner size={22} /> : <Icon name="broadcast" size={26} />}
          </div>
          <div className="mono-label mt-4">Mesa en combate</div>
          <h1 className="display mt-2 text-4xl">Esperando el estado</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
            La mesa está combatiendo. En cuanto llegue el snapshot del servidor
            verás la escena, tus slots y el log.
          </p>
          {error || combatError ? (
            <p className="mx-auto mt-3 max-w-md border-2 border-rust/40 bg-rust/5 px-3 py-2 text-xs font-semibold leading-relaxed text-rust-deep">
              {error ?? combatError}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <span className="chip">{SESSION_STATUS_LABELS[session.status]}</span>
            <span className="chip">Sala {code}</span>
            <span
              className={cx(
                "chip",
                connected ? "text-moss" : "text-rust-deep",
              )}
            >
              {connected ? "En línea" : "Reconectando…"}
            </span>
          </div>
        </section>
      </div>
    );
  }

  const ownUnit =
    units.find(
      (unit) =>
        unit.team === "players" && unit.characterId === character.id,
    ) ?? null;
  const ownLocked = ownUnit ? isUnitLocked(combat, ownUnit.id) : false;
  const party = units
    .filter((unit) => unit.team === "players")
    .sort((a, b) => b.stats.spd - a.stats.spd);
  const enemies = units
    .filter((unit) => unit.team === "enemies")
    .sort((a, b) => b.stats.spd - a.stats.spd);
  const living = units.filter(isAliveUnit);
  const lockedCount = living.filter((unit) => isUnitLocked(combat, unit.id)).length;
  const activeUnitId =
    combat.phase === "resolving" && lastEvent?.actorId
      ? lastEvent.actorId
      : undefined;
  const ended = combat.phase === "ended";
  const showGlobalCombatError = Boolean(combatError) && (!ownUnit || ended);
  const winner =
    combat.winner === "players"
      ? "Victoria de la party"
      : combat.winner === "enemies"
        ? "La party ha caído"
        : "Combate terminado";

  function weaponImageFor(unit: CombatUnit): string | undefined {
    const skillId =
      combat!.phase === "resolving"
        ? latestSkillIdForUnit(events, unit.id)
        : declaredSkillId(combat!.actions[unit.id]);
    if (!skillId) return undefined;
    return content.skills.find((skill) => skill.id === skillId)?.weaponImage;
  }

  return (
    <div className="animate-rise space-y-4">
      {(error || showGlobalCombatError) ? (
        <div className="flex items-start gap-2 border-2 border-rust bg-rust/10 p-3 text-rust-deep">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1 text-xs font-semibold leading-relaxed">
            {error ?? combatError}
          </p>
          {!error && combatError ? (
            <button
              type="button"
              onClick={clearCombatError}
              className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.12em] underline"
            >
              Cerrar
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="min-w-0 space-y-4">
          <section className="panel p-3 sm:p-4">
            <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-3">
              <div>
                <div className="mono-label flex items-center gap-2">
                  <span className="inline-block h-2 w-2 bg-rust" />
                  Protocolo de combate
                </div>
                <h1 className="display mt-1 text-3xl sm:text-4xl">
                  Ronda {combat.round}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip chip-accent">{PHASE_LABELS[combat.phase]}</span>
                <span className="chip">
                  {lockedCount}/{living.length} listos
                </span>
                <span
                  className={cx(
                    "chip",
                    connected ? "text-moss" : "text-rust-deep",
                  )}
                >
                  <span
                    className={cx(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      connected ? "bg-moss" : "bg-rust",
                    )}
                  />
                  {connected ? "En línea" : "Reconectando"}
                </span>
              </div>
            </header>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)]">
              <UnitColumn
                title="Party"
                units={party}
                order={order}
                combat={combat}
                content={content}
                ownCharacterId={character.id}
                activeUnitId={activeUnitId}
                weaponImageFor={weaponImageFor}
              />

              <div className="hidden flex-col items-center justify-center gap-2 lg:flex">
                <div className="h-full w-px flex-1 bg-ink/20" />
                <span className="flex h-10 w-10 items-center justify-center border-2 border-ink bg-paper-light font-display text-sm">
                  VS
                </span>
                <div className="h-full w-px flex-1 bg-ink/20" />
              </div>

              <UnitColumn
                title="Enemigos"
                units={enemies}
                order={order}
                combat={combat}
                content={content}
                ownCharacterId={character.id}
                activeUnitId={activeUnitId}
                weaponImageFor={weaponImageFor}
              />
            </div>

            <p className="mt-3 border-t border-ink/15 pt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-ink-faint">
              Orden por SPD · declaraciones abiertas · el servidor resuelve la
              ronda cuando todos están listos
            </p>
          </section>

          {ended ? (
            <section
              className={cx(
                "panel flex flex-wrap items-center gap-4 p-4",
                combat.winner === "players"
                  ? "border-moss bg-moss/10"
                  : combat.winner === "enemies"
                    ? "border-rust bg-rust/10"
                    : "border-ink bg-paper-deep",
              )}
            >
              <div
                className={cx(
                  "flex h-14 w-14 shrink-0 items-center justify-center border-2 border-ink",
                  combat.winner === "players"
                    ? "bg-moss/20 hexagon"
                    : "bg-rust/15 pentagon",
                )}
              >
                <Icon
                  name={combat.winner === "players" ? "spark" : "skull"}
                  size={24}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mono-label">Resultado</div>
                <h2 className="display mt-1 text-3xl">{winner}</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  El HP de la party quedó guardado. Puedes volver a tu ficha para
                  revisar el estado fuera de combate.
                </p>
              </div>
              <Button
                type="button"
                variant="accent"
                size="sm"
                icon="arrow-left"
                onClick={dismissCombat}
              >
                Volver a la ficha
              </Button>
            </section>
          ) : (
            <section className="panel flex flex-wrap items-center gap-3 p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-ink bg-paper-light pentagon">
                <Icon
                  name={
                    combat.phase === "resolving"
                      ? "spark"
                      : ownLocked
                        ? "lock"
                        : "sword"
                  }
                  size={18}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                  {combat.phase === "resolving"
                    ? "Resolviendo"
                    : ownLocked
                      ? "Esperando"
                      : "Tu turno"}
                </div>
                <p className="mt-0.5 text-xs leading-snug text-ink-soft">
                  {combat.phase === "resolving"
                    ? "El servidor está aplicando tiradas, clash, daño y efectos. El estado llegará resuelto."
                    : ownLocked
                      ? "Tu unidad está bloqueada. Esperando a que el resto de la mesa pulse Listo."
                      : "Elige hasta tus slots, guarda la declaración y bloquea cuando estés listo."}
                </p>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {ownUnit && !ended ? (
            <CombatDeclarationPanel
              unit={ownUnit}
              combat={combat}
              content={content}
              locked={ownLocked}
              connected={connected}
              error={combatError}
              onDeclare={declareCombat}
              onLock={lockCombat}
              onClearError={clearCombatError}
            />
          ) : !ownUnit && !ended ? (
            <section className="panel p-4">
              <div className="flex items-start gap-2 text-rust-deep">
                <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                <p className="text-xs font-semibold leading-relaxed">
                  Tu ficha no aparece en el snapshot de este combate. Avisa al DM.
                </p>
              </div>
            </section>
          ) : null}

          <CombatLog
            events={events}
            units={units}
            content={content}
            emptyLabel="El combate acaba de empezar; todavía no hay eventos."
          />
        </aside>
      </div>
    </div>
  );
}

function UnitColumn({
  title,
  units,
  order,
  combat,
  content,
  ownCharacterId,
  activeUnitId,
  weaponImageFor,
}: {
  title: string;
  units: CombatUnit[];
  order: Map<string, number>;
  combat: PublicCombatState;
  content: Campaign["content"];
  ownCharacterId: string;
  activeUnitId?: string;
  weaponImageFor: (unit: CombatUnit) => string | undefined;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-ink/20 pb-1">
        <h2 className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-ink-soft">
          {title}
        </h2>
        <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-ink-faint">
          {units.length} unidades
        </span>
      </div>
      {units.length === 0 ? (
        <p className="border-2 border-dashed border-ink/20 px-3 py-6 text-center text-[11px] text-ink-faint">
          Sin unidades en este bando.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {units.map((unit) => (
            <CombatantCard
              key={unit.id}
              unit={unit}
              units={combat.units}
              content={content}
              actions={declaredActionsForUnit(combat.actions, unit.id)}
              locked={isUnitLocked(combat, unit.id)}
              isSelf={
                unit.team === "players" &&
                unit.characterId === ownCharacterId
              }
              active={activeUnitId === unit.id}
              order={order.get(unit.id)}
              weaponImage={weaponImageFor(unit)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
