import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  Campaign,
  CoinRoll,
  CombatEvent,
  CombatUnit,
  PublicCombatState,
} from "@protocol-life/shared";
import { Icon } from "../Icons";
import { findSkill, unitById } from "../../lib/combat";
import {
  clashViewsFromEvents,
  damageTakenBy,
  damagesForClash,
  type ClashDamage,
  type ClashView,
} from "../../lib/clash";

/**
 * Cinemática de clash (Fase 3F.5).
 *
 * Solo revela lo que el servidor ya resolvió: encola los eventos `clash`
 * nuevos y los reproduce de uno en uno (monedas, totales, perdedor tachado y
 * daño). Nunca bloquea la lógica ni modifica el estado del combate. El daño
 * llega en los `damage` posteriores, así que se correlaciona por evento.
 */

type ClashViewer = { role: "dm" } | { role: "player"; characterId: string };

/**
 * Tiempo en pantalla de cada clash antes de pasar al siguiente. Incluye 2 s
 * extra para leer el resultado; la barra `.sv-clash-timer` refleja este mismo
 * valor.
 */
const ADVANCE_MS = 4800;

export interface ClashCinematicProps {
  combat: PublicCombatState;
  campaign: Campaign;
  viewer: ClashViewer;
  events: CombatEvent[];
}

interface SideData {
  unit: CombatUnit;
  skillName: string;
  roll?: CoinRoll;
  isWinner: boolean;
  isLoser: boolean;
  damageTaken: number;
  damageDealt: number;
  damage?: ClashDamage;
  withoutResponse: boolean;
}

export function ClashCinematic({
  combat,
  campaign,
  viewer,
  events,
}: ClashCinematicProps) {
  const [pending, setPending] = useState<ClashView[]>([]);
  const cursorRef = useRef<number | null>(null);
  const combatIdRef = useRef(combat.id);

  // Combate nuevo: se descarta la cola y se salta el log existente.
  useEffect(() => {
    if (combatIdRef.current === combat.id) return;
    combatIdRef.current = combat.id;
    cursorRef.current = events.length;
    setPending([]);
  }, [combat.id, events.length]);

  // Al montar se salta el histórico (reconexión/recarga); después solo se
  // encolan los clash que llegan por `combat:event`.
  useEffect(() => {
    if (cursorRef.current === null) {
      cursorRef.current = events.length;
      return;
    }
    if (events.length < cursorRef.current) {
      cursorRef.current = events.length;
      setPending([]);
      return;
    }
    if (events.length === cursorRef.current) return;
    const from = cursorRef.current;
    cursorRef.current = events.length;
    const views = clashViewsFromEvents(events, from);
    if (views.length > 0) setPending((queue) => [...queue, ...views]);
  }, [events]);

  const current = pending[0] ?? null;
  const content = campaign.content;
  const attacker = current ? unitById(combat, current.attackerId) : null;
  const defender = current ? unitById(combat, current.defenderId) : null;
  const attackerSkill = current
    ? findSkill(content, current.attackerSkillId)
    : null;
  const defenderSkill = current
    ? findSkill(content, current.defenderSkillId)
    : null;

  const damages = useMemo(
    () => (current ? damagesForClash(events, current) : []),
    [current, events],
  );

  const next = () => setPending((queue) => queue.slice(1));
  const skip = () => setPending([]);

  // Auto-avance. Si el daño aún no llegó, espera al siguiente render: la
  // cinemática no debe cerrarse antes de mostrar el golpe.
  useEffect(() => {
    if (!current) return;
    if (!current.cancelled && damages.length === 0) return;
    const timer = window.setTimeout(next, ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [current, damages.length]);

  useEffect(() => {
    if (!current) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPending([]);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current]);

  if (!current || !attacker || !defender) return null;

  const winnerId =
    current.winner === "attacker"
      ? current.attackerId
      : current.winner === "defender"
        ? current.defenderId
        : null;
  const loserId =
    winnerId === current.attackerId
      ? current.defenderId
      : winnerId === current.defenderId
        ? current.attackerId
        : null;
  const winnerUnit = unitById(combat, winnerId ?? undefined);

  const sideFor = (
    unit: CombatUnit,
    isAttacker: boolean,
  ): SideData => {
    const roll = isAttacker ? current.attackerRoll : current.defenderRoll;
    const skill = isAttacker ? attackerSkill : defenderSkill;
    const opponent = isAttacker ? current.defenderId : current.attackerId;
    const damage = damages.find((entry) => entry.targetId === unit.id);
    return {
      unit,
      skillName: skill?.name ?? (isAttacker ? "Ataque" : "Respuesta"),
      roll,
      isWinner: winnerId === unit.id,
      isLoser: current.cancelled || loserId === unit.id,
      damageTaken: damageTakenBy(damages, unit.id),
      damageDealt: damageTakenBy(damages, opponent),
      damage,
      withoutResponse: current.oneSided && !isAttacker,
    };
  };

  // Party a la derecha, enemigos a la izquierda; si ambos comparten bando, el
  // atacante ocupa la izquierda.
  const leftIsAttacker =
    attacker.team === "enemies" && defender.team !== "enemies";
  const left = sideFor(leftIsAttacker ? attacker : defender, leftIsAttacker);
  const right = sideFor(leftIsAttacker ? defender : attacker, !leftIsAttacker);

  const cancelled = current.cancelled;
  const timerReady = cancelled || damages.length > 0;
  const title = cancelled
    ? "EMPATE · ACCIONES CANCELADAS"
    : current.tie
      ? "TABLAS · DAÑO MUTUO"
      : current.oneSided
        ? `${attacker.name.toUpperCase()} ATACA SIN RESPUESTA`
        : `${(winnerUnit ?? attacker).name.toUpperCase()} GANA EL CLASH`;

  const totalDamage = damages.reduce((sum, damage) => sum + damage.final, 0);
  const coinCount = Math.max(
    current.attackerRoll.coins,
    current.defenderRoll?.coins ?? 0,
  );

  const barDamage = damages.find(
    (damage) => damage.hpAfter !== undefined,
  );
  const barUnit = barDamage
    ? unitById(combat, barDamage.targetId)
    : null;
  const barWidth =
    barDamage?.hpAfter !== undefined &&
    barUnit &&
    barUnit.stats.hpMax > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((barDamage.hpAfter / barUnit.stats.hpMax) * 100),
          ),
        )
      : null;

  return createPortal(
    <div
      className="sv-clash-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Cinemática de ${left.unit.name} contra ${right.unit.name}`}
    >
      <div className="sv-clash-card" key={current.id}>
        <header className="sv-clash-head">
          <div>
            <div className="sv-drawer-kicker">
              RESOLUCIÓN · RONDA {String(current.round).padStart(2, "0")}
            </div>
            <h2>{current.oneSided ? "Ataque" : "Clash"}</h2>
          </div>
          <div className="sv-clash-head-actions">
            {pending.length > 1 ? (
              <button type="button" className="sv-ghost-btn" onClick={next}>
                <Icon name="sword" size={13} /> Siguiente ({pending.length - 1})
              </button>
            ) : null}
            <button type="button" className="sv-ghost-btn" onClick={skip}>
              <Icon name="close" size={13} /> Saltar
            </button>
          </div>
        </header>

        <div className="sv-clash-timer" aria-hidden="true">
          {timerReady ? (
            <span
              key={`${current.id}:${damages.length}`}
              style={{ animationDuration: `${ADVANCE_MS}ms` }}
            />
          ) : null}
        </div>

        <div className="sv-clash-arena">
          <ClashSide side={left} />
          <div className="sv-clash-center">
            <span>{current.oneSided ? "»" : "VS"}</span>
            <small>
              {current.oneSided ? "SIN RESPUESTA" : `${coinCount} MONEDAS`}
            </small>
          </div>
          <ClashSide side={right} />
        </div>

        <div className="sv-clash-result">
          <div className="sv-clash-result-line">
            <span className="sv-clash-winner">{title}</span>
            {totalDamage > 0 ? (
              <span className="sv-clash-damage">-{totalDamage}</span>
            ) : null}
          </div>
          {barWidth !== null ? (
            <div className="sv-clash-result-bar">
              <span style={{ width: `${barWidth}%` }} />
            </div>
          ) : null}
          <div className="sv-clash-result-meta">
            {damages.map((damage) => {
              const unit = unitById(combat, damage.targetId);
              if (!unit) return null;
              return (
                <span key={`${damage.targetId}:${damage.final}`}>
                  {unit.name} · {hpAfterLabel(unit, damage, viewer)}
                </span>
              );
            })}
            <span>
              {cancelled
                ? "Ambas acciones se cancelan: no hay daño."
                : damages.length === 0
                  ? "Esperando el daño de la resolución…"
                  : "El número perdedor se tacha y el daño aparece en rojo."}
            </span>
          </div>
        </div>

        <footer className="sv-clash-foot">
          Cada clash se resuelve de uno en uno: giran las monedas, cae el
          resultado, se muestra el total y el perdedor recibe el daño. El
          servidor ya calculó todo; esto solo lo revela.
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function ClashSide({ side }: { side: SideData }) {
  const { unit, roll, isWinner, isLoser } = side;
  return (
    <div
      className={`sv-clash-side sv-clash-side--${unit.team}`}
      data-winner={isWinner ? "true" : undefined}
    >
      <div className="sv-clash-side-head">
        <span>
          {unit.team === "players" ? "PARTY" : "HOSTIL"} · {unit.name}
        </span>
        <b>{side.skillName}</b>
      </div>

      {roll && !side.withoutResponse ? (
        <>
          <div className="sv-clash-coins">
            {roll.faces.map((heads, index) => (
              <span
                key={index}
                className={`sv-clash-coin ${heads ? "is-head" : "is-tail"}`}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                {heads ? "C" : "X"}
              </span>
            ))}
          </div>
          <div
            className={[
              "sv-clash-total",
              isWinner ? "is-winner" : "",
              isLoser ? "is-loser" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {roll.clashPower}
          </div>
          <div className="sv-clash-side-foot">
            <span>
              {roll.heads}/{roll.coins} caras
            </span>
            {side.damageTaken > 0 ? (
              <b>-{side.damageTaken} HP</b>
            ) : side.damageDealt > 0 ? (
              <b>+{side.damageDealt} daño</b>
            ) : (
              <span>Sin daño</span>
            )}
          </div>
        </>
      ) : (
        <div className="sv-clash-empty">Sin defensa</div>
      )}
    </div>
  );
}

function hpAfterLabel(
  unit: CombatUnit,
  damage: ClashDamage,
  viewer: ClashViewer,
): string {
  if (damage.hpAfter === undefined) return "HP —";
  const max = unit.stats.hpMax;
  if (viewer.role === "dm" || unit.team === "players") {
    return damage.hpBefore === undefined
      ? `HP ${damage.hpAfter}/${max}`
      : `HP ${damage.hpBefore}/${max} → ${damage.hpAfter}/${max}`;
  }
  const percent = (hp: number) =>
    max > 0 ? Math.round((hp / max) * 100) : 0;
  return damage.hpBefore === undefined
    ? `HP ≈${percent(damage.hpAfter)}%`
    : `HP ≈${percent(damage.hpBefore)}% → ≈${percent(damage.hpAfter)}%`;
}
