import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Icon } from "../components/Icons";
import "./CombatScenePrototype.css";

/**
 * Prototipo visual aislado de la escena de combate (rediseño 3F.5).
 *
 * No toca el motor, ni la API, ni el estado real: usa datos mock para validar
 * dirección de arte, composición y flujo de declaración antes de conectar la
 * escena. Ruta: /design/combat
 */

type Side = "party" | "enemy";
type LineTone = "blue" | "yellow" | "red" | "green";
type SkillKind = "attack" | "support";
type Viewer = "dm" | "player";
type DrawerMode = "sheet" | "skills";

interface DemoUnit {
  id: string;
  name: string;
  role: string;
  side: Side;
  sprite: string;
  hp: number;
  hpMax: number;
  def: number;
  atk: number;
  spdBase: number;
  spdRoll: number;
  luck: number;
  slots: number;
}

interface DemoNotice {
  text: string;
  /** Los avisos fijados por path no se auto-ocultan (capturas estáticas). */
  sticky: boolean;
}

interface DemoSkill {
  id: string;
  name: string;
  glyph: string;
  kind: SkillKind;
  coins: number;
  baseClash: number;
  coinClash: number;
  baseDamage: number;
  coinDamage: number;
  support?: string;
  accent: "rust" | "amber" | "steel" | "moss";
}

interface SlotRef {
  unitId: string;
  slot: number;
}

interface DemoDeclaration {
  id: string;
  from: SlotRef;
  to: SlotRef;
  tone: LineTone;
  glyph: string;
}

const UNITS: DemoUnit[] = [
  {
    id: "e1",
    name: "Purifier Scout",
    role: "Hostil · explorador",
    side: "enemy",
    sprite: "/assets/design/sp-creature.png",
    hp: 25,
    hpMax: 40,
    def: 3,
    atk: 7,
    spdBase: 13,
    spdRoll: 2,
    luck: 1,
    slots: 2,
  },
  {
    id: "e2",
    name: "Protocol Echo",
    role: "Hostil · jefe",
    side: "enemy",
    sprite: "/assets/design/sp-body-gray.png",
    hp: 62,
    hpMax: 90,
    def: 6,
    atk: 9,
    spdBase: 11,
    spdRoll: 4,
    luck: 2,
    slots: 3,
  },
  {
    id: "p1",
    name: "Arzu",
    role: "Party · vanguardia",
    side: "party",
    sprite: "/assets/design/sp-boy.png",
    hp: 42,
    hpMax: 50,
    def: 5,
    atk: 8,
    spdBase: 10,
    spdRoll: 3,
    luck: 2,
    slots: 3,
  },
  {
    id: "p2",
    name: "Maciel",
    role: "Party · tiradora",
    side: "party",
    sprite: "/assets/design/sp-coat.png",
    hp: 31,
    hpMax: 45,
    def: 2,
    atk: 6,
    spdBase: 11,
    spdRoll: 1,
    luck: 3,
    slots: 2,
  },
];

const PARTY_SKILLS: DemoSkill[] = [
  {
    id: "odachi",
    name: "Odachi",
    glyph: "斬",
    kind: "attack",
    coins: 3,
    baseClash: 5,
    coinClash: 7,
    baseDamage: 10,
    coinDamage: 5,
    accent: "rust",
  },
  {
    id: "dagger",
    name: "Simple Dagger",
    glyph: "刺",
    kind: "attack",
    coins: 2,
    baseClash: 4,
    coinClash: 4,
    baseDamage: 6,
    coinDamage: 3,
    accent: "steel",
  },
  {
    id: "lance",
    name: "Lance",
    glyph: "槍",
    kind: "attack",
    coins: 3,
    baseClash: 6,
    coinClash: 5,
    baseDamage: 8,
    coinDamage: 4,
    accent: "amber",
  },
  {
    id: "rifle",
    name: "Simple Rifle",
    glyph: "銃",
    kind: "attack",
    coins: 2,
    baseClash: 3,
    coinClash: 6,
    baseDamage: 12,
    coinDamage: 4,
    accent: "rust",
  },
  {
    id: "injection",
    name: "Healing Injection",
    glyph: "治",
    kind: "support",
    coins: 1,
    baseClash: 0,
    coinClash: 0,
    baseDamage: 0,
    coinDamage: 0,
    support: "Cura a un aliado",
    accent: "moss",
  },
  {
    id: "fetters",
    name: "Broken Fetters",
    glyph: "守",
    kind: "support",
    coins: 2,
    baseClash: 2,
    coinClash: 2,
    baseDamage: 0,
    coinDamage: 0,
    support: "Protección al equipo",
    accent: "steel",
  },
];

const ENEMY_SKILLS: DemoSkill[] = [
  {
    id: "echo-lance",
    name: "Echo Lance",
    glyph: "槍",
    kind: "attack",
    coins: 3,
    baseClash: 6,
    coinClash: 5,
    baseDamage: 14,
    coinDamage: 4,
    accent: "rust",
  },
  {
    id: "scout-rifle",
    name: "Scout Rifle",
    glyph: "銃",
    kind: "attack",
    coins: 2,
    baseClash: 3,
    coinClash: 6,
    baseDamage: 12,
    coinDamage: 4,
    accent: "amber",
  },
  {
    id: "echo-guard",
    name: "Echo Guard",
    glyph: "守",
    kind: "support",
    coins: 2,
    baseClash: 2,
    coinClash: 2,
    baseDamage: 0,
    coinDamage: 0,
    support: "Protección a un hostil",
    accent: "steel",
  },
];

const PRESET_DECLARATIONS: DemoDeclaration[] = [
  {
    id: "preset-1",
    from: { unitId: "p1", slot: 1 },
    to: { unitId: "e1", slot: 1 },
    tone: "blue",
    glyph: "斬",
  },
  {
    id: "preset-2",
    from: { unitId: "e1", slot: 1 },
    to: { unitId: "p2", slot: 1 },
    tone: "red",
    glyph: "銃",
  },
  {
    id: "preset-3",
    from: { unitId: "p2", slot: 1 },
    to: { unitId: "e2", slot: 1 },
    tone: "yellow",
    glyph: "刺",
  },
  {
    id: "preset-4",
    from: { unitId: "e2", slot: 1 },
    to: { unitId: "p2", slot: 1 },
    tone: "yellow",
    glyph: "槍",
  },
  {
    id: "preset-5",
    from: { unitId: "p1", slot: 2 },
    to: { unitId: "p2", slot: 2 },
    tone: "green",
    glyph: "治",
  },
];

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
  green: "Apoyo",
};

type SceneTheme = "paper" | "night";

const INITIAL_VARIANT =
  typeof window === "undefined"
    ? ""
    : (window.location.pathname.split("/").filter(Boolean)[2] ?? "");

const INITIAL_SCENE: SceneTheme = INITIAL_VARIANT.includes("night")
  ? "night"
  : "paper";
const INITIAL_SKILL = INITIAL_VARIANT.includes("target") ? "odachi" : null;
const INITIAL_CLASH = INITIAL_VARIANT.includes("clash");
const INITIAL_STATIC = INITIAL_VARIANT.includes("static");
const INITIAL_VIEWER: Viewer = INITIAL_VARIANT.includes("player")
  ? "player"
  : "dm";
const INITIAL_MODE: DrawerMode =
  INITIAL_VARIANT.includes("sheet") ||
  INITIAL_VARIANT.includes("ficha") ||
  INITIAL_VARIANT.includes("hostile")
    ? "sheet"
    : "skills";
const INITIAL_INSPECTED_ID =
  INITIAL_VIEWER === "dm" && INITIAL_VARIANT.includes("hostile") ? "e2" : "p1";

const NOTICE_HOSTILE = "No puedes inspeccionar hostiles";

const INITIAL_NOTICE: DemoNotice | null = INITIAL_VARIANT.includes("denied")
  ? { text: NOTICE_HOSTILE, sticky: true }
  : null;

const skillKey = (skill: DemoSkill): string => skill.id;

const slotKey = (ref: SlotRef): string => `${ref.unitId}:${ref.slot}`;

const unitById = (id: string): DemoUnit =>
  UNITS.find((unit) => unit.id === id) ?? UNITS[0]!;

const skillsFor = (unit: DemoUnit): DemoSkill[] =>
  unit.side === "party" ? PARTY_SKILLS : ENEMY_SKILLS;

const totalSpeed = (unit: DemoUnit): number => unit.spdBase + unit.spdRoll;

const hpPercent = (unit: DemoUnit): number =>
  Math.max(0, Math.min(100, Math.round((unit.hp / unit.hpMax) * 100)));

const exactHpFor = (unit: DemoUnit, viewer: Viewer): boolean =>
  viewer === "dm" || unit.side === "party";

const hpReadout = (unit: DemoUnit, viewer: Viewer): string =>
  exactHpFor(unit, viewer)
    ? `${unit.hp}/${unit.hpMax}`
    : `≈${hpPercent(unit)}%`;

const hpFootLabel = (unit: DemoUnit, viewer: Viewer): string => {
  if (unit.hp <= 0) return "CAÍDO";
  return exactHpFor(unit, viewer)
    ? `${unit.hp} HP`
    : `≈${hpPercent(unit)}% HP`;
};

export function CombatScenePrototype() {
  const [declarations, setDeclarations] = useState<DemoDeclaration[]>(
    PRESET_DECLARATIONS,
  );
  const [selectedSlot, setSelectedSlot] = useState<SlotRef | null>({
    unitId: "p1",
    slot: 1,
  });
  const [scene, setScene] = useState<SceneTheme>(INITIAL_SCENE);
  const [viewer, setViewer] = useState<Viewer>(INITIAL_VIEWER);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(
    INITIAL_SKILL,
  );
  const [inspectedUnitId, setInspectedUnitId] = useState<string | null>(
    INITIAL_INSPECTED_ID,
  );
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(INITIAL_MODE);
  const [notice, setNotice] = useState<DemoNotice | null>(INITIAL_NOTICE);
  const [page, setPage] = useState(0);
  const [showClash, setShowClash] = useState(INITIAL_CLASH);
  const [clashRun, setClashRun] = useState(INITIAL_CLASH ? 1 : 0);
  const [geometry, setGeometry] = useState<Record<string, { x: number; y: number }>>(
    {},
  );
  const stageRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef(new Map<string, HTMLButtonElement>());

  const party = UNITS.filter((unit) => unit.side === "party");
  const enemies = UNITS.filter((unit) => unit.side === "enemy");
  const inspectedUnit = inspectedUnitId ? unitById(inspectedUnitId) : null;
  const selectedUnit = selectedSlot ? unitById(selectedSlot.unitId) : null;
  /** Unidad en foco: manda en la ficha, en las skills y en el encabezado. */
  const activeUnit = inspectedUnit ?? selectedUnit;
  const availableSkills = activeUnit ? skillsFor(activeUnit) : [];
  const totalPages = Math.max(1, Math.ceil(availableSkills.length / 3));
  const visibleSkills = availableSkills.slice(page * 3, page * 3 + 3);
  const selectedSkill =
    availableSkills.find((skill) => skill.id === selectedSkillId) ?? null;
  const targeting = Boolean(selectedSkill);
  const turnOrder = [...UNITS].sort(
    (a, b) => totalSpeed(b) - totalSpeed(a) || a.name.localeCompare(b.name),
  );
  const initiative = turnOrder.map((unit, index) => ({ unit, index: index + 1 }));

  const canInspect = useCallback(
    (unit: DemoUnit | null): boolean =>
      Boolean(unit) && (viewer === "dm" || unit?.side === "party"),
    [viewer],
  );

  const pushNotice = useCallback((text: string) => {
    setNotice({ text, sticky: false });
  }, []);

  useEffect(() => {
    if (!notice || notice.sticky) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const sourceTone = useMemo(() => {
    const map = new Map<string, LineTone>();
    for (const declaration of declarations) {
      map.set(slotKey(declaration.from), declaration.tone);
    }
    return map;
  }, [declarations]);

  const targetTone = useMemo(() => {
    const map = new Map<string, LineTone>();
    for (const declaration of declarations) {
      map.set(slotKey(declaration.to), declaration.tone);
    }
    return map;
  }, [declarations]);

  const sourceGlyph = useMemo(() => {
    const map = new Map<string, string>();
    for (const declaration of declarations) {
      map.set(slotKey(declaration.from), declaration.glyph);
    }
    return map;
  }, [declarations]);

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
    setGeometry(next);
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
  }, [measure, declarations, selectedSlot, selectedSkillId, page]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedSkillId(null);
        setShowClash(false);
        setNotice(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isTargetable = useCallback(
    (target: DemoUnit): boolean => {
      if (!selectedSkill || !selectedUnit) return false;
      if (selectedSkill.kind === "support") {
        return target.side === selectedUnit.side && target.id !== selectedUnit.id;
      }
      return target.side !== selectedUnit.side;
    },
    [selectedSkill, selectedUnit],
  );

  function selectSlot(ref: SlotRef) {
    setSelectedSlot(ref);
    setSelectedSkillId(null);
    setPage(0);
  }

  function switchViewer(next: Viewer) {
    setViewer(next);
    setSelectedSkillId(null);
    if (next === "player") {
      if (inspectedUnit?.side === "enemy") setInspectedUnitId("p1");
      if (!selectedSlot || unitById(selectedSlot.unitId).side === "enemy") {
        setSelectedSlot({ unitId: "p1", slot: 1 });
      }
      pushNotice(
        "Perspectiva jugador · HP de hostiles estimado · no puedes inspeccionar enemigos",
      );
    } else {
      pushNotice("Perspectiva DM · HP exacto e inspección de cualquier unidad");
    }
  }

  function openDrawerMode(mode: DrawerMode) {
    if (mode === "skills" && activeUnit) {
      if (!selectedSlot || selectedSlot.unitId !== activeUnit.id) {
        setSelectedSlot({ unitId: activeUnit.id, slot: 1 });
      }
      setPage(0);
    }
    setDrawerMode(mode);
  }

  function focusSlotFromSheet(unit: DemoUnit, slot: number) {
    setInspectedUnitId(unit.id);
    selectSlot({ unitId: unit.id, slot });
    setDrawerMode("skills");
  }

  function pickSkill(skill: DemoSkill) {
    if (!activeUnit) return;
    if (!selectedSlot || selectedSlot.unitId !== activeUnit.id) {
      setSelectedSlot({ unitId: activeUnit.id, slot: 1 });
    }
    setDrawerMode("skills");
    setSelectedSkillId(skill.id);
  }

  function handleSpriteClick(unit: DemoUnit) {
    if (targeting) {
      pushNotice(
        isTargetable(unit)
          ? "Toca un SkillSlot iluminado para cerrar la declaración"
          : "Ese objetivo no es válido para esta skill",
      );
      return;
    }
    if (!canInspect(unit)) {
      pushNotice(NOTICE_HOSTILE);
      return;
    }
    setInspectedUnitId(unit.id);
    setDrawerMode("sheet");
  }

  function handleSlotClick(unit: DemoUnit, slot: number) {
    if (targeting) {
      if (!isTargetable(unit) || !selectedSlot) {
        pushNotice("Ese SkillSlot no es un objetivo válido para esta skill");
        return;
      }
      declare(selectedSlot, { unitId: unit.id, slot });
      return;
    }
    if (!canInspect(unit)) {
      pushNotice(NOTICE_HOSTILE);
      return;
    }
    setInspectedUnitId(unit.id);
    selectSlot({ unitId: unit.id, slot });
    setDrawerMode("skills");
  }

  function declare(from: SlotRef, to: SlotRef) {
    const source = unitById(from.unitId);
    const target = unitById(to.unitId);
    const skill = skillsFor(source).find((entry) => entry.id === selectedSkillId);
    if (!skill) return;

    let tone: LineTone;
    if (skill.kind === "support") {
      tone = "green";
    } else {
      const mutual = declarations.some(
        (entry) =>
          entry.from.unitId === target.id &&
          entry.to.unitId === source.id &&
          entry.tone !== "green",
      );
      tone = mutual ? "yellow" : source.side === "party" ? "blue" : "red";
    }

    setDeclarations((current) => {
      const withoutSource = current.filter(
        (entry) =>
          !(entry.from.unitId === from.unitId && entry.from.slot === from.slot),
      );
      const recolored = withoutSource.map((entry) => {
        if (
          tone === "yellow" &&
          entry.from.unitId === target.id &&
          entry.to.unitId === source.id &&
          entry.tone !== "green"
        ) {
          return { ...entry, tone: "yellow" as const };
        }
        return entry;
      });
      return [
        ...recolored,
        {
          id: `decl-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          from,
          to,
          tone,
          glyph: skill.glyph,
        },
      ];
    });

    const focus = canInspect(target) ? target : source;
    setSelectedSkillId(null);
    setSelectedSlot(null);
    setInspectedUnitId(focus.id);
    setDrawerMode("sheet");
    setPage(0);
  }

  function resetDemo() {
    setDeclarations(PRESET_DECLARATIONS);
    setSelectedSlot({ unitId: "p1", slot: 1 });
    setInspectedUnitId("p1");
    setDrawerMode("skills");
    setSelectedSkillId(null);
    setPage(0);
    setNotice(null);
  }

  function clearLines() {
    setDeclarations([]);
    setSelectedSlot({ unitId: "p1", slot: 1 });
    setInspectedUnitId("p1");
    setDrawerMode("skills");
    setSelectedSkillId(null);
    setPage(0);
    setNotice(null);
  }

  function openClash() {
    setClashRun((run) => run + 1);
    setShowClash(true);
  }

  return (
    <div
      className="sv-app"
      data-scene={scene}
      data-viewer={viewer}
      data-mode={drawerMode}
      data-static={INITIAL_STATIC ? "true" : undefined}
    >
      <div className="sv-ambient" aria-hidden />
      <header className="sv-header">
        <div className="sv-brand">
          <span className="sv-brand-mark">PL</span>
          <div>
            <div className="sv-brand-name">PROTOCOL LIFE</div>
            <div className="sv-brand-sub">PROTOTIPO VISUAL · 3F.5</div>
          </div>
        </div>

        <div className="sv-encounter">
          <span className="sv-encounter-kicker">ENCUENTRO 04</span>
          <strong>Protocolo roto</strong>
          <span className="sv-encounter-sub">Pasillo de contención · Armada 2</span>
        </div>

        <div className="sv-header-actions">
          <div className="sv-viewer" role="group" aria-label="Perspectiva de la mesa">
            <span className="sv-viewer-tag">VISTA</span>
            <button
              type="button"
              className="sv-viewer-btn"
              data-active={viewer === "dm" ? "true" : undefined}
              aria-pressed={viewer === "dm"}
              onClick={() => switchViewer("dm")}
            >
              DM
            </button>
            <button
              type="button"
              className="sv-viewer-btn"
              data-active={viewer === "player" ? "true" : undefined}
              aria-pressed={viewer === "player"}
              onClick={() => switchViewer("player")}
            >
              Jugador
            </button>
          </div>
          <span className="sv-round">
            RONDA <b>01</b>
          </span>
          <span className="sv-phase">DECLARACIÓN</span>
          <button type="button" className="sv-ghost-btn" onClick={openClash}>
            <Icon name="sword" size={13} /> Clash demo
          </button>
          {viewer === "dm" ? (
            <button
              type="button"
              className="sv-ghost-btn"
              onClick={() =>
                setScene((current) => (current === "paper" ? "night" : "paper"))
              }
            >
              <Icon name="flame" size={13} />{" "}
              {scene === "paper" ? "Escena noche" : "Escena papel"}
            </button>
          ) : (
            <button
              type="button"
              className="sv-ghost-btn sv-ghost-btn--locked"
              disabled
              title="Solo el DM puede cambiar la escena"
            >
              <Icon name="lock" size={13} /> Escena · Solo DM
            </button>
          )}
          <button type="button" className="sv-ghost-btn" onClick={resetDemo}>
            <Icon name="arrow-left" size={13} /> Reiniciar
          </button>
        </div>
      </header>

      <main className="sv-main">
        <div className="sv-stage-shell">
          <div
            ref={stageRef}
            className="sv-stage"
            data-targeting={targeting ? "true" : undefined}
          >
            <div className="sv-bg-floor" aria-hidden>
              <img src="/assets/design/bg-floor.png" alt="" />
            </div>
            <div className="sv-bg-wall" aria-hidden>
              <img src="/assets/design/bg-wall.png" alt="" />
            </div>
            <div className="sv-vignette" aria-hidden />
            <div className="sv-stage-dim" aria-hidden />

            <div className="sv-stage-top">
              <span className="sv-stage-tag">
                <span className="sv-stage-dot" /> ESCENA DE COMBATE
              </span>
              <span className="sv-stage-tag sv-stage-tag--right">
                SPD + D6 · SIN RESPUESTA / CLASH / APOYO
              </span>
            </div>

            <aside className="sv-intel" aria-label="HP de enemigos">
              <div className="sv-intel-head">
                <span>HOSTILES</span>
                <b>{enemies.length}</b>
              </div>
              <div className="sv-intel-mode">
                {viewer === "dm" ? "HP EXACTO" : "HP ESTIMADO · VISTA JUGADOR"}
              </div>
              {enemies.map((unit) => (
                <div key={unit.id} className="sv-intel-row">
                  <div className="sv-intel-row-top">
                    <span className="sv-intel-name">{unit.name}</span>
                    <span
                      className="sv-intel-hp"
                      data-masked={exactHpFor(unit, viewer) ? undefined : "true"}
                    >
                      {hpReadout(unit, viewer)}
                    </span>
                  </div>
                  <div className="sv-hpbar sv-hpbar--enemy">
                    <span style={{ width: `${hpPercent(unit)}%` }} />
                  </div>
                </div>
              ))}
            </aside>

            <div className="sv-side sv-side--enemy">
              {enemies.map((unit) => (
                <UnitColumn
                  key={unit.id}
                  unit={unit}
                  viewer={viewer}
                  selected={selectedSlot?.unitId === unit.id}
                  inspected={inspectedUnitId === unit.id}
                  inspectable={canInspect(unit)}
                  activeSlot={
                    selectedSlot?.unitId === unit.id
                      ? selectedSlot.slot
                      : undefined
                  }
                  targetable={targeting && isTargetable(unit)}
                  onSlotClick={handleSlotClick}
                  onInspect={handleSpriteClick}
                  sourceTone={sourceTone}
                  targetTone={targetTone}
                  sourceGlyph={sourceGlyph}
                  stageSlotRefs={slotRefs.current}
                />
              ))}
            </div>

            <div className="sv-side sv-side--party">
              {party.map((unit) => (
                <UnitColumn
                  key={unit.id}
                  unit={unit}
                  viewer={viewer}
                  selected={selectedSlot?.unitId === unit.id}
                  inspected={inspectedUnitId === unit.id}
                  inspectable={canInspect(unit)}
                  activeSlot={
                    selectedSlot?.unitId === unit.id
                      ? selectedSlot.slot
                      : undefined
                  }
                  targetable={targeting && isTargetable(unit)}
                  onSlotClick={handleSlotClick}
                  onInspect={handleSpriteClick}
                  sourceTone={sourceTone}
                  targetTone={targetTone}
                  sourceGlyph={sourceGlyph}
                  stageSlotRefs={slotRefs.current}
                />
              ))}
            </div>

            <svg className="sv-lines" aria-hidden>
              <defs>
                <filter id="sv-line-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="2.8" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {declarations.map((declaration) => {
                const start = geometry[slotKey(declaration.from)];
                const end = geometry[slotKey(declaration.to)];
                if (!start || !end) return null;
                const dx = end.x - start.x;
                const lift = Math.min(90, Math.max(34, Math.abs(dx) * 0.16));
                const c1x = start.x + dx * 0.32;
                const c1y = start.y - lift;
                const c2x = start.x + dx * 0.68;
                const c2y = end.y - lift;
                const color = TONE_COLOR[declaration.tone];
                return (
                  <g
                    key={declaration.id}
                    className="sv-line-group"
                    style={{ "--line-color": color } as CSSProperties}
                  >
                    <path
                      className="sv-line-halo"
                      d={`M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`}
                    />
                    <path
                      className={`sv-line sv-line--${declaration.tone}`}
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

            <div className="sv-legend">
              {(["blue", "yellow", "red", "green"] as LineTone[]).map((tone) => (
                <span key={tone} className="sv-legend-item">
                  <i style={{ background: TONE_COLOR[tone] }} />
                  {TONE_LABEL[tone]}
                </span>
              ))}
            </div>

            {notice ? (
              <div
                className="sv-notice"
                role="status"
                data-sticky={notice.sticky ? "true" : undefined}
              >
                <Icon name="alert" size={12} />
                <span>{notice.text}</span>
                {notice.sticky ? (
                  <button
                    type="button"
                    className="sv-notice-close"
                    onClick={() => setNotice(null)}
                    aria-label="Cerrar aviso"
                  >
                    <Icon name="close" size={11} />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="sv-understage">
            <section className="sv-initiative" aria-label="Orden de iniciativa">
              <div className="sv-under-title">
                <span>INICIATIVA</span>
                <b>SPD + 1..4</b>
              </div>
              <div className="sv-initiative-row">
                {initiative.map(({ unit, index }) => (
                  <span
                    key={unit.id}
                    className={`sv-initiative-chip sv-initiative-chip--${unit.side}`}
                    title={`${unit.name} · SPD ${totalSpeed(unit)}`}
                  >
                    <b>{index}</b>
                    <span className="sv-initiative-name">{unit.name}</span>
                    <em>{totalSpeed(unit)}</em>
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
                        {unit.hp}/{unit.hpMax}
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
          data-mode={drawerMode}
          data-viewer={viewer}
        >
          <div className="sv-drawer-identity">
            <div className="sv-drawer-kicker">
              {drawerMode === "sheet" ? "FICHA DE UNIDAD" : "DECLARACIÓN"}
            </div>
            <h2 title={activeUnit?.name ?? "Sin unidad"}>
              {activeUnit?.name ?? "Sin unidad"}
            </h2>
            <p className="sv-drawer-sub">
              {drawerMode === "sheet"
                ? (activeUnit?.role ?? "Sin unidad seleccionada")
                : selectedSlot && activeUnit && selectedSlot.unitId === activeUnit.id
                  ? `SKILLSLOT ${selectedSlot.slot} / ${activeUnit.slots}`
                  : "Selecciona un SkillSlot sobre un sprite"}
            </p>

            <div className="sv-drawer-tabs" role="tablist" aria-label="Contenido del panel">
              <button
                type="button"
                role="tab"
                className="sv-drawer-tab"
                aria-selected={drawerMode === "sheet"}
                data-active={drawerMode === "sheet" ? "true" : undefined}
                disabled={!activeUnit}
                onClick={() => openDrawerMode("sheet")}
              >
                Ficha
              </button>
              <button
                type="button"
                role="tab"
                className="sv-drawer-tab"
                aria-selected={drawerMode === "skills"}
                data-active={drawerMode === "skills" ? "true" : undefined}
                disabled={!activeUnit}
                onClick={() => openDrawerMode("skills")}
              >
                Skills <em>{availableSkills.length}</em>
              </button>
            </div>

            {selectedSkill ? (
              <div className="sv-targeting-box">
                <div className="sv-targeting-title">
                  <Icon name="crosshair" size={14} /> Elige un objetivo
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
            ) : drawerMode === "sheet" ? (
              <p className="sv-drawer-hint">
                {activeUnit
                  ? `Click en un SkillSlot de ${activeUnit.name} para declarar. Click en otro sprite cambia la ficha.`
                  : "Elige una unidad en el escenario para ver su ficha."}
              </p>
            ) : (
              <p className="sv-drawer-hint">
                Pulsa un slot, elige una skill y luego un objetivo iluminado.
                Las líneas se dibujan solas.
              </p>
            )}
            <div className="sv-drawer-actions">
              <button type="button" className="sv-text-btn" onClick={clearLines}>
                Vaciar líneas
              </button>
              <button type="button" className="sv-text-btn" onClick={resetDemo}>
                Reiniciar demo
              </button>
            </div>
          </div>

          {drawerMode === "sheet" ? (
            activeUnit ? (
              <SheetPanel
                unit={activeUnit}
                viewer={viewer}
                activeSlot={
                  selectedSlot && selectedSlot.unitId === activeUnit.id
                    ? selectedSlot.slot
                    : undefined
                }
                onSlotSelect={focusSlotFromSheet}
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
                  {activeUnit?.side === "party" ? "PARTY" : "HOSTILES"}
                </span>
                <span className="sv-skill-page">
                  {page + 1}/{totalPages}
                </span>
              </div>
              {activeUnit ? (
                <>
                  <div className="sv-skill-cards">
                    {visibleSkills.map((skill) => (
                      <button
                        key={skillKey(skill)}
                        type="button"
                        className={`sv-skill-card sv-skill-card--${skill.accent}`}
                        data-selected={
                          selectedSkill?.id === skill.id ? "true" : undefined
                        }
                        onClick={() => pickSkill(skill)}
                      >
                        <span className="sv-skill-icon">
                          <svg viewBox="0 0 100 100" aria-hidden>
                            <polygon points="50,3 97,38 79,97 21,97 3,38" />
                          </svg>
                          <b>{skill.glyph}</b>
                        </span>
                        <span className="sv-skill-body">
                          <span className="sv-skill-name">{skill.name}</span>
                          <span className="sv-skill-kind">
                            {skill.kind === "support" ? "APOYO" : "ATAQUE"}
                          </span>
                          {skill.kind === "attack" ? (
                            <span className="sv-skill-stats">
                              <span>
                                <Icon name="shield" size={11} /> {skill.baseClash}
                                <em> +{skill.coinClash}/c</em>
                              </span>
                              <span>
                                <Icon name="sword" size={11} /> {skill.baseDamage}
                                <em> +{skill.coinDamage}/c</em>
                              </span>
                            </span>
                          ) : (
                            <span className="sv-skill-support">
                              {skill.support}
                            </span>
                          )}
                        </span>
                        <span className="sv-skill-coins">
                          <span className="sv-coin-mini" />
                          <b>{skill.coins}</b>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="sv-skill-foot">
                    <button
                      type="button"
                      className="sv-pager-btn"
                      onClick={() =>
                        setPage((current) => Math.max(0, current - 1))
                      }
                      disabled={page === 0}
                      aria-label="Skills anteriores"
                    >
                      <Icon name="chevron-up" size={14} />
                    </button>
                    <span className="sv-skill-foot-note">
                      {availableSkills.length} skills ·{" "}
                      {activeUnit.name} · 3 por página
                    </span>
                    <button
                      type="button"
                      className="sv-pager-btn"
                      onClick={() =>
                        setPage((current) =>
                          Math.min(totalPages - 1, current + 1),
                        )
                      }
                      disabled={page >= totalPages - 1}
                      aria-label="Skills siguientes"
                    >
                      <Icon name="chevron-down" size={14} />
                    </button>
                  </div>
                </>
              ) : (
                <p className="sv-drawer-hint">
                  Selecciona un SkillSlot junto a un sprite para ver sus skills.
                </p>
              )}
            </div>
          )}

          <div className="sv-drawer-aside">
            <div className="sv-drawer-kicker">LECTURA RÁPIDA</div>
            <div className="sv-stat-line">
              <span>HP</span>
              <b>
                {activeUnit ? hpReadout(activeUnit, viewer) : "—"}
              </b>
            </div>
            <div className="sv-stat-line">
              <span>Velocidad</span>
              <b>
                {activeUnit ? totalSpeed(activeUnit) : "—"}
                {activeUnit ? (
                  <em>
                    {" "}
                    ({activeUnit.spdBase} +{activeUnit.spdRoll})
                  </em>
                ) : null}
              </b>
            </div>
            <div className="sv-stat-line">
              <span>DEF</span>
              <b>{activeUnit?.def ?? "—"}</b>
            </div>
            <div className="sv-stat-line">
              <span>SkillSlots</span>
              <b>{activeUnit?.slots ?? "—"}</b>
            </div>
            <p className="sv-aside-note">
              {viewer === "dm"
                ? "Click en un sprite abre su ficha. Click en un slot declara. Los hostiles se inspeccionan siempre."
                : "Vista jugador: solo tu personaje y tus aliados. El HP de los hostiles se muestra estimado."}
            </p>
          </div>
        </section>
      </main>

      <footer className="sv-footer">
        <span>PROTOTIPO VISUAL · DATOS DE EJEMPLO</span>
        <span>
          {viewer === "dm" ? "VISTA DM · HP EXACTO" : "VISTA JUGADOR · HP ESTIMADO"}
        </span>
        <span>ESC · cancela selección</span>
        <span>El estado real del combate no se toca en esta ruta</span>
      </footer>

      {showClash ? (
        <ClashDemo
          key={clashRun}
          viewer={viewer}
          onClose={() => setShowClash(false)}
          onReplay={() => setClashRun((run) => run + 1)}
        />
      ) : null}
    </div>
  );
}

function UnitColumn({
  unit,
  viewer,
  selected,
  inspected,
  inspectable,
  activeSlot,
  targetable,
  onSlotClick,
  onInspect,
  sourceTone,
  targetTone,
  sourceGlyph,
  stageSlotRefs,
}: {
  unit: DemoUnit;
  viewer: Viewer;
  selected: boolean;
  inspected: boolean;
  inspectable: boolean;
  activeSlot?: number;
  targetable: boolean;
  onSlotClick: (unit: DemoUnit, slot: number) => void;
  onInspect: (unit: DemoUnit) => void;
  sourceTone: Map<string, LineTone>;
  targetTone: Map<string, LineTone>;
  sourceGlyph: Map<string, string>;
  stageSlotRefs: Map<string, HTMLButtonElement>;
}) {
  return (
    <div
      className={`sv-unit sv-unit--${unit.side}`}
      data-selected={selected ? "true" : undefined}
      data-inspected={inspected ? "true" : undefined}
      data-inspectable={inspectable ? "true" : "false"}
      data-targetable={targetable ? "true" : undefined}
    >
      <div className="sv-slots">
        {Array.from({ length: unit.slots }, (_, index) => {
          const slot = index + 1;
          const key = `${unit.id}:${slot}`;
          const tone = sourceTone.get(key);
          const incoming = targetTone.get(key);
          const glyph = sourceGlyph.get(key) ?? String(slot);
          return (
            <SlotButton
              key={key}
              unit={unit}
              slot={slot}
              tone={tone}
              incoming={incoming}
              glyph={glyph}
              active={activeSlot === slot}
              targetable={targetable}
              onClick={() => onSlotClick(unit, slot)}
              registerRef={(element) => {
                if (element) stageSlotRefs.set(key, element);
                else stageSlotRefs.delete(key);
              }}
            />
          );
        })}
      </div>

      <div
        className="sv-unit-sprite-wrap"
        role="button"
        tabIndex={0}
        data-inspectable={inspectable ? "true" : "false"}
        aria-label={
          inspectable
            ? `Inspeccionar ${unit.name}`
            : `${unit.name}, hostil no inspeccionable`
        }
        title={
          inspectable
            ? `Ver ficha de ${unit.name}`
            : "Los hostiles no se pueden inspeccionar"
        }
        onClick={() => onInspect(unit)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onInspect(unit);
          }
        }}
      >
        <span className="sv-unit-role">{unit.role}</span>
        <span className="sv-inspect-chip" aria-hidden>
          {inspectable ? "FICHA" : "SIN FICHA"}
        </span>
        <img
          className="sv-unit-sprite"
          src={unit.sprite}
          alt={unit.name}
          draggable={false}
        />
        <span className="sv-speed-badge">
          SPD <b>{totalSpeed(unit)}</b>
          <em>+{unit.spdRoll}</em>
        </span>
      </div>

      <div className="sv-unit-foot">
        <span className="sv-unit-name" title={unit.name}>
          {unit.name}
        </span>
        <span
          className="sv-unit-state"
          data-masked={exactHpFor(unit, viewer) ? undefined : "true"}
        >
          {hpFootLabel(unit, viewer)}
        </span>
      </div>
      <div className="sv-hpbar sv-hpbar--unit">
        <span style={{ width: `${hpPercent(unit)}%` }} />
      </div>
    </div>
  );
}

function SlotButton({
  unit,
  slot,
  tone,
  incoming,
  glyph,
  active,
  targetable,
  onClick,
  registerRef,
}: {
  unit: DemoUnit;
  slot: number;
  tone?: LineTone;
  incoming?: LineTone;
  glyph: string;
  active: boolean;
  targetable: boolean;
  onClick: () => void;
  registerRef: (element: HTMLButtonElement | null) => void;
}) {
  const toneColor = tone ? TONE_COLOR[tone] : undefined;
  const incomingColor = incoming ? TONE_COLOR[incoming] : undefined;
  return (
    <button
      ref={registerRef}
      type="button"
      className="sv-slot"
      data-tone={tone}
      data-incoming={incoming}
      data-active={active ? "true" : undefined}
      data-targetable={targetable ? "true" : undefined}
      onClick={onClick}
      aria-label={`SkillSlot ${slot} de ${unit.name}`}
      style={
        {
          "--slot-tone": toneColor ?? "rgba(242,237,224,.32)",
          "--incoming-tone": incomingColor ?? "transparent",
        } as CSSProperties
      }
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
  activeSlot,
  onSlotSelect,
}: {
  unit: DemoUnit;
  viewer: Viewer;
  activeSlot?: number;
  onSlotSelect: (unit: DemoUnit, slot: number) => void;
}) {
  const exact = exactHpFor(unit, viewer);
  return (
    <div className="sv-sheet" data-side={unit.side}>
      <div className="sv-sheet-top">
        <span className={`sv-sheet-side sv-sheet-side--${unit.side}`}>
          {unit.side === "party" ? "PARTY" : "HOSTIL"}
        </span>
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
            {hpPercent(unit)}% · máx {unit.hpMax}
          </em>
        </div>
        <div className="sv-hpbar sv-hpbar--sheet">
          <span style={{ width: `${hpPercent(unit)}%` }} />
        </div>
      </div>

      <div className="sv-sheet-stats">
        <article className="sv-sheet-stat">
          <span>DEF</span>
          <b>{unit.def}</b>
          <em>Mitigación</em>
        </article>
        <article className="sv-sheet-stat">
          <span>ATK</span>
          <b>{unit.atk}</b>
          <em>Potencia</em>
        </article>
        <article className="sv-sheet-stat">
          <span>SPD</span>
          <b>{totalSpeed(unit)}</b>
          <em>
            {unit.spdBase} base +{unit.spdRoll} roll
          </em>
        </article>
        <article className="sv-sheet-stat">
          <span>LUCK</span>
          <b>{unit.luck}</b>
          <em>Azar</em>
        </article>
      </div>

      <div className="sv-sheet-slots">
        <div className="sv-sheet-slots-head">
          <span>SKILLSLOTS</span>
          <b>{unit.slots} disponibles</b>
        </div>
        <div className="sv-sheet-slots-row">
          {Array.from({ length: unit.slots }, (_, index) => {
            const slot = index + 1;
            return (
              <button
                key={slot}
                type="button"
                className="sv-sheet-slot"
                data-active={activeSlot === slot ? "true" : undefined}
                onClick={() => onSlotSelect(unit, slot)}
                aria-label={`Declarar con el SkillSlot ${slot} de ${unit.name}`}
              >
                <svg viewBox="0 0 100 100" aria-hidden>
                  <polygon points="50,3 97,38 79,97 21,97 3,38" />
                </svg>
                <b>{slot}</b>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const CLASH_DEMO = {
  left: {
    unit: "Protocol Echo",
    skill: "Echo Lance",
    side: "enemy" as const,
    rolls: [true, true, false],
    clash: 22,
    damage: 0,
    hp: 62,
    hpMax: 90,
  },
  right: {
    unit: "Arzu",
    skill: "Odachi",
    side: "party" as const,
    rolls: [true, true, true],
    clash: 27,
    damage: 21,
    hp: 42,
    hpMax: 50,
  },
};

function clashHpLabel(
  side: typeof CLASH_DEMO.left | typeof CLASH_DEMO.right,
  viewer: Viewer,
): string {
  if (viewer === "dm" || side.side === "party") {
    return `${side.hp}/${side.hpMax}`;
  }
  return `≈${Math.round((side.hp / side.hpMax) * 100)}%`;
}

function ClashDemo({
  viewer,
  onClose,
  onReplay,
}: {
  viewer: Viewer;
  onClose: () => void;
  onReplay: () => void;
}) {
  const winner: "left" | "right" =
    CLASH_DEMO.right.clash > CLASH_DEMO.left.clash ? "right" : "left";
  return (
    <div className="sv-clash-backdrop" role="dialog" aria-modal="true" aria-label="Demo de clash">
      <div className="sv-clash-card">
        <header className="sv-clash-head">
          <div>
            <div className="sv-drawer-kicker">RESOLUCIÓN · RONDA 01</div>
            <h2>Clash</h2>
          </div>
          <div className="sv-clash-head-actions">
            <button type="button" className="sv-ghost-btn" onClick={onReplay}>
              <Icon name="spark" size={13} /> Repetir
            </button>
            <button type="button" className="sv-ghost-btn" onClick={onClose}>
              <Icon name="close" size={13} /> Cerrar
            </button>
          </div>
        </header>

        <div className="sv-clash-arena">
          <ClashSide side={CLASH_DEMO.left} winner={winner === "left"} />
          <div className="sv-clash-center">
            <span>VS</span>
            <small>3 MONEDAS</small>
          </div>
          <ClashSide side={CLASH_DEMO.right} winner={winner === "right"} />
        </div>

        <div className="sv-clash-result">
          <div className="sv-clash-result-line">
            <span className="sv-clash-winner">ARZU GANA EL CLASH</span>
            <span className="sv-clash-damage">-21</span>
          </div>
          <div className="sv-clash-result-bar">
            <span style={{ width: "64%" }} />
          </div>
          <div className="sv-clash-result-meta">
            <span>Protocol Echo · {clashHpLabel(CLASH_DEMO.left, viewer)} HP</span>
            <span>El número perdedor se tacha y el daño aparece en rojo.</span>
            <span>Arzu · {clashHpLabel(CLASH_DEMO.right, viewer)} HP</span>
          </div>
        </div>

        <footer className="sv-clash-foot">
          Cada clash se resuelve de uno en uno: giran las monedas, cae el
          resultado, se muestra el total y el perdedor recibe el daño.
        </footer>
      </div>
    </div>
  );
}

function ClashSide({
  side,
  winner,
}: {
  side: typeof CLASH_DEMO.left | typeof CLASH_DEMO.right;
  winner: boolean;
}) {
  return (
    <div className={`sv-clash-side sv-clash-side--${side.side}`} data-winner={winner ? "true" : undefined}>
      <div className="sv-clash-side-head">
        <span>{side.unit}</span>
        <b>{side.skill}</b>
      </div>
      <div className="sv-clash-coins">
        {side.rolls.map((heads, index) => (
          <span
            key={index}
            className={`sv-clash-coin ${heads ? "is-head" : "is-tail"}`}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            {heads ? "C" : "X"}
          </span>
        ))}
      </div>
      <div className={`sv-clash-total ${winner ? "is-winner" : "is-loser"}`}>
        {side.clash}
      </div>
      <div className="sv-clash-side-foot">
        <span>{side.rolls.filter(Boolean).length} caras</span>
        {side.damage > 0 ? <b>+{side.damage} daño</b> : <span>Sin daño</span>}
      </div>
    </div>
  );
}
