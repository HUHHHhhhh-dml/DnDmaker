import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DiceRoll } from "@protocol-life/shared";
import {
  isHeld,
  useDiceCinematicVersion,
} from "../../lib/diceCinematic";
import { Icon } from "../Icons";
import { DiceIcon } from "./DiceIcon";
import "./DiceRollToast.css";

const TOAST_MS = 5000;

/**
 * Los ids vistos viven a nivel de módulo: el header se remonta al cambiar de
 * vista (combate, mazmorra, tienda, hoja) y no queremos repetir pops viejos.
 */
const seenDiceRollIds = new Set<string>();

/**
 * Pop de una tirada compartida. Se muestran en cola: si llegan varias tiradas
 * seguidas, cada una ocupa su turno durante 5 s en vez de apilar overlays.
 */
export function DiceRollToast({ rolls }: { rolls: DiceRoll[] }) {
  const [current, setCurrent] = useState<DiceRoll | null>(null);
  const cinematicVersion = useDiceCinematicVersion();

  useEffect(() => {
    if (current) return;
    const next = rolls.find(
      (roll) => !seenDiceRollIds.has(roll.id) && !isHeld(roll),
    );
    if (next) {
      seenDiceRollIds.add(next.id);
      setCurrent(next);
    }
  }, [rolls, current, cinematicVersion]);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setCurrent(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [current]);

  useEffect(() => {
    if (rolls.length === 0 && current) setCurrent(null);
  }, [rolls.length, current]);

  if (!current || typeof document === "undefined") return null;

  return createPortal(
    <div
      key={current.id}
      className="dice-toast"
      role="status"
      aria-live="polite"
      aria-label={`${current.roller.name} tiró ${current.count}d${current.sides}: ${current.result}`}
    >
      <button
        type="button"
        className="dice-toast-close"
        onClick={() => setCurrent(null)}
        aria-label="Cerrar tirada"
      >
        <Icon name="close" size={12} />
      </button>
      <div className="dice-toast-icon">
        <DiceIcon sides={current.sides} size={54} />
      </div>
      <div className="dice-toast-body">
        <div className="dice-toast-kicker">
          {current.roller.role === "dm" ? "DM" : "Jugador"} · {current.count}d
          {current.sides}
        </div>
        <div className="dice-toast-name">{current.roller.name}</div>
        <div className="dice-toast-result">{current.result}</div>
        {current.count > 1 ? (
          <div className="dice-toast-breakdown">
            {current.results.join(" + ")}
          </div>
        ) : null}
      </div>
      <div className="dice-toast-progress" aria-hidden="true" />
    </div>,
    document.body,
  );
}
