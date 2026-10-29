import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  planCombatVisual,
  type Campaign,
  type CombatEvent,
  type CombatUnit,
  type DeclaredAction,
  type Item,
  type PublicCombatState,
} from "@protocol-life/shared";
import { Icon } from "../Icons";
import { ClashCinematic } from "./ClashCinematic";
import {
  declaredActionsForUnit,
  declaredSkillId,
  effectLabel,
  equippedSkillIds,
  findItem,
  findSkill,
  hpPercent,
  isAliveUnit,
  isUnitLocked,
  latestSkillIdForUnit,
  specialForUnit,
  turnOrder,
  unitById,
  type CombatDeclaration,
} from "../../lib/combat";
import "./CombatScene.css";

/**
 * Escena de combate real (Fase 3F.5).
 *
 * Presentación e interacción: no calcula reglas. Lee `combat.units`,
 * `combat.actions` y `combat.scene`, dibuja la escena y manda intenciones con
 * `onDeclare`/`onLock`. La declaración avanzada (utilidad, dominio, hábitat,
 * redirección) sigue viviendo en `CombatDeclarationPanel` en las páginas.
 */

type SceneTheme = "paper" | "night";
type Viewer =
  | { role: "dm" }
  | { role: "player"; characterId: string };
type LineTone = "blue" | "yellow" | "red" | "green";
type DrawerMode = "sheet" | "skills";

interface SlotRef {
  unitId: string;
  slot: number;
}

interface SceneLine {
  key: string;
  unitId: string;
  slot: number;
  targetId: string;
  targetSlot?: number;
  tone: LineTone;
  glyph: string;
  label: string;
}

const TONE_COLOR: Record<LineTone, string> = {
  blue: "#67b7f0",
  yellow: "#ecc94b",
  red: "#e05b4d",
  green: "#78bb86",
};

const TONE_LABEL: Record<LineTone, string> = {
  blue: "Ataque sin respuesta",
  yellow: "Clash",
  red: "Ataque enemigo",
  green: "Apoyo / utilidad",
};

const SKILL_ACCENTS = ["rust", "amber", "steel", "moss"] as const;

const KIND_LABEL: Record<CombatUnit["kind"], string> = {
  player: "jugador",
  npc: "npc",
  enemy: "enemigo",
  boss: "jefe",
};

export interface CombatSceneProps {
  combat: PublicCombatState;
  campaign: Campaign;
  viewer: Viewer;
  events: CombatEvent[];
  /** Declara el array completo de acciones de `unitId`. */
  onDeclare: (unitId: string, actions: CombatDeclaration[]) => void;
  /** Bloquea la unidad (el servidor decide el alcance real del lock). */
  onLock: (unitId?: string, actions?: CombatDeclaration[]) => void;
  /** Solo DM: cambia el tema de la escena. */
  onSceneChange?: (patch: { theme?: SceneTheme }) => void;
  /** Deshabilita declaración/lock (p. ej. sin conexión). */
  disabled?: boolean;
  className?: string;
}

export function CombatScene({
  combat,
  campaign,
  viewer,
  events,
  onDeclare,
  onLock,
  onSceneChange,
  disabled = false,
  className,
}: CombatSceneProps) {
  const content = campaign.content;
  const theme: SceneTheme = combat.scene?.theme ?? "paper";
  const floor = combat.scene?.floor;
  const wall = combat.scene?.wall;
  const hasLayers = Boolean(floor || wall);

  const [mode, setMode] = useState<DrawerMode>("sheet");
  const [focusedUnitId, setFocusedUnitId] = useState<string | null>(() =>
    initialUnitId(combat, viewer),
  );
  const [selectedSlot, setSelectedSlot] = useState<SlotRef | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [hostilesOpen, setHostilesOpen] = useState(false);
  /** Utilidad elegida en el drawer: slot reservado y objetivo de apoyo. */
  const [support, setSupport] = useState<{ utilityId: string; slot: number } | null>(
    null,
  );
  const [geometry, setGeometry] = useState<Record<string, { x: number; y: number }>>(
    {},
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const hostilesRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef(new Map<string, HTMLButtonElement>());
  const unitRefs = useRef(new Map<string, HTMLDivElement>());

  const order = useMemo(() => turnOrder(combat.units), [combat.units]);
  const party = useMemo(
    () =>
      combat.units
        .filter((unit) => unit.team === "players")
        .sort(
          (a, b) =>
            b.stats.spd - a.stats.spd || a.name.localeCompare(b.name),
        ),
    [combat.units],
  );
  const enemies = useMemo(
    () =>
      combat.units
        .filter((unit) => unit.team === "enemies")
        .sort(
          (a, b) =>
            b.stats.spd - a.stats.spd || a.name.localeCompare(b.name),
        ),
    [combat.units],
  );
  const initiative = useMemo(
    () =>
      [...combat.units]
        .filter(isAliveUnit)
        .sort(
          (a, b) =>
            (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) ||
            a.name.localeCompare(b.name),
        ),
    [combat.units, order],
  );

  const eventsForLog = events.length > 0 ? events : combat.log;
  const activeUnitId =
    combat.phase === "resolving"
      ? latestActorId(eventsForLog)
      : undefined;

  const focusedUnit = unitById(combat, focusedUnitId ?? undefined);
  const selectedUnit = unitById(combat, selectedSlot?.unitId);
  const selectedSkill = findSkill(content, selectedSkillId ?? undefined);
  const targeting = Boolean(
    selectedSkill && selectedSlot && selectedUnit && isAliveUnit(selectedUnit),
  );

  const isControlled = useCallback(
    (unit: CombatUnit): boolean =>
      viewer.role === "dm"
        ? unit.team === "enemies"
        : unit.team === "players" &&
          unit.characterId === viewer.characterId,
    [viewer],
  );

  const canInspect = useCallback(
    (unit: CombatUnit | null): boolean =>
      Boolean(unit) &&
      (viewer.role === "dm" || unit?.team === "players"),
    [viewer],
  );

  const canDeclare = useCallback(
    (unit: CombatUnit | null): boolean =>
      Boolean(unit) &&
      !disabled &&
      combat.phase === "declaring" &&
      isAliveUnit(unit!) &&
      isControlled(unit!) &&
      !isUnitLocked(combat, unit!.id),
    [combat, disabled, isControlled],
  );

  const supportCaster = support ? focusedUnit : null;
  const supportUtility = supportCaster
    ? findItem(content, supportCaster.equipment.utility ?? undefined)
    : null;
  const supportTargeting = Boolean(
    support && supportCaster && canDeclare(supportCaster),
  );

  // Si la unidad deja de poder declarar (lock, fin de ronda o desconexión),
  // se cancela el objetivo de apoyo pendiente.
  useEffect(() => {
    if (support && !supportTargeting) setSupport(null);
  }, [support, supportTargeting]);

  const isTargetable = useCallback(
    (unit: CombatUnit): boolean => {
      if (supportTargeting) {
        // El apoyo solo alcanza a la propia unidad o a un aliado vivo.
        if (!focusedUnit || unit.team !== focusedUnit.team) return false;
        return isAliveUnit(unit);
      }
      return (
        targeting &&
        Boolean(selectedUnit) &&
        unit.team !== selectedUnit!.team &&
        isAliveUnit(unit)
      );
    },
    [focusedUnit, supportTargeting, targeting, selectedUnit],
  );

  const pushNotice = useCallback((text: string) => setNotice(text), []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Cambio de ronda/estado: cancela la selección pendiente.
  useEffect(() => {
    setSelectedSkillId(null);
    setPage(0);
    setNotice(null);
    setLegendOpen(false);
    setHostilesOpen(false);
    setSupport(null);
  }, [combat.id, combat.round, combat.phase]);

  // Leyenda/Hostiles: click fuera o Escape los cierra.
  useEffect(() => {
    if (!legendOpen && !hostilesOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const insideLegend = legendRef.current?.contains(target) ?? false;
      const insideHostiles = hostilesRef.current?.contains(target) ?? false;
      if (insideLegend || insideHostiles) return;
      setLegendOpen(false);
      setHostilesOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [legendOpen, hostilesOpen]);

  useEffect(() => {
    if (targeting || support) setLegendOpen(false);
  }, [targeting, support]);

  useEffect(() => {
    if (!focusedUnitId) return;
    if (combat.units.some((unit) => unit.id === focusedUnitId)) return;
    setFocusedUnitId(initialUnitId(combat, viewer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat.units, focusedUnitId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSelectedSkillId(null);
      setSelectedSlot(null);
      setNotice(null);
      setLegendOpen(false);
      setHostilesOpen(false);
      setSupport(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const lines = useMemo<SceneLine[]>(() => {
    const next: SceneLine[] = [];
    for (const source of combat.units) {
      const actions = declaredActionsForUnit(combat.actions, source.id);
      for (const action of actions) {
        const target = unitById(combat, action.targetId);
        if (!target) continue;
        const tone = toneForAction(source, action, combat);
        const name = actionName(action, content);
        const targetSlot =
          action.targetSlot !== undefined &&
          action.targetSlot >= 1 &&
          action.targetSlot <= target.stats.skillSlots
            ? action.targetSlot
            : undefined;
        next.push({
          key: `${source.id}:${action.slot}:${target.id}:${targetSlot ?? "unit"}`,
          unitId: source.id,
          slot: action.slot,
          targetId: target.id,
          targetSlot,
          tone,
          glyph: initialFor(name, 0),
          label: `${name} → ${target.name}${targetSlot ? ` · slot ${targetSlot}` : ""}`,
        });
      }
    }
    return next;
  }, [combat, content]);

  const sourceTone = useMemo(() => {
    const map = new Map<string, LineTone>();
    for (const line of lines) {
      map.set(slotKey(line.unitId, line.slot), line.tone);
    }
    return map;
  }, [lines]);

  const sourceGlyph = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of lines) {
      map.set(slotKey(line.unitId, line.slot), line.glyph);
    }
    return map;
  }, [lines]);

  const sourceLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of lines) {
      map.set(slotKey(line.unitId, line.slot), line.label);
    }
    return map;
  }, [lines]);

  const targetTone = useMemo(() => {
    const map = new Map<string, LineTone>();
    for (const line of lines) {
      if (line.targetSlot !== undefined) {
        map.set(slotKey(line.targetId, line.targetSlot), line.tone);
      }
    }
    return map;
  }, [lines]);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const next: Record<string, { x: number; y: number }> = {};
    for (const [key, element] of slotRefs.current.entries()) {
      const rect = element.getBoundingClientRect();
      next[key] = {
        x: rect.left - stageRect.left + rect.width / 2,
        y: rect.top - stageRect.top + rect.height / 2,
      };
    }
    for (const [unitId, element] of unitRefs.current.entries()) {
      const rect = element.getBoundingClientRect();
      next[unitKey(unitId)] = {
        x: rect.left - stageRect.left + rect.width / 2,
        y: rect.top - stageRect.top + rect.height * 0.46,
      };
    }
    setGeometry((current) => (sameGeometry(current, next) ? current : next));
  }, []);

  useLayoutEffect(() => {
    measure();
    const stage = stageRef.current;
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;
    if (stage && observer) observer.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [
    measure,
    lines,
    selectedSlot,
    selectedSkillId,
    page,
    party.length,
    enemies.length,
    mode,
    theme,
  ]);

  function weaponImageFor(unit: CombatUnit): string | undefined {
    const skillId =
      combat.phase === "resolving"
        ? latestSkillIdForUnit(eventsForLog, unit.id)
        : declaredSkillId(combat.actions[unit.id]);
    if (!skillId) return undefined;
    return content.skills.find((skill) => skill.id === skillId)?.weaponImage;
  }

  function focusUnit(unit: CombatUnit, nextMode: DrawerMode = "sheet") {
    setFocusedUnitId(unit.id);
    setMode(nextMode);
    setPage(0);
    if (nextMode === "sheet") setSelectedSkillId(null);
  }

  function declareAt(target: CombatUnit, targetSlot?: number) {
    if (!selectedSlot || !selectedUnit || !selectedSkill) {
      pushNotice("Elige primero un SkillSlot y una skill.");
      return;
    }
    if (!canDeclare(selectedUnit)) {
      pushNotice("No puedes declarar por esa unidad.");
      return;
    }
    if (!isTargetable(target)) {
      pushNotice("Ese objetivo no es válido para esta skill.");
      return;
    }

    const current = declaredActionsForUnit(
      combat.actions,
      selectedUnit.id,
    ).map(toDeclaration);
    const nextActions = current
      .filter((action) => action.slot !== selectedSlot.slot)
      .concat({
        slot: selectedSlot.slot,
        skillId: selectedSkill.id,
        targetId: target.id,
        ...(targetSlot !== undefined ? { targetSlot } : {}),
      })
      .sort((a, b) => a.slot - b.slot);

    onDeclare(selectedUnit.id, nextActions);
    pushNotice(
      `Declarado: ${selectedSkill.name} → ${target.name}${targetSlot ? ` (slot ${targetSlot})` : ""}.`,
    );

    const nextFocus = canInspect(target) ? target : selectedUnit;
    setFocusedUnitId(nextFocus.id);
    setMode("sheet");
    setPage(0);
    setSelectedSkillId(null);
    setSelectedSlot(null);
  }

  function declareSupport(target: CombatUnit) {
    if (!support || !focusedUnit) {
      pushNotice("Elige la utilidad de apoyo en el drawer.");
      return;
    }
    if (!canDeclare(focusedUnit)) {
      pushNotice("No puedes declarar por esa unidad.");
      return;
    }
    if (!isTargetable(target)) {
      pushNotice(
        "La utilidad solo puede aplicarse a un aliado vivo o a ti mismo.",
      );
      return;
    }

    const current = declaredActionsForUnit(
      combat.actions,
      focusedUnit.id,
    ).map(toDeclaration);
    const nextActions = current
      .filter((action) => action.slot !== support.slot)
      .concat({
        slot: support.slot,
        utilityId: support.utilityId,
        targetId: target.id,
      })
      .sort((a, b) => a.slot - b.slot);

    onDeclare(focusedUnit.id, nextActions);
    pushNotice(
      `Apoyo declarado: ${supportUtility?.name ?? "utilidad"} → ${target.name}.`,
    );

    const nextFocus = canInspect(target) ? target : focusedUnit;
    setFocusedUnitId(nextFocus.id);
    setSupport(null);
    setSelectedSkillId(null);
    setSelectedSlot(null);
    setMode("sheet");
    setPage(0);
  }

  function handleSlotClick(unit: CombatUnit, slot: number) {
    if (supportTargeting) {
      // En la propia unidad, un slot libre pasa a ser el slot reservado para
      // la utilidad; el sprite (no el slot) sirve para apuntarse a uno mismo.
      if (
        focusedUnit &&
        unit.id === focusedUnit.id &&
        !slotOccupied(unit.id, slot)
      ) {
        setSupport((current) =>
          current ? { ...current, slot } : current,
        );
        setSelectedSlot({ unitId: unit.id, slot });
        pushNotice(`SkillSlot ${slot} reservado para el apoyo.`);
        return;
      }
      if (!isTargetable(unit)) {
        pushNotice("La utilidad solo puede aplicarse a tu unidad o a un aliado.");
        return;
      }
      declareSupport(unit);
      return;
    }
    if (targeting) {
      if (!isTargetable(unit)) {
        pushNotice("Ese SkillSlot no es un objetivo válido para esta skill.");
        return;
      }
      declareAt(unit, slot);
      return;
    }

    if (canDeclare(unit)) {
      setFocusedUnitId(unit.id);
      setSelectedSlot({ unitId: unit.id, slot });
      setSelectedSkillId(null);
      setMode("skills");
      setPage(0);
      return;
    }

    setFocusedUnitId(unit.id);
    setMode("sheet");
    setPage(0);
    setSelectedSkillId(null);
    if (!canInspect(unit)) {
      pushNotice("No puedes inspeccionar hostiles; su HP es estimado.");
    } else if (!isControlled(unit)) {
      pushNotice(
        viewer.role === "dm"
          ? "El DM no declara por la party: ficha en solo lectura."
          : "Solo puedes declarar por tu propia unidad.",
      );
    } else if (isUnitLocked(combat, unit.id)) {
      pushNotice("La unidad ya está lista. Esperando al resto de la mesa.");
    }
  }

  function handleSpriteClick(unit: CombatUnit) {
    if (supportTargeting) {
      if (!isTargetable(unit)) {
        pushNotice("La utilidad solo puede aplicarse a tu unidad o a un aliado.");
        return;
      }
      declareSupport(unit);
      return;
    }
    if (targeting) {
      if (!isTargetable(unit)) {
        pushNotice("Ese objetivo no es válido para esta skill.");
        return;
      }
      declareAt(unit);
      return;
    }
    if (!canInspect(unit)) {
      pushNotice("No puedes inspeccionar hostiles; su HP es estimado.");
      return;
    }
    focusUnit(unit, "sheet");
  }

  function pickSkill(skillId: string) {
    if (!focusedUnit || !canDeclare(focusedUnit)) return;
    setSupport(null);
    if (!selectedSlot || selectedSlot.unitId !== focusedUnit.id) {
      setSelectedSlot({ unitId: focusedUnit.id, slot: 1 });
    }
    setSelectedSkillId(skillId);
    setMode("skills");
    setPage(0);
  }

  function handleSheetSlot(unit: CombatUnit, slot: number) {
    if (!canDeclare(unit)) {
      pushNotice(
        isUnitLocked(combat, unit.id)
          ? "La unidad ya está lista."
          : "No controlas esta unidad.",
      );
      return;
    }
    setSupport(null);
    setFocusedUnitId(unit.id);
    setSelectedSlot({ unitId: unit.id, slot });
    setSelectedSkillId(null);
    setMode("skills");
    setPage(0);
  }

  function handleLock() {
    if (!focusedUnit || !canDeclare(focusedUnit)) return;
    const actions = declaredActionsForUnit(
      combat.actions,
      focusedUnit.id,
    ).map(toDeclaration);
    onLock(focusedUnit.id, actions);
    pushNotice(
      viewer.role === "dm"
        ? "Enemigos marcados como listos. Utilidad, dominio y redirección quedan en la declaración avanzada."
        : `${focusedUnit.name} marcada como lista. Utilidad, dominio y redirección quedan en la declaración avanzada.`,
    );
  }

  function handleThemeToggle() {
    if (viewer.role !== "dm" || !onSceneChange) return;
    onSceneChange({ theme: theme === "paper" ? "night" : "paper" });
  }

  const slotsFor = (unit: CombatUnit) =>
    Math.max(0, Math.min(12, unit.stats.skillSlots));

  function renderUnit(unit: CombatUnit) {
    const locked = isUnitLocked(combat, unit.id);
    const inspectable = canInspect(unit);
    const targetable = isTargetable(unit);
    const selected = selectedSlot?.unitId === unit.id;
    const activeSlot =
      selectedSlot?.unitId === unit.id ? selectedSlot.slot : undefined;
    const plan = planCombatVisual(unit, content, {
      weaponImage: weaponImageFor(unit),
    });
    const count = slotsFor(unit);
    const hp = hpPercent(unit);
    const exact = exactHpFor(unit, viewer);
    // El arte base mira a la izquierda. Los enemigos están a la izquierda de
    // la escena, así que se refleja su pila completa para mirar al centro.
    // La party (derecha) ya mira al centro sin reflejo.
    const mirrored = unit.team === "enemies";

    return (
      <div
        key={unit.id}
        className={`sv-unit sv-unit--${
          unit.team === "players" ? "party" : "enemy"
        }`}
        data-selected={selected ? "true" : undefined}
        data-inspected={focusedUnitId === unit.id ? "true" : undefined}
        data-inspectable={inspectable ? "true" : "false"}
        data-targetable={targetable ? "true" : undefined}
        data-support-targetable={
          targetable && supportTargeting ? "true" : undefined
        }
        data-locked={locked ? "true" : undefined}
      >
        <div className="sv-slots" data-count={count}>
          {Array.from({ length: count }, (_, index) => {
            const slot = index + 1;
            const key = slotKey(unit.id, slot);
            const tone = sourceTone.get(key);
            const incoming = targetTone.get(key);
            const glyph = sourceGlyph.get(key) ?? String(slot);
            const label = sourceLabel.get(key);
            return (
              <SlotButton
                key={key}
                unit={unit}
                slot={slot}
                tone={tone}
                incoming={incoming}
                glyph={glyph}
                label={label}
                active={activeSlot === slot}
                locked={locked}
                targetable={targetable}
                onClick={() => handleSlotClick(unit, slot)}
                registerRef={(element) => {
                  if (element) slotRefs.current.set(key, element);
                  else slotRefs.current.delete(key);
                }}
              />
            );
          })}
        </div>

        <div
          ref={(element) => {
            if (element) unitRefs.current.set(unit.id, element);
            else unitRefs.current.delete(unit.id);
          }}
          className="sv-unit-sprite-wrap"
          role="button"
          tabIndex={0}
          data-inspectable={inspectable ? "true" : "false"}
          aria-label={
            targetable && selectedSkill
              ? `Atacar a ${unit.name} con ${selectedSkill.name}`
              : inspectable
                ? `Inspeccionar ${unit.name}`
                : `${unit.name}, hostil no inspeccionable`
          }
          title={
            targetable && selectedSkill
              ? `Objetivo de ${selectedSkill.name}`
              : inspectable
                ? `Ver ficha de ${unit.name}`
                : "Los hostiles no se pueden inspeccionar"
          }
          onClick={() => handleSpriteClick(unit)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleSpriteClick(unit);
            }
          }}
        >
          <span className="sv-unit-role">{roleLabel(unit)}</span>
          <span className="sv-inspect-chip" aria-hidden>
            {inspectable ? "FICHA" : "SIN FICHA"}
          </span>
          {locked ? <span className="sv-unit-active">LISTO</span> : null}
          {activeUnitId === unit.id && !locked ? (
            <span className="sv-unit-active">ACTUANDO</span>
          ) : null}

          <span
            className="sv-unit-sprite-frame"
            data-mirror={mirrored ? "true" : undefined}
          >
            <span className="sv-unit-sprite-stack">
              {plan.kind === "layered" ? (
                <>
                  <img
                    className="sv-unit-sprite"
                    src={plan.baseImage}
                    alt={unit.name}
                    draggable={false}
                  />
                  {plan.layers.map((layer) => (
                    <img
                      key={layer.slot}
                      className="sv-unit-sprite"
                      src={layer.image}
                      alt=""
                      draggable={false}
                      data-layer-slot={layer.slot}
                    />
                  ))}
                </>
              ) : plan.kind === "single" ? (
                <img
                  className="sv-unit-sprite"
                  src={plan.image}
                  alt={unit.name}
                  draggable={false}
                />
              ) : (
                <span className="sv-unit-placeholder" aria-hidden>
                  <img
                    className="sv-unit-placeholder-art"
                    src="/assets/combat/placeholder-unit.png"
                    alt=""
                    draggable={false}
                  />
                  <span className="sv-unit-placeholder-label">SIN SPRITE</span>
                </span>
              )}
            </span>
          </span>

          <span className="sv-speed-badge">
            SPD <b>{unit.stats.spd}</b>
            {unit.spdRoll ? <em>+{unit.spdRoll}</em> : null}
          </span>

          {unit.defeated ? (
            <span className="sv-unit-dead">
              <span>CAÍDO</span>
            </span>
          ) : null}
        </div>

        <div className="sv-unit-foot">
          <span className="sv-unit-name" title={unit.name}>
            {unit.name}
          </span>
          <span
            className="sv-unit-state"
            data-masked={exact ? undefined : "true"}
          >
            {unit.defeated
              ? "CAÍDO"
              : exact
                ? `${unit.hpCurrent} HP`
                : `≈${hp}% HP`}
            {locked ? " · LISTO" : ""}
          </span>
        </div>
        <div className="sv-hpbar sv-hpbar--unit">
          <span style={{ width: `${hp}%` }} />
        </div>
      </div>
    );
  }

  /**
   * Formación por bando: 1–3 unidades en una fila centrada; 4–6 en dos filas
   * (3 atrás, el resto delante). Las filas se centran por separado.
   */
  function renderSide(side: "enemy" | "party", units: CombatUnit[]) {
    const twoRows = units.length > 3;
    const back = twoRows ? units.slice(0, 3) : [];
    const front = twoRows ? units.slice(3) : units;
    return (
      <div
        className={`sv-side sv-side--${side}`}
        data-count={units.length}
        data-formation={twoRows ? "two-rows" : "one-row"}
      >
        {twoRows ? (
          <div className="sv-rank sv-rank--back">{back.map(renderUnit)}</div>
        ) : null}
        <div className="sv-rank sv-rank--front">{front.map(renderUnit)}</div>
      </div>
    );
  }

  const focusedSkills = focusedUnit
    ? equippedSkillsFor(content, focusedUnit)
    : [];
  const totalPages = Math.max(1, Math.ceil(focusedSkills.length / 3));
  const safePage = Math.min(page, totalPages - 1);
  const visibleSkills = focusedSkills.slice(safePage * 3, safePage * 3 + 3);

  const focusedUtility = focusedUnit
    ? findItem(content, focusedUnit.equipment.utility ?? undefined)
    : null;
  const focusedDeclaredUtilities = focusedUnit
    ? declaredActionsForUnit(combat.actions, focusedUnit.id).filter(
        (action) => Boolean(action.utilityId),
      ).length
    : 0;
  const focusedUtilityUses =
    focusedUtility && focusedUnit
      ? Math.max(0, focusedUnit.utilityUses - focusedDeclaredUtilities)
      : 0;
  const focusedSupportSlot =
    focusedUnit && focusedUtility ? freeSupportSlot(focusedUnit) : null;
  // Si el jugador abrió un slot ocupado, la carta lo muestra tal cual para que
  // el motivo («Slot N ocupado») cuadre con lo que ve.
  const focusedSupportSlotLabel =
    focusedUnit && selectedSlot?.unitId === focusedUnit.id
      ? selectedSlot.slot
      : focusedSupportSlot;
  const supportSlotTaken = Boolean(
    focusedUnit &&
      selectedSlot?.unitId === focusedUnit.id &&
      slotOccupied(focusedUnit.id, selectedSlot.slot),
  );
  const supportBlockedReason = supportReason();

  function slotOccupied(unitId: string, slot: number): boolean {
    return declaredActionsForUnit(combat.actions, unitId).some(
      (action) => action.slot === slot,
    );
  }

  function freeSupportSlot(unit: CombatUnit): number | null {
    if (
      selectedSlot?.unitId === unit.id &&
      !slotOccupied(unit.id, selectedSlot.slot)
    ) {
      return selectedSlot.slot;
    }
    for (let slot = 1; slot <= unit.stats.skillSlots; slot += 1) {
      if (!slotOccupied(unit.id, slot)) return slot;
    }
    return null;
  }

  function supportReason(): string | null {
    if (!focusedUnit) return "Elige una unidad en la escena.";
    if (!focusedUtility) return "Sin utilidad equipada.";
    if (!canDeclare(focusedUnit)) {
      if (!isAliveUnit(focusedUnit)) return "La unidad está caída.";
      if (isUnitLocked(combat, focusedUnit.id)) return "La unidad ya está lista.";
      if (!isControlled(focusedUnit)) return "No controlas esta unidad.";
      if (disabled) return "Sin conexión con la mesa.";
      return "La ronda no admite declaración.";
    }
    if (focusedUtilityUses <= 0) {
      return `Sin usos de ${focusedUtility.name}.`;
    }
    if (supportSlotTaken) {
      return `El SkillSlot ${selectedSlot?.slot} está ocupado; elige otro.`;
    }
    if (focusedSupportSlot === null) return "No quedan SkillSlots libres.";
    return null;
  }

  function handleSupportPick() {
    if (!focusedUnit || !focusedUtility) return;
    if (supportReason() !== null || focusedSupportSlot === null) return;
    setSupport({ utilityId: focusedUtility.id, slot: focusedSupportSlot });
    setSelectedSkillId(null);
    setSelectedSlot({ unitId: focusedUnit.id, slot: focusedSupportSlot });
    setMode("skills");
    setPage(0);
  }

  return (
    <div
      className={["sv-scene", className].filter(Boolean).join(" ")}
      data-scene={theme}
      data-viewer={viewer.role}
      data-has-layers={hasLayers ? "true" : "false"}
      data-formation={
        Math.max(party.length, enemies.length) > 3 ? "two-rows" : "one-row"
      }
      data-support-targeting={supportTargeting ? "true" : undefined}
    >
      <div className="sv-scene-bar">
        <div className="sv-scene-bar-tags">
          <span className="sv-stage-tag">
            <span className="sv-stage-dot" /> ESCENA DE COMBATE
          </span>
          <span className="sv-stage-tag">RONDA {combat.round}</span>
          <span className="sv-stage-tag">
            {combat.phase === "declaring"
              ? "DECLARACIÓN"
              : combat.phase === "resolving"
                ? "RESOLVIENDO"
                : "TERMINADO"}
          </span>
        </div>
        <div className="sv-scene-bar-actions">
          <span className="sv-scene-mode">
            {viewer.role === "dm"
              ? "VISTA DM · HP EXACTO"
              : "VISTA JUGADOR · HP ESTIMADO"}
          </span>
          {viewer.role === "dm" ? (
            <button
              type="button"
              className="sv-ghost-btn"
              onClick={handleThemeToggle}
              disabled={!onSceneChange}
              title="Cambia el tema de la escena para toda la mesa"
            >
              <Icon name="flame" size={12} />{" "}
              {theme === "paper" ? "Escena noche" : "Escena papel"}
            </button>
          ) : (
            <button
              type="button"
              className="sv-ghost-btn sv-ghost-btn--locked"
              disabled
              title="Solo el DM puede cambiar la escena"
            >
              <Icon name="lock" size={12} /> Escena · Solo DM
            </button>
          )}
        </div>
      </div>

      <div className="sv-stage-shell">
        <div
          ref={stageRef}
          className="sv-stage"
          data-targeting={targeting ? "true" : undefined}
        >
          {floor ? (
            <div className="sv-bg-floor" aria-hidden>
              <img src={floor} alt="" draggable={false} />
            </div>
          ) : null}
          {wall ? (
            <div className="sv-bg-wall" aria-hidden>
              <img src={wall} alt="" draggable={false} />
            </div>
          ) : null}
          <div className="sv-vignette" aria-hidden />
          <div className="sv-stage-dim" aria-hidden />

          <div className="sv-stage-top">
            <span className="sv-stage-tag">
              <span className="sv-stage-dot" />{" "}
              {combat.scene?.theme === "night" ? "NOCHE" : "PAPEL"} ·{" "}
              {combat.units.length} UNIDADES
            </span>
            <span className="sv-stage-tag sv-stage-tag--right">
              SPD + D6 · SIN RESPUESTA / CLASH / APOYO
            </span>
          </div>

          {renderSide("enemy", enemies)}
          {renderSide("party", party)}

          <svg className="sv-lines" aria-hidden>
            <defs>
              <filter
                id="sv-line-glow"
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feGaussianBlur stdDeviation="2.8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {lines.map((line) => {
              const start =
                geometry[slotKey(line.unitId, line.slot)] ??
                geometry[unitKey(line.unitId)];
              const end = line.targetSlot
                ? (geometry[slotKey(line.targetId, line.targetSlot)] ??
                  geometry[unitKey(line.targetId)])
                : geometry[unitKey(line.targetId)];
              if (!start || !end) return null;
              const dx = end.x - start.x;
              const lift = Math.min(90, Math.max(34, Math.abs(dx) * 0.16));
              const c1x = start.x + dx * 0.32;
              const c1y = start.y - lift;
              const c2x = start.x + dx * 0.68;
              const c2y = end.y - lift;
              const color = TONE_COLOR[line.tone];
              return (
                <g
                  key={line.key}
                  className="sv-line-group"
                  style={{ "--line-color": color } as CSSProperties}
                >
                  <path
                    className="sv-line-halo"
                    d={`M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`}
                  />
                  <path
                    className={`sv-line sv-line--${line.tone}`}
                    d={`M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`}
                  />
                  <circle
                    className="sv-line-node"
                    cx={end.x}
                    cy={end.y}
                    r={4.5}
                  />
                </g>
              );
            })}
          </svg>

          <div className="sv-stage-tools">
            <div className="sv-hostiles-wrap" ref={hostilesRef}>
              <button
                type="button"
                className="sv-tool-btn sv-tool-btn--hostiles"
                aria-label="Ver hostiles y su HP"
                aria-expanded={hostilesOpen}
                aria-controls="sv-hostiles-panel"
                title="Hostiles y HP"
                onClick={() =>
                  setHostilesOpen((current) => {
                    const next = !current;
                    if (next) setLegendOpen(false);
                    return next;
                  })
                }
              >
                !
              </button>
              {hostilesOpen ? (
                <aside
                  id="sv-hostiles-panel"
                  className="sv-hostiles-panel"
                  role="dialog"
                  aria-label="HP de enemigos"
                >
                  <div className="sv-hostiles-head">
                    <span>
                      HOSTILES <b>{enemies.length}</b>
                    </span>
                    <button
                      type="button"
                      className="sv-hostiles-close"
                      onClick={() => setHostilesOpen(false)}
                      aria-label="Cerrar hostiles"
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                  <div className="sv-intel-mode">
                    {viewer.role === "dm"
                      ? "HP EXACTO"
                      : "HP ESTIMADO · VISTA JUGADOR"}
                  </div>
                  {enemies.length === 0 ? (
                    <p className="sv-intel-mode">Sin hostiles</p>
                  ) : (
                    enemies.map((unit) => {
                      const exact = exactHpFor(unit, viewer);
                      return (
                        <div key={unit.id} className="sv-intel-row">
                          <div className="sv-intel-row-top">
                            <span className="sv-intel-name">{unit.name}</span>
                            <span
                              className="sv-intel-hp"
                              data-masked={exact ? undefined : "true"}
                            >
                              {hpReadout(unit, viewer)}
                            </span>
                          </div>
                          <div className="sv-hpbar sv-hpbar--enemy">
                            <span style={{ width: `${hpPercent(unit)}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </aside>
              ) : null}
            </div>

            <div className="sv-legend-wrap" ref={legendRef}>
              <button
                type="button"
                className="sv-tool-btn sv-tool-btn--legend"
                aria-label="Ver leyenda de líneas"
                aria-expanded={legendOpen}
                aria-controls="sv-line-legend"
                title="Leyenda de líneas"
                onClick={() =>
                  setLegendOpen((current) => {
                    const next = !current;
                    if (next) setHostilesOpen(false);
                    return next;
                  })
                }
              >
                ?
              </button>
              {legendOpen ? (
                <div
                  id="sv-line-legend"
                  className="sv-legend"
                  role="dialog"
                  aria-label="Leyenda de líneas"
                >
                  {(["blue", "yellow", "red", "green"] as LineTone[]).map(
                    (tone) => (
                      <span key={tone} className="sv-legend-item">
                        <i style={{ background: TONE_COLOR[tone] }} />
                        {TONE_LABEL[tone]}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {notice ? (
            <div className="sv-notice" role="status" data-sticky="true">
              <Icon name="alert" size={12} />
              <span>{notice}</span>
              <button
                type="button"
                className="sv-notice-close"
                onClick={() => setNotice(null)}
                aria-label="Cerrar aviso"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ) : null}
        </div>

        <ClashCinematic
          combat={combat}
          campaign={campaign}
          viewer={viewer}
          events={eventsForLog}
        />

        <div className="sv-understage">
          <section className="sv-initiative" aria-label="Orden de iniciativa">
            <div className="sv-under-title">
              <span>INICIATIVA</span>
              <b>SPD + 1..4</b>
            </div>
            <div className="sv-initiative-row">
              {initiative.map((unit) => (
                <span
                  key={unit.id}
                  className={`sv-initiative-chip sv-initiative-chip--${
                    unit.team === "players" ? "party" : "enemy"
                  }`}
                  title={`${unit.name} · SPD ${unit.stats.spd}`}
                >
                  <b>{order.get(unit.id)}</b>
                  <span className="sv-initiative-name">{unit.name}</span>
                  <em>{unit.stats.spd}</em>
                </span>
              ))}
            </div>
          </section>

          <section className="sv-vitals" aria-label="HP de la party">
            <div className="sv-under-title">
              <span>PARTY</span>
              <b>HP PERSISTENTE</b>
            </div>
            <div className="sv-vitals-row">
              {party.map((unit) => (
                <div key={unit.id} className="sv-vital">
                  <div className="sv-vital-top">
                    <span>{unit.name}</span>
                    <b>
                      {unit.hpCurrent}/{unit.stats.hpMax}
                    </b>
                  </div>
                  <div className="sv-hpbar">
                    <span style={{ width: `${hpPercent(unit)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section
        className="sv-drawer"
        data-targeting={targeting ? "true" : undefined}
        data-mode={mode}
        data-viewer={viewer.role}
        aria-label="Ficha y declaración de la escena"
      >
        <div className="sv-drawer-identity">
          <div className="sv-drawer-kicker">
            {mode === "sheet" ? "FICHA DE UNIDAD" : "DECLARACIÓN"}
          </div>
          <h2 title={focusedUnit?.name ?? "Sin unidad"}>
            {focusedUnit?.name ?? "Sin unidad"}
          </h2>
          <p className="sv-drawer-sub">
            {focusedUnit
              ? mode === "sheet"
                ? roleLabel(focusedUnit)
                : selectedSlot && selectedSlot.unitId === focusedUnit.id
                  ? `SKILLSLOT ${selectedSlot.slot} / ${focusedUnit.stats.skillSlots}`
                  : "Selecciona un SkillSlot sobre el sprite"
              : "Selecciona una unidad en la escena"}
          </p>

          <div
            className="sv-drawer-tabs"
            role="tablist"
            aria-label="Contenido del panel"
          >
            <button
              type="button"
              role="tab"
              className="sv-drawer-tab"
              aria-selected={mode === "sheet"}
              data-active={mode === "sheet" ? "true" : undefined}
              disabled={!focusedUnit}
              onClick={() => {
                setMode("sheet");
                setSelectedSkillId(null);
              }}
            >
              Ficha
            </button>
            <button
              type="button"
              role="tab"
              className="sv-drawer-tab"
              aria-selected={mode === "skills"}
              data-active={mode === "skills" ? "true" : undefined}
              disabled={!focusedUnit}
              onClick={() => {
                setMode("skills");
                setSelectedSkillId(null);
                setPage(0);
                if (focusedUnit && selectedSlot?.unitId !== focusedUnit.id) {
                  setSelectedSlot({ unitId: focusedUnit.id, slot: 1 });
                }
              }}
            >
              Skills <em>{focusedSkills.length}</em>
            </button>
          </div>

          {support ? (
            <div className="sv-targeting-box sv-targeting-box--support">
              <div className="sv-targeting-title">
                <Icon name="users" size={13} /> Elige un aliado
              </div>
              <p>
                {supportUtility?.name ?? "Utilidad"} · SkillSlot {support.slot}
              </p>
              <span className="sv-targeting-hint">
                Solo tu unidad o un aliado vivo. La línea de apoyo es verde.
              </span>
              <button
                type="button"
                className="sv-text-btn"
                onClick={() => setSupport(null)}
              >
                Cancelar apoyo
              </button>
            </div>
          ) : selectedSkill ? (
            <div className="sv-targeting-box">
              <div className="sv-targeting-title">
                <Icon name="crosshair" size={13} /> Elige un objetivo
              </div>
              <p>{selectedSkill.name}</p>
              <button
                type="button"
                className="sv-text-btn"
                onClick={() => setSelectedSkillId(null)}
              >
                Cancelar selección
              </button>
            </div>
          ) : (
            <p className="sv-drawer-hint">
              {focusedUnit
                ? mode === "sheet"
                  ? `Click en un sprite para inspeccionar. ${
                      canDeclare(focusedUnit)
                        ? "Click en un SkillSlot para declarar."
                        : "Ficha en solo lectura."
                    }`
                  : canDeclare(focusedUnit)
                    ? "Elige una skill y luego un objetivo iluminado. También puedes tocar directamente un SkillSlot del rival."
                    : "Vista de solo lectura: no controlas esta unidad."
                : "Elige una unidad en el escenario para ver su ficha."}
            </p>
          )}

          <div className="sv-drawer-lockbar">
            {focusedUnit &&
            isControlled(focusedUnit) &&
            combat.phase === "declaring" ? (
              <button
                type="button"
                className="sv-action-btn"
                onClick={handleLock}
                disabled={!canDeclare(focusedUnit)}
                title={
                  viewer.role === "dm"
                    ? "Bloquea a todos los enemigos vivos"
                    : "Bloquea tu declaración actual"
                }
              >
                <Icon name="lock" size={12} />
                {isUnitLocked(combat, focusedUnit.id) ? "Lista" : "Listo"}
              </button>
            ) : null}
            {focusedUnit && canDeclare(focusedUnit) ? (
              <span className="sv-scene-mode">
                {declaredActionsForUnit(combat.actions, focusedUnit.id).length}/
                {focusedUnit.stats.skillSlots} slots declarados
              </span>
            ) : null}
          </div>

          <div className="sv-drawer-actions">
            <span className="sv-scene-mode">
              Utilidad como carta de APOYO · dominio, hábitat y redirección en
              «Avanzado»
            </span>
          </div>
        </div>

        {mode === "sheet" ? (
          focusedUnit ? (
            <SheetPanel
              unit={focusedUnit}
              viewer={viewer}
              combat={combat}
              campaign={campaign}
              activeSlot={
                selectedSlot?.unitId === focusedUnit.id
                  ? selectedSlot.slot
                  : undefined
              }
              canDeclare={canDeclare(focusedUnit)}
              locked={isUnitLocked(combat, focusedUnit.id)}
              onSlotSelect={(slot) => handleSheetSlot(focusedUnit, slot)}
            />
          ) : (
            <div className="sv-sheet sv-sheet--empty">
              <p>Selecciona una unidad en el escenario para ver su ficha.</p>
            </div>
          )
        ) : (
          <div className="sv-skill-panel">
            <div className="sv-skill-head">
              <span>
                SKILLS ·{" "}
                {focusedUnit?.team === "players" ? "PARTY" : "HOSTILES"}
              </span>
              <span className="sv-skill-page">
                {safePage + 1}/{totalPages}
              </span>
            </div>

            {focusedUnit ? (
              <>
                {visibleSkills.length === 0 ? (
                  <p className="sv-drawer-hint">
                    Esta unidad no tiene skills equipadas. Usa la declaración
                    avanzada para utilidad, dominio o hábitat.
                  </p>
                ) : (
                  <div className="sv-skill-cards">
                    {visibleSkills.map((skill, index) => {
                      const accent =
                        SKILL_ACCENTS[index % SKILL_ACCENTS.length] ?? "rust";
                      const isSupport =
                        skill.baseDamage === 0 && skill.coinDamage === 0;
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          className={`sv-skill-card sv-skill-card--${accent}`}
                          data-selected={
                            selectedSkillId === skill.id ? "true" : undefined
                          }
                          disabled={!canDeclare(focusedUnit)}
                          onClick={() => pickSkill(skill.id)}
                          aria-label={`Elegir ${skill.name} para ${focusedUnit.name}`}
                        >
                          <span className="sv-skill-icon">
                            <svg viewBox="0 0 100 100" aria-hidden>
                              <polygon points="50,3 97,38 79,97 21,97 3,38" />
                            </svg>
                            <b>{initialFor(skill.name, 0)}</b>
                          </span>
                          <span className="sv-skill-body">
                            <span className="sv-skill-name">{skill.name}</span>
                            <span className="sv-skill-kind">
                              {isSupport ? "APOYO" : "ATAQUE"}
                            </span>
                            {isSupport ? (
                              <span className="sv-skill-support">
                                {skill.description ??
                                  `Objetivo único · ${skill.coins} monedas`}
                              </span>
                            ) : (
                              <span className="sv-skill-stats">
                                <span>
                                  <Icon name="shield" size={10} />{" "}
                                  {skill.baseClash}
                                  <em> +{skill.coinClash}/c</em>
                                </span>
                                <span>
                                  <Icon name="sword" size={10} />{" "}
                                  {skill.baseDamage}
                                  <em> +{skill.coinDamage}/c</em>
                                </span>
                              </span>
                            )}
                            {skill.description ? (
                              <span className="sv-skill-desc">
                                {skill.description}
                              </span>
                            ) : null}
                          </span>
                          <span className="sv-skill-coins">
                            <span className="sv-coin-mini" />
                            <b>{skill.coins}</b>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {focusedUtility ? (
                  <div className="sv-support">
                    <div className="sv-support-head">
                      <span>APOYO</span>
                      <span>UTILIDAD EQUIPADA</span>
                    </div>
                    <button
                      type="button"
                      className="sv-support-card"
                      data-selected={
                        support?.utilityId === focusedUtility.id
                          ? "true"
                          : undefined
                      }
                      disabled={supportBlockedReason !== null}
                      onClick={handleSupportPick}
                      aria-label={`Elegir ${focusedUtility.name} como apoyo`}
                      title={
                        supportBlockedReason ??
                        "Elige un aliado vivo o a ti mismo"
                      }
                    >
                      <span className="sv-support-icon">
                        {focusedUtility.image || focusedUtility.icon ? (
                          <img
                            src={
                              (focusedUtility.image ||
                                focusedUtility.icon) as string
                            }
                            alt=""
                          />
                        ) : (
                          <b>{initialFor(focusedUtility.name, 0)}</b>
                        )}
                      </span>
                      <span className="sv-support-body">
                        <span className="sv-support-name">
                          {focusedUtility.name}
                        </span>
                        <span className="sv-support-kind">
                          UTILIDAD · {utilityEffectLabel(focusedUtility)}
                        </span>
                        <span className="sv-support-meta">
                          {focusedUtilityUses} usos restantes
                          {focusedSupportSlotLabel
                            ? ` · SkillSlot ${focusedSupportSlotLabel}`
                            : ""}
                        </span>
                        {supportBlockedReason ? (
                          <span className="sv-support-reason">
                            {supportBlockedReason}
                          </span>
                        ) : (
                          <span className="sv-support-hint">
                            Aliado vivo o tu personaje · línea verde
                          </span>
                        )}
                      </span>
                      <span className="sv-support-arrow" aria-hidden>
                        →
                      </span>
                    </button>
                  </div>
                ) : null}

                <div className="sv-skill-foot">
                  <button
                    type="button"
                    className="sv-pager-btn"
                    onClick={() =>
                      setPage((current) => Math.max(0, current - 1))
                    }
                    disabled={safePage === 0}
                    aria-label="Skills anteriores"
                  >
                    <Icon name="chevron-up" size={13} />
                  </button>
                  <span className="sv-skill-foot-note">
                    {focusedSkills.length} skills · {focusedUnit.name} · 3 por
                    página
                  </span>
                  <button
                    type="button"
                    className="sv-pager-btn"
                    onClick={() =>
                      setPage((current) =>
                        Math.min(totalPages - 1, current + 1),
                      )
                    }
                    disabled={safePage >= totalPages - 1}
                    aria-label="Skills siguientes"
                  >
                    <Icon name="chevron-down" size={13} />
                  </button>
                </div>

                {!canDeclare(focusedUnit) ? (
                  <p className="sv-skill-note">
                    Solo{" "}
                    {viewer.role === "dm"
                      ? "el DM puede declarar por los hostiles"
                      : "el jugador controla su propia unidad"}
                    . La utilidad equipada tiene su carta de APOYO; dominio,
                    hábitat y redirección siguen en «Avanzado».
                  </p>
                ) : (
                  <p className="sv-skill-note">
                    Al elegir una skill se iluminan los objetivos del bando
                    contrario. La carta de APOYO declara la utilidad sobre un
                    aliado; dominio, hábitat y redirección siguen en «Avanzado».
                  </p>
                )}
              </>
            ) : (
              <p className="sv-drawer-hint">
                Selecciona una unidad para ver sus skills.
              </p>
            )}
          </div>
        )}

        <DrawerAside
          unit={focusedUnit}
          viewer={viewer}
          combat={combat}
          campaign={campaign}
        />
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                      */
/* -------------------------------------------------------------------------- */

function SlotButton({
  unit,
  slot,
  tone,
  incoming,
  glyph,
  label,
  active,
  locked,
  targetable,
  onClick,
  registerRef,
}: {
  unit: CombatUnit;
  slot: number;
  tone?: LineTone;
  incoming?: LineTone;
  glyph: string;
  label?: string;
  active: boolean;
  locked: boolean;
  targetable: boolean;
  onClick: () => void;
  registerRef: (element: HTMLButtonElement | null) => void;
}) {
  const style = {
    "--slot-tone": tone ? TONE_COLOR[tone] : "rgba(242,237,224,.32)",
    "--incoming-tone": incoming ? TONE_COLOR[incoming] : "transparent",
  } as CSSProperties;

  return (
    <button
      ref={registerRef}
      type="button"
      className="sv-slot"
      data-tone={tone}
      data-incoming={incoming}
      data-active={active ? "true" : undefined}
      data-targetable={targetable ? "true" : undefined}
      data-locked={locked ? "true" : undefined}
      onClick={onClick}
      aria-label={`SkillSlot ${slot} de ${unit.name}${
        label ? `: ${label}` : ""
      }${active ? ", activo" : ""}${locked ? ", unidad lista" : ""}${
        targetable ? ", objetivo válido" : ""
      }`}
      aria-pressed={active}
      style={style}
    >
      <svg viewBox="0 0 100 100" className="sv-slot-shape" aria-hidden>
        <polygon points="50,3 97,38 79,97 21,97 3,38" />
      </svg>
      <span className="sv-slot-glyph">{glyph}</span>
      {tone ? <span className="sv-slot-pip" /> : null}
    </button>
  );
}

function SheetPanel({
  unit,
  viewer,
  combat,
  campaign,
  activeSlot,
  canDeclare,
  locked,
  onSlotSelect,
}: {
  unit: CombatUnit;
  viewer: Viewer;
  combat: PublicCombatState;
  campaign: Campaign;
  activeSlot?: number;
  canDeclare: boolean;
  locked: boolean;
  onSlotSelect: (slot: number) => void;
}) {
  const content = campaign.content;
  const exact = exactHpFor(unit, viewer);
  const percent = hpPercent(unit);
  const roll = unit.spdRoll ?? 0;
  const actions = declaredActionsForUnit(combat.actions, unit.id);
  const utility = findItem(content, unit.equipment.utility ?? undefined);
  const domain = specialForUnit(content, unit, "domain");
  const habitat = specialForUnit(content, unit, "habitat");
  const effects = unit.effects.filter((effect) => effect.stacks > 0);

  return (
    <div className="sv-sheet" data-side={unit.team === "players" ? "party" : "enemy"}>
      <div className="sv-sheet-top">
        <div className="sv-sheet-meta">
          <span
            className={`sv-sheet-side sv-sheet-side--${
              unit.team === "players" ? "party" : "enemy"
            }`}
          >
            {unit.team === "players" ? "PARTY" : "HOSTIL"}
          </span>
          <span className="sv-sheet-tag">{KIND_LABEL[unit.kind]}</span>
          {locked ? (
            <span className="sv-sheet-tag" title="Unidad bloqueada">
              LISTA
            </span>
          ) : null}
          {unit.defeated ? (
            <span className="sv-sheet-tag">CAÍDA</span>
          ) : null}
        </div>
        <span
          className="sv-sheet-hp-mode"
          data-masked={exact ? undefined : "true"}
        >
          {exact ? "HP EXACTO" : "HP ESTIMADO"}
        </span>
      </div>

      <div className="sv-sheet-hp">
        <div className="sv-sheet-hp-top">
          <span>HP</span>
          <b>{hpReadout(unit, viewer)}</b>
          <em>
            {exact
              ? `${percent}% · máx ${unit.stats.hpMax}`
              : `${percent}% · HP estimado`}
          </em>
        </div>
        <div className="sv-hpbar sv-hpbar--sheet">
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="sv-sheet-stats">
        <article className="sv-sheet-stat">
          <span>DEF</span>
          <b>{unit.stats.def}</b>
          <em>Mitigación</em>
        </article>
        <article className="sv-sheet-stat">
          <span>ATK</span>
          <b>{unit.stats.atk}</b>
          <em>Potencia</em>
        </article>
        <article className="sv-sheet-stat">
          <span>SPD</span>
          <b>{unit.stats.spd}</b>
          <em>
            {unit.stats.spd - roll} base +{roll} roll
          </em>
        </article>
        <article className="sv-sheet-stat">
          <span>LUCK</span>
          <b>{unit.stats.luck}</b>
          <em>Azar</em>
        </article>
        <article className="sv-sheet-stat">
          <span>SKILLSLOTS</span>
          <b>{unit.stats.skillSlots}</b>
          <em>{unit.stats.skillSlots} acciones / ronda</em>
        </article>
      </div>

      <div className="sv-sheet-meta">
        <span className="sv-sheet-tag">{roleLabel(unit)}</span>
        {utility ? (
          <span className="sv-sheet-tag" title="Utilidad equipada">
            {utility.name} ×{unit.utilityUses}
          </span>
        ) : null}
        {domain ? (
          <span className="sv-sheet-tag" title="Dominio equipado">
            {domain.name}
          </span>
        ) : null}
        {habitat ? (
          <span className="sv-sheet-tag" title="Hábitat equipado">
            {habitat.name}
          </span>
        ) : null}
      </div>

      {effects.length > 0 ? (
        <div className="sv-sheet-effects">
          {effects.map((effect, index) => (
            <span
              key={`${effect.effectId}:${index}`}
              className="sv-sheet-effect"
              data-passive={effect.passive ? "true" : undefined}
              title={effectLabel(content, effect.effectId)}
            >
              {effectLabel(content, effect.effectId)} ×{effect.stacks}
            </span>
          ))}
        </div>
      ) : null}

      <div className="sv-sheet-slots">
        <div className="sv-sheet-slots-head">
          <span>SKILLSLOTS</span>
          <b>
            {canDeclare
              ? "click para declarar"
              : locked
                ? "unidad lista"
                : "solo lectura"}
          </b>
        </div>
        <div className="sv-sheet-slots-row">
          {Array.from(
            { length: Math.max(0, unit.stats.skillSlots) },
            (_, index) => {
              const slot = index + 1;
              return (
                <button
                  key={slot}
                  type="button"
                  className="sv-sheet-slot"
                  data-active={activeSlot === slot ? "true" : undefined}
                  onClick={() => onSlotSelect(slot)}
                  disabled={!canDeclare}
                  aria-label={`Declarar con el SkillSlot ${slot} de ${unit.name}`}
                >
                  <svg viewBox="0 0 100 100" aria-hidden>
                    <polygon points="50,3 97,38 79,97 21,97 3,38" />
                  </svg>
                  <b>{slot}</b>
                </button>
              );
            },
          )}
        </div>
      </div>

      <div className="sv-sheet-actions">
        <div className="sv-sheet-actions-head">
          <span>ACCIONES DECLARADAS</span>
          <b>{actions.length} acciones</b>
        </div>
        {actions.length === 0 ? (
          <div className="sv-sheet-action-row">
            <span>—</span>
            <span>Sin acciones declaradas en esta ronda.</span>
          </div>
        ) : (
          actions.map((action) => {
            const target = unitById(combat, action.targetId);
            return (
              <div
                key={`${action.slot}:${action.skillId ?? action.utilityId ?? action.special}`}
                className="sv-sheet-action-row"
              >
                <span>[{action.slot}]</span>
                <span title={serverActionLabelSafe(action, campaign)}>
                  {serverActionLabelSafe(action, campaign)}
                  {target ? <em> → {target.name}</em> : null}
                  {action.targetSlot ? (
                    <em> · slot {action.targetSlot}</em>
                  ) : null}
                  {action.redirectFor ? (
                    <em>
                      {" "}
                      · protege a{" "}
                      {unitById(combat, action.redirectFor)?.name ?? "—"}
                    </em>
                  ) : null}
                  {action.locked ? <em> · bloqueada</em> : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function DrawerAside({
  unit,
  viewer,
  combat,
  campaign,
}: {
  unit: CombatUnit | null;
  viewer: Viewer;
  combat: PublicCombatState;
  campaign: Campaign;
}) {
  const utility = unit
    ? findItem(campaign.content, unit.equipment.utility ?? undefined)
    : null;
  return (
    <div className="sv-drawer-aside">
      <div className="sv-drawer-kicker">LECTURA RÁPIDA</div>
      <div className="sv-stat-line">
        <span>HP</span>
        <b>{unit ? hpReadout(unit, viewer) : "—"}</b>
      </div>
      <div className="sv-stat-line">
        <span>Velocidad</span>
        <b>
          {unit ? unit.stats.spd : "—"}
          {unit && unit.spdRoll ? <em> (+{unit.spdRoll} roll)</em> : null}
        </b>
      </div>
      <div className="sv-stat-line">
        <span>DEF / ATK</span>
        <b>{unit ? `${unit.stats.def} / ${unit.stats.atk}` : "—"}</b>
      </div>
      <div className="sv-stat-line">
        <span>LUCK</span>
        <b>{unit ? unit.stats.luck : "—"}</b>
      </div>
      <div className="sv-stat-line">
        <span>SkillSlots</span>
        <b>{unit ? unit.stats.skillSlots : "—"}</b>
      </div>
      <div className="sv-stat-line">
        <span>Declaradas</span>
        <b>{unit ? declaredActionsForUnit(combat.actions, unit.id).length : "—"}</b>
      </div>
      {utility ? (
        <div className="sv-stat-line">
          <span>Utilidad</span>
          <b>
            {utility.name} <em>×{unit?.utilityUses ?? 0}</em>
          </b>
        </div>
      ) : null}
      <p className="sv-aside-note">
        {viewer.role === "dm"
          ? "El DM controla a los hostiles y puede inspeccionar cualquier unidad. El HP enemigo es exacto."
          : "Solo puedes inspeccionar tu personaje y tus aliados. El HP de los hostiles se muestra estimado."}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function latestActorId(events: CombatEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const actorId = events[index]?.actorId;
    if (actorId) return actorId;
  }
  return undefined;
}

function initialUnitId(
  combat: PublicCombatState,
  viewer: Viewer,
): string | null {
  if (viewer.role === "player") {
    return (
      combat.units.find(
        (unit) =>
          unit.team === "players" &&
          unit.characterId === viewer.characterId,
      )?.id ??
      combat.units.find((unit) => unit.team === "players")?.id ??
      null
    );
  }
  return (
    combat.units.find((unit) => unit.team === "enemies" && isAliveUnit(unit))
      ?.id ??
    combat.units.find((unit) => unit.team === "players")?.id ??
    combat.units[0]?.id ??
    null
  );
}

function exactHpFor(unit: CombatUnit, viewer: Viewer): boolean {
  return viewer.role === "dm" || unit.team === "players";
}

function hpReadout(unit: CombatUnit, viewer: Viewer): string {
  return exactHpFor(unit, viewer)
    ? `${unit.hpCurrent}/${unit.stats.hpMax}`
    : `≈${hpPercent(unit)}%`;
}

function roleLabel(unit: CombatUnit): string {
  const side = unit.team === "players" ? "PARTY" : "HOSTIL";
  return `${side} · ${KIND_LABEL[unit.kind]}`;
}

function slotKey(unitId: string, slot: number): string {
  return `slot:${unitId}:${slot}`;
}

function unitKey(unitId: string): string {
  return `unit:${unitId}`;
}

function sameGeometry(
  a: Record<string, { x: number; y: number }>,
  b: Record<string, { x: number; y: number }>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const pointB = b[key];
    const pointA = a[key];
    return (
      pointA !== undefined &&
      pointB !== undefined &&
      Math.abs(pointA.x - pointB.x) < 0.5 &&
      Math.abs(pointA.y - pointB.y) < 0.5
    );
  });
}

function toneForAction(
  source: CombatUnit,
  action: DeclaredAction,
  combat: PublicCombatState,
): LineTone {
  if (action.utilityId || action.special) return "green";
  if (!action.skillId) return "green";
  const target = unitById(combat, action.targetId);
  if (!target) return source.team === "players" ? "blue" : "red";
  const incomingSkill = (combat.actions[target.id] ?? []).some(
    (other) => Boolean(other.skillId) && other.targetId === source.id,
  );
  if (incomingSkill) return "yellow";
  return source.team === "players" ? "blue" : "red";
}

function actionName(
  action: DeclaredAction,
  content: Campaign["content"],
): string {
  if (action.skillId) {
    return findSkill(content, action.skillId)?.name ?? "Skill";
  }
  if (action.utilityId) {
    return findItem(content, action.utilityId)?.name ?? "Utilidad";
  }
  return action.special === "domain" ? "Dominio" : "Hábitat";
}

function serverActionLabelSafe(
  action: DeclaredAction,
  campaign: Campaign,
): string {
  if (action.skillId) {
    return findSkill(campaign.content, action.skillId)?.name ?? "Skill";
  }
  if (action.utilityId) {
    return findItem(campaign.content, action.utilityId)?.name ?? "Utilidad";
  }
  return action.special === "domain" ? "Dominio" : "Hábitat";
}

function initialFor(name: string, fallbackIndex: number): string {
  const trimmed = name.trim();
  if (!trimmed) return String(fallbackIndex + 1);
  return trimmed.slice(0, 1).toUpperCase();
}

/** Tipo legible de la utilidad a partir de su `useEffect`. */
function utilityEffectLabel(item: Pick<Item, "useEffect">): string {
  const actions = item.useEffect ?? [];
  if (actions.some((action) => action.type === "heal")) return "Curación";
  if (actions.some((action) => action.type === "modifyStat")) return "Buff";
  if (actions.some((action) => action.type === "damage")) return "Daño";
  if (actions.some((action) => action.type === "applyEffect")) return "Efecto";
  return "Utilidad";
}

function equippedSkillsFor(
  content: Campaign["content"],
  unit: CombatUnit,
) {
  return [...new Set(equippedSkillIds(unit))]
    .map((id) => findSkill(content, id))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
}

function toDeclaration(action: DeclaredAction): CombatDeclaration {
  const { unitId, locked, ...rest } = action;
  void unitId;
  void locked;
  return rest;
}
