import { useEffect, useState } from "react";
import {
  DICE_SIDES,
  type DiceRoll,
  type DiceSides,
} from "@protocol-life/shared";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useLiveStore } from "../../store/useLiveStore";
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

export function DiceTray({ viewer }: { viewer: "player" | "dm" }) {
  const playerRoll = usePlayerStore((state) => state.rollDice);
  const playerRolls = usePlayerStore((state) => state.diceRolls);
  const dmRoll = useLiveStore((state) => state.rollDice);
  const dmRolls = useLiveStore((state) => state.diceRolls);

  const rollDice = viewer === "player" ? playerRoll : dmRoll;
  const rolls = viewer === "player" ? playerRolls : dmRolls;

  const [sides, setSides] = useState<DiceSides>(() => storedDie());
  const [count, setCount] = useState(1);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<DiceRoll | null>(null);

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

  async function handleRoll() {
    if (rolling) return;
    setRolling(true);
    setError(null);
    const result = await rollDice(sides, count);
    if (typeof result === "string") {
      setError(result);
      setRolling(false);
      return;
    }
    setLast(result);
    window.setTimeout(() => setRolling(false), 1000);
  }

  const recent = rolls.slice(-5).reverse();

  return (
    <section className="panel dice-tray p-4" aria-label="Dados de mesa">
      <div className="dice-tray-head">
        <div>
          <div className="mono-label">{viewer === "dm" ? "Mesa" : "Jugador"}</div>
          <h2 className="dice-tray-title">Dados</h2>
        </div>
        <span className="dice-tray-hint">d&nbsp;20 · d&nbsp;100 · d&nbsp;12…</span>
      </div>

      <button
        type="button"
        className={cx("dice-main", rolling && "is-rolling")}
        onClick={() => void handleRoll()}
        disabled={rolling}
        aria-label={`Tirar ${count}d${sides}`}
      >
        <DiceIcon sides={sides} size={72} className="dice-main-icon" />
        <span className="dice-main-label">
          {rolling ? "Tirando…" : `${count}d${sides}`}
        </span>
        <span className="dice-main-result">
          {last
            ? last.count > 1
              ? `Total ${last.result} · ${breakdown(last)}`
              : `Último: ${last.result}`
            : "Click para tirar"}
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
          ? "Puedes tirar tú también: toda la mesa ve el pop de 5 s. El log es de esta sesión."
          : "La tirada la resuelve el servidor y la ve toda la mesa. El log es de esta sesión."}
      </p>
    </section>
  );
}
