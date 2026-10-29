import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { DiceRoll } from "@protocol-life/shared";
import { diceOutcome, type DiceOutcomeKind } from "../../lib/dice";
import {
  isHeld,
  useDiceCinematicVersion,
} from "../../lib/diceCinematic";
import { DiceIcon } from "./DiceIcon";
import { playDiceCelebration } from "../../lib/diceSound";
import "./DiceCelebration.css";

const DURATION_MS: Record<DiceOutcomeKind, number> = {
  nat20: 2200,
  nat1: 1500,
};

const seenCelebrationIds = new Set<string>();

interface Spark {
  left: string;
  delay: string;
  duration: string;
  drift: string;
  size: string;
  rotate: string;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** Chispas deterministas por tirada: mismas posiciones si React re-renderiza. */
function makeSparks(id: string): Spark[] {
  let state = hash(id) || 1;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return Array.from({ length: 46 }, () => ({
    left: `${(random() * 100).toFixed(2)}%`,
    delay: `${Math.round(random() * 420)}ms`,
    duration: `${Math.round(1100 + random() * 900)}ms`,
    drift: `${Math.round(-90 + random() * 180)}px`,
    size: `${(2.5 + random() * 4).toFixed(1)}px`,
    rotate: `${Math.round(random() * 360)}deg`,
  }));
}

/**
 * Celebración de Nat 20 (brillitos dorados) o Nat 1 (borde rojo + rumble).
 * Es puramente visual: no toca reglas, dados ni servidor. Cola de una en una.
 */
export function DiceCelebration({ rolls }: { rolls: DiceRoll[] }) {
  const [current, setCurrent] = useState<{
    roll: DiceRoll;
    kind: DiceOutcomeKind;
    hits: number;
  } | null>(null);
  const cinematicVersion = useDiceCinematicVersion();

  useEffect(() => {
    if (current) return;
    for (const roll of rolls) {
      if (seenCelebrationIds.has(roll.id) || isHeld(roll)) continue;
      const outcome = diceOutcome(roll);
      if (!outcome) {
        seenCelebrationIds.add(roll.id);
        continue;
      }
      seenCelebrationIds.add(roll.id);
      setCurrent({ roll, kind: outcome.kind, hits: outcome.hits });
      return;
    }
  }, [rolls, current, cinematicVersion]);

  useEffect(() => {
    if (!current) return;
    playDiceCelebration(current.roll.id, current.kind);
    const duration = DURATION_MS[current.kind];
    const timer = window.setTimeout(() => setCurrent(null), duration);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (current.kind === "nat1" && !reduced) {
      document.body.classList.add("dice-rumble");
    }
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove("dice-rumble");
    };
  }, [current]);

  useEffect(() => {
    if (rolls.length === 0 && current) setCurrent(null);
  }, [rolls.length, current]);

  const sparks = useMemo(
    () => (current?.kind === "nat20" ? makeSparks(current.roll.id) : []),
    [current],
  );

  if (!current || typeof document === "undefined") return null;

  const title =
    current.kind === "nat20"
      ? current.hits > 1
        ? `¡NAT 20 ×${current.hits}!`
        : "¡NAT 20!"
      : current.hits > 1
        ? `¡NAT 1 ×${current.hits}!`
        : "¡NAT 1!";

  return createPortal(
    <div
      key={current.roll.id}
      className={`dice-celebration is-${current.kind}`}
      role="status"
      aria-live="polite"
      aria-label={`${current.roll.roller.name}: ${title}`}
    >
      {current.kind === "nat20" ? (
        <div className="dice-celebration-sparks" aria-hidden="true">
          {sparks.map((spark, index) => (
            <span
              key={index}
              className="dice-spark"
              style={
                {
                  "--spark-left": spark.left,
                  "--spark-delay": spark.delay,
                  "--spark-duration": spark.duration,
                  "--spark-drift": spark.drift,
                  "--spark-size": spark.size,
                  "--spark-rotate": spark.rotate,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
      <div className="dice-celebration-copy">
        <div className="dice-celebration-die" aria-hidden="true">
          <DiceIcon sides={20} size={72} />
        </div>
        <div className="dice-celebration-kicker">
          {current.roll.roller.role === "dm" ? "DM" : "Jugador"} ·{" "}
          {current.roll.count}d20
        </div>
        <div className="dice-celebration-title">{title}</div>
        <div className="dice-celebration-name">{current.roll.roller.name}</div>
        <div className="dice-celebration-result">
          {current.roll.results.join(" + ")}
        </div>
      </div>
    </div>,
    document.body,
  );
}
