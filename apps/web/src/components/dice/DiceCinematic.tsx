import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { DiceRoll } from "@protocol-life/shared";
import {
  disableD20Cinematic,
  markFailed,
  markLanded,
  registerCinematic,
  supportsD20Cinematic,
} from "../../lib/diceCinematic";
import { isPhysicalD20Roll } from "../../lib/dice3d/roll";
import { useDiceSkinStore } from "../../store/useDiceSkinStore";
import type { DiceSkinId } from "../../lib/diceSkin";
import { DiceIcon } from "./DiceIcon";
import "./DiceCinematic.css";

/**
 * Overlay 3D de una tirada de d20 (uno o varios dados).
 *
 * - La escena 3D (three + fiber) se carga con `import()` en la primera tirada.
 * - La pantalla hace de mesa: los dados caen sobre la página, sin backdrop ni
 *   viñeta, y se quedan posados con sus resultados. Con varios, la cámara
 *   encuadra el grupo y cada dado lleva una etiqueta con su cara.
 * - El resultado lo decide el servidor; aquí solo se reproducen las
 *   trayectorias grabadas.
 * - Mientras la tirada está "retenida" por el overlay, el toast y la
 *   celebración la ignoran; al aterrizar se marcan y siguen su curso.
 * - Sin WebGL, con reduced-motion o si el chunk falla, todo cae al pop actual.
 */

type D20SceneComponent = ComponentType<{
  roll: DiceRoll;
  skipped: boolean;
  skin?: DiceSkinId;
  onLanded: () => void;
  onError: () => void;
}>;

const LOAD_TIMEOUT_MS = 3000;
/** El dado y el primer plano del resultado se quedan este tiempo. */
const LINGER_MS = 1_800;
const EXIT_FADE_MS = 280;

/** Ids ya vistos a nivel de módulo, como los pops: el header se remonta. */
const seenCinematicIds = new Set<string>();

let scenePromise: Promise<typeof import("./d20/D20Scene")> | null = null;

function loadScene(): Promise<typeof import("./d20/D20Scene")> {
  scenePromise ??= import("./d20/D20Scene");
  return scenePromise;
}

export function DiceCinematic({ rolls }: { rolls: DiceRoll[] }) {
  const skin = useDiceSkinStore((state) => state.skin);
  const [capable, setCapable] = useState(false);
  const [current, setCurrent] = useState<DiceRoll | null>(null);
  const [Scene, setScene] = useState<D20SceneComponent | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [landed, setLanded] = useState(false);
  const [exiting, setExiting] = useState(false);

  const currentRef = useRef<DiceRoll | null>(null);
  const landedRef = useRef(false);
  const settled = useRef(new Set<string>());
  const exitTimer = useRef<number | null>(null);

  const disableCinematic = useCallback(() => {
    disableD20Cinematic();
    setCapable(false);
  }, []);

  const clearTimers = useCallback(() => {
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
  }, []);

  const failCurrent = useCallback(
    (roll: DiceRoll) => {
      if (settled.current.has(roll.id)) return;
      settled.current.add(roll.id);
      markFailed(roll.id);
      clearTimers();
      setCurrent((value) => (value?.id === roll.id ? null : value));
    },
    [clearTimers],
  );

  const releaseLanded = useCallback(
    (roll: DiceRoll) => {
      if (settled.current.has(roll.id)) return;
      settled.current.add(roll.id);
      // Los pops (toast/celebración) arrancan ya: el dado se queda posado
      // encima de la mesa mientras el resultado también aparece abajo.
      markLanded(roll.id);
      setLanded(true);
      exitTimer.current = window.setTimeout(() => {
        exitTimer.current = null;
        setExiting(true);
        exitTimer.current = window.setTimeout(() => {
          exitTimer.current = null;
          setCurrent((value) => (value?.id === roll.id ? null : value));
        }, EXIT_FADE_MS);
      }, LINGER_MS);
    },
    [],
  );

  const handleLanded = useCallback(() => {
    const roll = currentRef.current;
    if (!roll || landedRef.current || settled.current.has(roll.id)) return;
    landedRef.current = true;
    releaseLanded(roll);
  }, [releaseLanded]);

  const handleSceneError = useCallback(() => {
    const roll = currentRef.current;
    // Un desmontaje normal del canvas puede emitir webglcontextlost tarde.
    // Si la tirada ya está liquidada, no desactivamos el 3D de la sesión.
    if (!roll || settled.current.has(roll.id)) return;
    disableCinematic();
    if (landedRef.current) releaseLanded(roll);
    else failCurrent(roll);
  }, [disableCinematic, failCurrent, releaseLanded]);

  const handleSkip = useCallback(() => {
    const roll = currentRef.current;
    if (!roll || landedRef.current) return;
    if (Scene) {
      setSkipped(true);
      return;
    }
    // Aún cargando el chunk: el pop es mejor que dejar la mesa esperando.
    failCurrent(roll);
  }, [Scene, failCurrent]);

  /* El overlay solo reserva tiradas mientras está montado. */
  useLayoutEffect(() => registerCinematic(), []);

  useEffect(() => {
    setCapable(supportsD20Cinematic());
  }, []);

  useEffect(() => {
    currentRef.current = current;
    landedRef.current = false;
  }, [current]);

  /* Cola: una tirada cada vez, sin pisarse. */
  useEffect(() => {
    if (!capable || current || !supportsD20Cinematic()) return;
    const next = rolls.find(
      (roll) => isPhysicalD20Roll(roll) && !seenCinematicIds.has(roll.id),
    );
    if (!next) return;
    seenCinematicIds.add(next.id);
    setLanded(false);
    setSkipped(false);
    setExiting(false);
    setCurrent(next);
  }, [rolls, current, capable]);

  /* Carga perezosa del chunk 3D solo cuando hay una tirada que animar. */
  useEffect(() => {
    if (!current || Scene) return;

    let cancelled = false;
    let timeout = 0;

    const load = async () => {
      try {
        const module = await loadScene();
        if (cancelled) return;
        window.clearTimeout(timeout);
        setScene(() => module.default);
      } catch {
        if (cancelled) return;
        window.clearTimeout(timeout);
        disableCinematic();
        failCurrent(current);
      }
    };

    timeout = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      failCurrent(current);
    }, LOAD_TIMEOUT_MS);

    void load();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [current, Scene, disableCinematic, failCurrent]);

  /* Si la sesión se vacía, suelta la tirada en curso. */
  useEffect(() => {
    if (rolls.length === 0 && current) failCurrent(current);
  }, [rolls.length, current, failCurrent]);

  /* Escape también salta. */
  useEffect(() => {
    if (!current || landed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      handleSkip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, landed, handleSkip]);

  /* Desmontaje real a mitad de vuelo: libera el pop, nunca lo deja colgado. */
  useEffect(() => {
    return () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      const roll = currentRef.current;
      if (!roll || settled.current.has(roll.id)) return;
      settled.current.add(roll.id);
      if (landedRef.current) markLanded(roll.id);
      else markFailed(roll.id);
    };
  }, []);

  if (!current || typeof document === "undefined") return null;

  return createPortal(
    <div className={`dice-cinematic${exiting ? " is-exiting" : ""}`}>
      <div className="dice-cinematic-stage" aria-hidden="true">
        {Scene ? (
          <SceneErrorBoundary onError={handleSceneError}>
            <Scene
              roll={current}
              skipped={skipped}
              skin={skin}
              onLanded={handleLanded}
              onError={handleSceneError}
            />
          </SceneErrorBoundary>
        ) : (
          <div className="dice-cinematic-pending">
            <DiceIcon sides={20} size={64} />
            <span>
              Preparando {current.count > 1 ? `${current.count} dados` : "dado"}{" "}
              3D…
            </span>
          </div>
        )}
      </div>

      {!landed ? (
        <button
          type="button"
          className="dice-cinematic-skip"
          onClick={handleSkip}
          aria-label="Saltar la animación del dado"
        >
          Saltar animación
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------------- */
/* Red de seguridad por si el renderer no llega a crearse                     */
/* ------------------------------------------------------------------------- */

interface ErrorBoundaryProps {
  onError: () => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

class SceneErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
