import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CampaignContent,
  CombatEvent,
  CombatEventType,
  CombatUnit,
} from "@protocol-life/shared";
import { Icon, type IconName } from "../Icons";
import { Button, SectionTitle, cx } from "../ui";

/**
 * Timeline del combate.
 *
 * El estado ya está resuelto en el servidor; esto solo revela en orden los
 * eventos que llegan por `combat:event`. El botón de reproducir reinicia la
 * revelación y «Saltar» muestra todo de golpe. Nunca bloquea la lógica.
 */

const EVENT_LABEL: Record<CombatEventType, string> = {
  roundStart: "Inicio de ronda",
  actionDeclared: "Declaración",
  clash: "Clash",
  redirect: "Redirección",
  special: "Especial",
  damage: "Daño",
  heal: "Curación",
  effectApplied: "Efecto",
  effectTick: "Tick de efecto",
  cooldown: "Cooldown",
  defeated: "Derrota",
  roundEnd: "Fin de ronda",
  combatEnd: "Fin del combate",
};

const EVENT_ICON: Record<CombatEventType, IconName> = {
  roundStart: "broadcast",
  actionDeclared: "lock",
  clash: "sword",
  redirect: "shield",
  special: "spark",
  damage: "flame",
  heal: "plus",
  effectApplied: "spark",
  effectTick: "flame",
  cooldown: "lock",
  defeated: "skull",
  roundEnd: "broadcast",
  combatEnd: "skull",
};

const EVENT_TONE: Record<CombatEventType, string> = {
  roundStart: "border-ui-line bg-ui-surface-3",
  actionDeclared: "border-ui-line bg-ui-surface-2",
  clash: "border-amber bg-amber/15",
  redirect: "border-steel bg-steel/10",
  special: "border-rust bg-rust/10",
  damage: "border-rust bg-rust/10",
  heal: "border-moss bg-moss/10",
  effectApplied: "border-amber bg-amber/10",
  effectTick: "border-amber/70 bg-amber/5",
  cooldown: "border-ui-line bg-ui-surface-2",
  defeated: "border-ui-line-strong bg-ui-surface-3 text-ui",
  roundEnd: "border-ui-line bg-ui-surface-3",
  combatEnd: "border-rust bg-rust/15",
};

interface RollLike {
  coins?: number;
  heads?: number;
  clashPower?: number;
  rawDamage?: number;
}

function asRoll(value: unknown): RollLike | null {
  if (!value || typeof value !== "object") return null;
  const roll = value as RollLike;
  if (
    typeof roll.coins !== "number" &&
    typeof roll.heads !== "number" &&
    typeof roll.clashPower !== "number"
  ) {
    return null;
  }
  return roll;
}

function rollText(label: string, roll: RollLike): string {
  const heads = roll.heads ?? 0;
  const coins = roll.coins ?? 0;
  const parts = [`${label} ${heads}/${coins} caras`];
  if (typeof roll.clashPower === "number") parts.push(`clash ${roll.clashPower}`);
  if (typeof roll.rawDamage === "number") parts.push(`bruto ${roll.rawDamage}`);
  return parts.join(" · ");
}

function eventDetails(
  event: CombatEvent,
  units: CombatUnit[],
  hideEnemyHp: boolean,
): string[] {
  const data = event.data ?? {};
  const details: string[] = [];

  const attackerRoll = asRoll(data.attackerRoll);
  const defenderRoll = asRoll(data.defenderRoll);
  if (attackerRoll) details.push(rollText("Atacante", attackerRoll));
  if (defenderRoll) details.push(rollText("Defensor", defenderRoll));

  if (typeof data.final === "number") {
    details.push(`${data.final} de daño final`);
  }
  if (typeof data.amount === "number") {
    details.push(`+${data.amount} HP`);
  }
  if (typeof data.stacks === "number") {
    details.push(`${data.stacks} stack${data.stacks === 1 ? "" : "s"}`);
  }
  if (typeof data.remaining === "number") {
    details.push(`${data.remaining} ronda${data.remaining === 1 ? "" : "s"}`);
  }
  if (typeof data.hpBefore === "number" && typeof data.hpAfter === "number") {
    const target = units.find((unit) => unit.id === event.targetId);
    if (hideEnemyHp && target?.team === "enemies") {
      const percent = (hp: number) =>
        target.stats.hpMax > 0
          ? Math.round((hp / target.stats.hpMax) * 100)
          : 0;
      details.push(`HP ${percent(data.hpBefore)}% → ${percent(data.hpAfter)}%`);
    } else {
      details.push(`HP ${data.hpBefore} → ${data.hpAfter}`);
    }
  }
  if (data.oneSided === true) details.push("sin respuesta");

  return details;
}

export interface CombatLogProps {
  events: CombatEvent[];
  units: CombatUnit[];
  content: Pick<CampaignContent, "skills" | "effects" | "specials">;
  emptyLabel?: string;
  /** Regla 3F.5: los jugadores ven el HP enemigo en porcentaje. */
  hideEnemyHp?: boolean;
}

export function CombatLog({
  events,
  units,
  content,
  emptyLabel = "Todavía no hay eventos en el log.",
  hideEnemyHp = false,
}: CombatLogProps) {
  const [revealed, setRevealed] = useState(events.length);
  const [playing, setPlaying] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const unitNames = useMemo(
    () => new Map(units.map((unit) => [unit.id, unit.name])),
    [units],
  );

  useEffect(() => {
    if (!playing) setRevealed(events.length);
  }, [events, playing]);

  useEffect(() => {
    if (!playing) return;
    if (revealed >= events.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setRevealed((current) => Math.min(events.length, current + 1));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [playing, revealed, events.length]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [revealed]);

  function replay() {
    setRevealed(0);
    setPlaying(true);
  }

  function skip() {
    setPlaying(false);
    setRevealed(events.length);
  }

  const visible = events.slice(0, revealed);

  return (
    <section className="panel p-4">
      <SectionTitle
        title="Log de combate"
        count={events.length}
        action={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="spark"
              onClick={replay}
              disabled={events.length === 0 || playing}
            >
              Reproducir
            </Button>
            {playing ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="chevron-down"
                onClick={skip}
              >
                Saltar
              </Button>
            ) : null}
          </div>
        }
      />
      <div
        ref={scrollRef}
        className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1"
        aria-live="polite"
        aria-label="Eventos del combate"
      >
        {visible.length === 0 ? (
          <p className="py-6 text-center text-xs text-ui-faint">
            {playing ? "Preparando la timeline…" : emptyLabel}
          </p>
        ) : (
          visible.map((event) => {
            const details = eventDetails(event, units, hideEnemyHp);
            return (
              <article
                key={event.id}
                className={cx(
                  "animate-fade border-l-4 border-y border-r px-2.5 py-2",
                  EVENT_TONE[event.type],
                )}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    name={EVENT_ICON[event.type]}
                    size={13}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[8px] font-bold uppercase tracking-[0.16em] opacity-70">
                        R{event.round} · {EVENT_LABEL[event.type]}
                      </span>
                      {event.actorId || event.targetId ? (
                        <span className="font-mono text-[8px] uppercase tracking-[0.1em] opacity-60">
                          {unitNames.get(event.actorId ?? "") ??
                            event.actorId ??
                            ""}
                          {event.actorId && event.targetId ? " → " : ""}
                          {unitNames.get(event.targetId ?? "") ??
                            event.targetId ??
                            ""}
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={cx(
                        "mt-0.5 text-[11px] leading-snug",
                        event.type === "combatEnd" &&
                          "font-display text-lg uppercase leading-tight",
                      )}
                    >
                      {event.message}
                    </p>
                    {details.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {details.map((detail, index) => (
                          <span
                            key={`${detail}:${index}`}
                            className="border border-current px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] opacity-80"
                          >
                            {detail}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
      <p className="mt-2 border-t border-ui-line pt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-ui-faint">
        {content.effects.length + content.specials.length} definiciones de efecto ·
        el servidor ya calculó todos los resultados
      </p>
    </section>
  );
}
