import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DICE_SIDES,
  type DiceRoll,
  type DiceSides,
  type DiceThrowInput,
} from "@protocol-life/shared";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useLiveStore } from "../../store/useLiveStore";
import { useDiceSkinStore } from "../../store/useDiceSkinStore";
import { DRAG_THRESHOLD_PX, throwFromDrag } from "../../lib/diceThrow";
import { uniformBounces } from "../../lib/dice3d/roll";
import {
  DICE_SKINS,
  DICE_SKIN_ORDER,
  type DiceSkinId,
} from "../../lib/diceSkin";
import { DiceIcon } from "./DiceIcon";
import { cx } from "../ui";
import "./DiceTray.css";

/** Orden de la imagen de referencia, pensado para el ancho del panel lateral. */
const DICE_ORDER: DiceSides[] = [20, 12, 100, 10, 8, 6, 4];
const MAX_DICE = 20;
const STORAGE_KEY = "protocol-life-selected-die";

function storedDie(): DiceSides {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY));
    return DICE_SIDES.includes(raw as DiceSides) ? (raw as DiceSides) : 20;
  } catch {
    return 20;
  }
}

function breakdown(roll: DiceRoll): string {
  return roll.results.join(" + ");
}

function bouncesLabel(roll: DiceRoll | null): string | null {
  if (!roll) return null;
  const bounces = uniformBounces(roll);
  if (bounces === null || bounces < 1) return null;
  return `${bounces} rebote${bounces === 1 ? "" : "s"}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function DiceTray({ viewer }: { viewer: "player" | "dm" }) {
  const playerRoll = usePlayerStore((state) => state.rollDice);
  const playerRolls = usePlayerStore((state) => state.diceRolls);
  const dmRoll = useLiveStore((state) => state.rollDice);
  const dmRolls = useLiveStore((state) => state.diceRolls);
  const skin = useDiceSkinStore((state) => state.skin);
  const setSkin = useDiceSkinStore((state) => state.setSkin);

  const rollDice = viewer === "player" ? playerRoll : dmRoll;
  const rolls = viewer === "player" ? playerRolls : dmRolls;

  const [sides, setSides] = useState<DiceSides>(() => storedDie());
  const [count, setCount] = useState(1);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<DiceRoll | null>(null);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);

  const dragStart = useRef<{
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const dragged = useRef(false);
  const suppressClickUntil = useRef(0);
  const cleanupDrag = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(sides));
    } catch {
      // localStorage puede no estar disponible; no es crítico.
    }
  }, [sides]);

  function selectDie(next: DiceSides) {
    if (rolling) return;
    setSides(next);
    setError(null);
    setLast(null);
  }

  function changeCount(delta: number) {
    if (rolling) return;
    setCount((current) => Math.min(MAX_DICE, Math.max(1, current + delta)));
    setError(null);
  }

  async function handleRoll(throwInput?: DiceThrowInput) {
    if (rolling) return;
    setRolling(true);
    setError(null);
    const result = await rollDice(sides, count, throwInput);
    if (typeof result === "string") {
      setError(result);
      setRolling(false);
      return;
    }
    setLast(result);
    window.setTimeout(() => setRolling(false), 1000);
  }

  function releasePointer(element: HTMLElement, pointerId: number): void {
    try {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      // El puntero ya no está activo: no hay nada que liberar.
    }
  }

  function endDrag(): void {
    cleanupDrag.current?.();
    cleanupDrag.current = null;
  }

  useEffect(
    () => () => {
      endDrag();
    },
    [],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (rolling || event.button !== 0 || cleanupDrag.current) return;
    const main = event.currentTarget;
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    dragged.current = false;
    try {
      main.setPointerCapture(event.pointerId);
    } catch {
      // Sin captura los listeners de window siguen el gesto igual.
    }

    const move = (native: PointerEvent): void => {
      const start = dragStart.current;
      if (!start || start.pointerId !== native.pointerId) return;
      const dx = native.clientX - start.x;
      const dy = native.clientY - start.y;
      if (!dragged.current && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        dragged.current = true;
      }
      if (dragged.current) setDrag({ dx, dy });
    };

    const up = (native: PointerEvent): void => {
      const start = dragStart.current;
      if (!start || start.pointerId !== native.pointerId) return;
      const dx = native.clientX - start.x;
      const dy = native.clientY - start.y;
      releasePointer(main, native.pointerId);
      endDrag();
      dragStart.current = null;
      setDrag(null);
      if (!dragged.current) return; // El click normal se encarga.
      dragged.current = false;
      // El click sintético posterior al arrastre no debe repetir la tirada.
      suppressClickUntil.current = Date.now() + 400;
      void handleRoll(throwFromDrag(dx, dy) ?? undefined);
    };

    const cancel = (native: PointerEvent): void => {
      const start = dragStart.current;
      if (!start || start.pointerId !== native.pointerId) return;
      releasePointer(main, native.pointerId);
      endDrag();
      dragStart.current = null;
      dragged.current = false;
      setDrag(null);
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    cleanupDrag.current = cleanup;
    // El gesto se sigue en window: así soltar fuera del dado también lanza.
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  function handleClick() {
    if (Date.now() < suppressClickUntil.current) {
      suppressClickUntil.current = 0;
      return;
    }
    void handleRoll();
  }

  const dragStyle: CSSProperties | undefined = drag
    ? {
        transform: `translate(${clamp(drag.dx, -44, 44)}px, ${clamp(
          drag.dy,
          -44,
          44,
        )}px) rotate(${drag.dx * 0.12}deg)`,
      }
    : undefined;

  const recent = rolls.slice(-5).reverse();
  const bounces = bouncesLabel(last);

  return (
    <section
      className={cx("panel", "dice-tray", "p-4", `is-skin-${skin}`)}
      aria-label="Dados de mesa"
    >
      <div className="dice-tray-head">
        <div>
          <div className="mono-label">{viewer === "dm" ? "Mesa" : "Jugador"}</div>
          <h2 className="dice-tray-title">Dados</h2>
        </div>
        <span className="dice-tray-hint">d&nbsp;20 · d&nbsp;100 · d&nbsp;12…</span>
      </div>

      <button
        type="button"
        className={cx(
          "dice-main",
          rolling && "is-rolling",
          drag && "is-dragging",
        )}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        disabled={rolling}
        aria-label={`Tirar ${count}d${sides}: clic para tirar o arrastra el dado para lanzar`}
      >
        <span className="dice-main-visual" style={dragStyle}>
          <DiceIcon sides={sides} size={72} className="dice-main-icon" />
        </span>
        <span className="dice-main-label">
          {rolling ? "Tirando…" : `${count}d${sides}`}
        </span>
        <span className="dice-main-result">
          {rolling
            ? "Calculando la caída…"
            : drag
              ? "Suelta para lanzar"
              : last
                ? last.count > 1
                  ? `Total ${last.result} · ${breakdown(last)}`
                  : `Último: ${last.result}${bounces ? ` · ${bounces}` : ""}`
                : "Clic o arrastra para tirar"}
        </span>
      </button>

      <div className="dice-count" role="group" aria-label="Cantidad de dados">
        <span className="dice-count-label">Dados</span>
        <div className="dice-count-actions">
          <button
            type="button"
            className="dice-count-button"
            onClick={() => changeCount(-1)}
            disabled={rolling || count <= 1}
            aria-label="Quitar un dado"
          >
            −
          </button>
          <b className="dice-count-value" aria-live="polite">
            {count}
          </b>
          <button
            type="button"
            className="dice-count-button"
            onClick={() => changeCount(1)}
            disabled={rolling || count >= MAX_DICE}
            aria-label="Añadir un dado"
          >
            +
          </button>
        </div>
      </div>

      {error ? (
        <p className="dice-tray-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="dice-picker" role="group" aria-label="Elegir dado">
        {DICE_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            className={cx("dice-choice", option === sides && "is-active")}
            onClick={() => selectDie(option)}
            disabled={rolling}
            aria-pressed={option === sides}
            aria-label={`Seleccionar d${option}`}
          >
            <DiceIcon sides={option} size={24} />
            <span>d{option}</span>
          </button>
        ))}
      </div>

      <div className="dice-skin">
        <label className="dice-skin-label" htmlFor="dice-skin-select">
          Aspecto
        </label>
        <select
          id="dice-skin-select"
          className="field dice-skin-select"
          value={skin}
          onChange={(event) => setSkin(event.target.value as DiceSkinId)}
          disabled={rolling}
        >
          {DICE_SKIN_ORDER.map((id) => (
            <option key={id} value={id}>
              {DICE_SKINS[id].label}
            </option>
          ))}
        </select>
      </div>

      <div className="dice-log">
        <div className="dice-log-head">
          <span>Últimas tiradas</span>
          <span className="tnum">{rolls.length === 0 ? "00" : rolls.length}</span>
        </div>
        {recent.length === 0 ? (
          <p className="dice-log-empty">
            Nadie ha tirado todavía. Elige un dado y pulsa el dado grande.
          </p>
        ) : (
          <ul className="dice-log-list">
            {recent.map((roll) => (
              <li key={roll.id} className="dice-log-row">
                <span className="dice-log-die">
                  <DiceIcon sides={roll.sides} size={14} />
                  {roll.count}d{roll.sides}
                </span>
                <span className="dice-log-name" title={breakdown(roll)}>
                  {roll.roller.name}
                  {roll.count > 1 ? (
                    <small className="dice-log-breakdown">
                      {breakdown(roll)}
                    </small>
                  ) : null}
                </span>
                <b className="dice-log-result">{roll.result}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="dice-tray-foot">
        {viewer === "dm"
          ? "Arrastra el dado grande para lanzarlo (o haz clic). Toda la mesa ve la misma caída."
          : "Arrastra el dado grande para lanzarlo (o haz clic). La tirada la simula el servidor y la ve toda la mesa."}
      </p>
    </section>
  );
}
