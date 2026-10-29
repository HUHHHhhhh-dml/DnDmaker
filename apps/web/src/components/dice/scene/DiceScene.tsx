import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import {
  DIE_SCALE,
  d100TensLabel,
  d100UnitsLabel,
  getDieDefinition,
  restHeight,
  type BuiltDieSides,
  type DiceRoll,
  type DiceSides,
  type DiceTrajectory,
  type DieDefinition,
  type DieFace,
} from "@protocol-life/shared";
import { sampleTrajectory } from "../../../lib/dice3d/trajectory";
import {
  buildDieEdgeGeometry,
  buildDieGeometry,
  createDieAtlas,
  createResultLabelTexture,
  type DieLabelMode,
} from "../../../lib/dice3d/dieAtlas";
import { rollTrajectories } from "../../../lib/dice3d/roll";
import {
  scheduleDiceRollSound,
  stopDiceSounds,
} from "../../../lib/diceSound";
import {
  DICE_SKINS,
  DEFAULT_DICE_SKIN,
  type DiceSkin,
  type DiceSkinId,
} from "../../../lib/diceSkin";
import {
  TABLE_CAMERA_POS,
  TABLE_CAMERA_TARGET,
} from "../../../lib/dice3d/geometry";

/**
 * Escena 3D de una tirada de dados. Es el único módulo que importa `three` y
 * `@react-three/fiber`; `DiceCinematic` lo carga con `import()` en la primera
 * tirada. Las trayectorias vienen simuladas por el servidor: aquí solo se
 * reproducen los frames.
 *
 * Un solo cuerpo: primer plano de la cara (o del vértice, en d4). Varios
 * cuerpos (multi-dado o pareja de d100): vista de grupo y una etiqueta por
 * cuerpo. La pareja de d100 añade una etiqueta con el número combinado.
 */

export interface DiceSceneProps {
  roll: DiceRoll;
  /** Saltar: salta al último frame, sin cortar el resultado. */
  skipped: boolean;
  /** Skin del dado (hueso por defecto). */
  skin?: DiceSkinId;
  onLanded: () => void;
  onError: () => void;
}

function renderSides(sides: DiceSides): BuiltDieSides {
  return (sides === 100 ? 10 : sides) as BuiltDieSides;
}

function definitionFor(roll: DiceRoll): DieDefinition {
  return getDieDefinition(renderSides(roll.sides));
}

function labelModeFor(sides: DiceSides, index: number): DieLabelMode {
  if (sides === 100) {
    return index % 2 === 0 ? "d100-tens" : "d100-units";
  }
  return "face";
}

function labelTextFor(
  sides: DiceSides,
  trajectory: DiceTrajectory,
  index: number,
): string {
  if (sides === 100) {
    return index % 2 === 0
      ? d100TensLabel(trajectory.face)
      : d100UnitsLabel(trajectory.face);
  }
  return String(trajectory.face);
}

export default function DiceScene({
  roll,
  skipped,
  skin = DEFAULT_DICE_SKIN,
  onLanded,
  onError,
}: DiceSceneProps) {
  const errorRef = useRef(onError);
  const activeRef = useRef(true);
  const trajectories = useMemo(() => rollTrajectories(roll), [roll]);
  const definition = useMemo(() => definitionFor(roll), [roll]);

  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (trajectories.length === 0) errorRef.current();
  }, [trajectories]);

  useEffect(() => {
    if (trajectories.length === 0) return;
    scheduleDiceRollSound(roll.id, trajectories, roll.sides, roll.count);
    return () => stopDiceSounds(roll.id);
  }, [roll.count, roll.id, roll.sides, trajectories]);

  useEffect(() => {
    if (skipped) stopDiceSounds(roll.id);
  }, [skipped, roll.id]);

  if (
    trajectories.length === 0 ||
    trajectories.some((trajectory) => trajectory.frames.length < 2)
  ) {
    return null;
  }

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 36, position: TABLE_CAMERA_POS.toArray(), near: 0.1, far: 30 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      onCreated={({ gl, camera }) => {
        camera.lookAt(TABLE_CAMERA_TARGET);
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
        gl.domElement.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          // Al desmontar el canvas el contexto se pierde a propósito; eso no
          // es un fallo de render y no debe tumbar el 3D de la sesión.
          if (activeRef.current) errorRef.current();
        });
      }}
    >
      <DiceArena
        roll={roll}
        definition={definition}
        trajectories={trajectories}
        skipped={skipped}
        skin={skin}
        onLanded={onLanded}
      />
    </Canvas>
  );
}

const CLOSEUP_MS = 800;
const CAMERA_CLOSEUP_DISTANCE = 1.8;
const CAMERA_CLOSEUP_TILT = (12 * Math.PI) / 180;
const CAMERA_WORLD_UP = new Vector3(0, 1, 0);

function cameraSmoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------------- */
/* Recursos compartidos por todos los cuerpos                                 */
/* ------------------------------------------------------------------------- */

interface DieResource {
  atlas: CanvasTexture;
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
}

interface SharedResources {
  edgeGeometry: BufferGeometry;
  shadowTexture: CanvasTexture;
  poolTexture: CanvasTexture;
  byMode: Map<DieLabelMode, DieResource>;
}

function useDiceResources(
  definition: DieDefinition,
  modes: readonly DieLabelMode[],
  skin: DiceSkin,
): SharedResources {
  const modeKey = modes.join(",");
  const edgeGeometry = useMemo(
    () => buildDieEdgeGeometry(definition),
    [definition],
  );
  const shadowTexture = useMemo(createShadowTexture, []);
  const poolTexture = useMemo(createContactPoolTexture, []);

  const byMode = useMemo(() => {
    const map = new Map<DieLabelMode, DieResource>();
    for (const mode of modeKey.split(",") as DieLabelMode[]) {
      const atlas = createDieAtlas(definition, skin, mode);
      const geometry = buildDieGeometry(definition, atlas.uvs);
      const material = new MeshStandardMaterial({
        map: atlas.texture,
        color: skin.materialColor,
        roughness: skin.roughness,
        metalness: skin.metalness,
        emissive: new Color(skin.emissiveColor),
        emissiveIntensity: 0,
      });
      map.set(mode, { atlas: atlas.texture, geometry, material });
    }
    return map;
  }, [definition, skin, modeKey]);

  useEffect(
    () => () => {
      for (const resource of byMode.values()) {
        resource.atlas.dispose();
        resource.geometry.dispose();
        resource.material.dispose();
      }
      edgeGeometry.dispose();
      shadowTexture.dispose();
      poolTexture.dispose();
    },
    [byMode, edgeGeometry, shadowTexture, poolTexture],
  );

  return { edgeGeometry, shadowTexture, poolTexture, byMode };
}

/* ------------------------------------------------------------------------- */
/* Arena: reloj compartido, cámara y cuerpos                                  */
/* ------------------------------------------------------------------------- */

function DiceArena({
  roll,
  definition,
  trajectories,
  skipped,
  skin,
  onLanded,
}: {
  roll: DiceRoll;
  definition: DieDefinition;
  trajectories: DiceTrajectory[];
  skipped: boolean;
  skin: DiceSkinId;
  onLanded: () => void;
}) {
  const durationMs = useMemo(
    () => Math.max(...trajectories.map((trajectory) => trajectory.durationMs)),
    [trajectories],
  );
  const elapsed = useRef(0);
  const skippedRef = useRef(skipped);
  const landedRef = useRef(false);
  const landedCallback = useRef(onLanded);
  const [landed, setLanded] = useState(false);
  const config = DICE_SKINS[skin] ?? DICE_SKINS[DEFAULT_DICE_SKIN];
  const modes = useMemo(
    () => trajectories.map((_, index) => labelModeFor(roll.sides, index)),
    [roll.sides, trajectories],
  );
  const shared = useDiceResources(definition, modes, config);
  const restY = restHeight(definition, DIE_SCALE);
  const showLabels =
    landed &&
    (trajectories.length > 1 || definition.resultMode === "top-vertex");

  useEffect(() => {
    skippedRef.current = skipped;
  }, [skipped]);

  useEffect(() => {
    landedCallback.current = onLanded;
  }, [onLanded]);

  useFrame((_, delta) => {
    if (skippedRef.current) {
      elapsed.current = durationMs + CLOSEUP_MS;
    } else {
      // Un salto de pestaña no debe teletransportar el dado: como mucho
      // avanzamos 50 ms por frame.
      elapsed.current = Math.min(
        elapsed.current + Math.min(delta, 0.05) * 1000,
        durationMs + CLOSEUP_MS,
      );
    }

    if (!landedRef.current && elapsed.current >= durationMs) {
      landedRef.current = true;
      setLanded(true);
      landedCallback.current();
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <hemisphereLight intensity={1} color="#f4ead2" groundColor="#221b12" />
      <directionalLight position={[3.5, 5.5, 4.5]} intensity={2.6} />
      <directionalLight
        position={[-4, -1.5, -2.5]}
        intensity={1.15}
        color="#d4a72c"
      />

      {trajectories.map((trajectory, index) => {
        const mode = labelModeFor(roll.sides, index);
        const resource = shared.byMode.get(mode);
        if (!resource) return null;
        return (
          <Die
            key={index}
            trajectory={trajectory}
            elapsed={elapsed}
            skin={config}
            resource={resource}
            edgeGeometry={shared.edgeGeometry}
            shadowTexture={shared.shadowTexture}
            poolTexture={shared.poolTexture}
            restY={restY}
          />
        );
      })}

      {showLabels ? (
        <ResultLabels
          roll={roll}
          definition={definition}
          trajectories={trajectories}
          skin={config}
        />
      ) : null}

      <CameraRig
        definition={definition}
        trajectories={trajectories}
        durationMs={durationMs}
        elapsed={elapsed}
      />
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Cámara                                                                     */
/* ------------------------------------------------------------------------- */

function CameraRig({
  definition,
  trajectories,
  durationMs,
  elapsed,
}: {
  definition: DieDefinition;
  trajectories: DiceTrajectory[];
  durationMs: number;
  elapsed: { current: number };
}) {
  const camera = useThree((state) => state.camera);

  const view = useMemo(() => {
    if (trajectories.length === 1) {
      return definition.resultMode === "top-vertex"
        ? vertexCloseup(trajectories[0]!)
        : faceCloseup(definition, trajectories[0]!);
    }
    return groupView(trajectories);
  }, [definition, trajectories]);

  useFrame(() => {
    if (elapsed.current <= durationMs) {
      camera.position.copy(TABLE_CAMERA_POS);
      camera.up.copy(CAMERA_WORLD_UP);
      camera.lookAt(TABLE_CAMERA_TARGET);
      return;
    }

    const u = cameraSmoothstep((elapsed.current - durationMs) / CLOSEUP_MS);
    camera.position.lerpVectors(TABLE_CAMERA_POS, view.position, u);
    const target = new Vector3().lerpVectors(
      TABLE_CAMERA_TARGET,
      view.target,
      u,
    );
    camera.up
      .copy(CAMERA_WORLD_UP)
      .lerp(view.up, u)
      .normalize();
    camera.lookAt(target);
  });

  return null;
}

interface CameraView {
  position: Vector3;
  target: Vector3;
  up: Vector3;
}

function finalFrame(trajectory: DiceTrajectory) {
  return trajectory.frames[trajectory.frames.length - 1]!;
}

/**
 * Primer plano de una cara: la cámara se pone delante de la cara del resultado,
 * con el "arriba" de la etiqueta como arriba de la pantalla.
 */
function faceCloseup(
  definition: DieDefinition,
  trajectory: DiceTrajectory,
): CameraView {
  const last = finalFrame(trajectory);
  const finalQuaternion = new Quaternion(
    last.q[0],
    last.q[1],
    last.q[2],
    last.q[3],
  );
  const face: DieFace | undefined = definition.faces.find(
    (candidate) => candidate.number === trajectory.face,
  );
  const center = new Vector3(last.p[0], last.p[1], last.p[2]);
  if (!face) {
    return {
      position: center.clone().add(new Vector3(0, 1.6, 1.2)),
      target: center,
      up: CAMERA_WORLD_UP.clone(),
    };
  }

  const normal = new Vector3(...face.normal)
    .applyQuaternion(finalQuaternion)
    .normalize();
  const labelUp = new Vector3(...face.labelUp)
    .applyQuaternion(finalQuaternion)
    .normalize();
  const labelRight = new Vector3(...face.labelRight)
    .applyQuaternion(finalQuaternion)
    .normalize();
  const faceCenter = center
    .clone()
    .addScaledVector(normal, definition.inradius * DIE_SCALE);
  const position = faceCenter
    .clone()
    .addScaledVector(
      normal,
      CAMERA_CLOSEUP_DISTANCE * Math.cos(CAMERA_CLOSEUP_TILT),
    )
    .addScaledVector(
      labelRight,
      CAMERA_CLOSEUP_DISTANCE * Math.sin(CAMERA_CLOSEUP_TILT),
    );
  return { position, target: faceCenter, up: labelUp };
}

/**
 * Primer plano de un d4: se encuadra el vértice superior, que es el resultado.
 * Los tres números de ese vértice se ven en las caras que lo rodean.
 */
function vertexCloseup(trajectory: DiceTrajectory): CameraView {
  const last = finalFrame(trajectory);
  const center = new Vector3(last.p[0], last.p[1], last.p[2]);
  // Vista casi cenital: el vértice superior del tetraedro queda en el centro y
  // los tres números que lo rodean se leen a la vez.
  return {
    position: center.clone().add(new Vector3(0, 1.85, 0.7)),
    target: center.clone().add(new Vector3(0, 0.06, 0)),
    up: CAMERA_WORLD_UP.clone(),
  };
}

/**
 * Vista de grupo: encuadra todos los cuerpos en su pose final, desde arriba y
 * en ángulo de mesa, sin acercarse tanto como para dejar fuera los del borde.
 */
function groupView(trajectories: DiceTrajectory[]): CameraView {
  const finals = trajectories.map((trajectory) => {
    const last = finalFrame(trajectory);
    return new Vector3(last.p[0], last.p[1], last.p[2]);
  });

  const bounds = finals.reduce(
    (box, final) => {
      box.min.x = Math.min(box.min.x, final.x);
      box.min.y = Math.min(box.min.y, final.y);
      box.min.z = Math.min(box.min.z, final.z);
      box.max.x = Math.max(box.max.x, final.x);
      box.max.y = Math.max(box.max.y, final.y);
      box.max.z = Math.max(box.max.z, final.z);
      return box;
    },
    {
      min: new Vector3(Infinity, Infinity, Infinity),
      max: new Vector3(-Infinity, -Infinity, -Infinity),
    },
  );
  const center = new Vector3()
    .addVectors(bounds.min, bounds.max)
    .multiplyScalar(0.5);

  const halfWidth = (bounds.max.x - bounds.min.x) / 2;
  const halfDepth = (bounds.max.z - bounds.min.z) / 2;
  const spread = Math.max(halfWidth, halfDepth);
  const distance = Math.min(5.2, Math.max(3, 2.7 + spread * 1.9));
  const position = center
    .clone()
    .add(new Vector3(0, distance * 0.95, distance * 0.72));
  return {
    position,
    target: center.clone().add(new Vector3(0, 0.12, 0)),
    up: CAMERA_WORLD_UP.clone(),
  };
}

/* ------------------------------------------------------------------------- */
/* Un cuerpo                                                                  */
/* ------------------------------------------------------------------------- */

function Die({
  trajectory,
  elapsed,
  skin,
  resource,
  edgeGeometry,
  shadowTexture,
  poolTexture,
  restY,
}: {
  trajectory: DiceTrajectory;
  elapsed: { current: number };
  skin: DiceSkin;
  resource: DieResource;
  edgeGeometry: BufferGeometry;
  shadowTexture: CanvasTexture;
  poolTexture: CanvasTexture;
  restY: number;
}) {
  const group = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const shadowMaterial = useRef<MeshBasicMaterial>(null);
  const pool = useRef<Mesh>(null);
  const poolMaterial = useRef<MeshBasicMaterial>(null);
  const ring = useRef<Mesh>(null);
  const ringMaterial = useRef<MeshBasicMaterial>(null);

  const material = useMemo(() => {
    const clone = resource.material.clone();
    clone.emissiveIntensity = 0;
    return clone;
  }, [resource.material]);

  useEffect(() => () => material.dispose(), [material]);
  const lineMaterial = useMemo(
    () =>
      new LineBasicMaterial({
        color: skin.edgeColor,
        transparent: true,
        opacity: skin.edgeOpacity,
      }),
    [skin],
  );
  const floorMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      }),
    [shadowTexture],
  );
  const contactMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        map: poolTexture,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0.2,
      }),
    [poolTexture],
  );
  const impactMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: skin.edgeColor,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        opacity: 0,
      }),
    [skin.edgeColor],
  );

  useEffect(
    () => () => {
      lineMaterial.dispose();
      floorMaterial.dispose();
      contactMaterial.dispose();
      impactMaterial.dispose();
    },
    [lineMaterial, floorMaterial, contactMaterial, impactMaterial],
  );

  useFrame((state) => {
    const finished = elapsed.current >= trajectory.durationMs;
    const pose = sampleTrajectory(
      Math.min(elapsed.current, trajectory.durationMs),
      trajectory,
      restY,
    );
    const current = group.current;
    if (current) {
      current.position.copy(pose.position);
      current.quaternion.copy(pose.quaternion);
    }

    material.emissiveIntensity = finished
      ? skin.emissiveBoost +
        Math.sin(state.clock.elapsedTime * 5) * skin.emissiveBoost * 0.16
      : pose.glow * skin.emissiveBoost;
    if (pool.current) {
      pool.current.position.set(pose.position.x, 0.001, pose.position.z);
    }
    if (poolMaterial.current) poolMaterial.current.opacity = pose.contactGlow;
    if (shadow.current) {
      shadow.current.position.set(pose.position.x, 0.002, pose.position.z);
      shadow.current.scale.setScalar(pose.shadowScale);
    }
    if (shadowMaterial.current) shadowMaterial.current.opacity = pose.shadowOpacity;
    if (ring.current) {
      ring.current.position.set(pose.position.x, 0.004, pose.position.z);
      ring.current.scale.setScalar(pose.ringScale);
    }
    if (ringMaterial.current) ringMaterial.current.opacity = pose.ringOpacity;
  });

  return (
    <>
      <group ref={group} scale={DIE_SCALE}>
        <mesh geometry={resource.geometry} material={material} />
        <lineSegments geometry={edgeGeometry} material={lineMaterial} />
      </group>

      <mesh
        ref={pool}
        position={[0, 0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={contactMaterial}
        renderOrder={-2}
      >
        <planeGeometry args={[1.2, 1.2]} />
      </mesh>

      <mesh
        ref={shadow}
        position={[0, 0.002, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={floorMaterial}
        renderOrder={-1}
      >
        <planeGeometry args={[0.76, 0.76]} />
      </mesh>

      <mesh
        ref={ring}
        position={[0, 0.004, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={impactMaterial}
        renderOrder={1}
      >
        <ringGeometry args={[0.28, 0.32, 64]} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Etiquetas de resultado para varios cuerpos                                 */
/* ------------------------------------------------------------------------- */

function ResultLabels({
  roll,
  definition,
  trajectories,
  skin,
}: {
  roll: DiceRoll;
  definition: DieDefinition;
  trajectories: DiceTrajectory[];
  skin: DiceSkin;
}) {
  const labels = useMemo(() => {
    const map = new Map<string, CanvasTexture>();
    const ensure = (text: string): CanvasTexture => {
      const existing = map.get(text);
      if (existing) return existing;
      const texture = createResultLabelTexture(text, skin);
      map.set(text, texture);
      return texture;
    };

    // En d100 los números de cada d10 ya están en sus caras; las etiquetas
    // flotantes se reservan para el resultado combinado de cada pareja. En un
    // d4 único se coloca una etiqueta pequeña sobre el vértice superior.
    const vertexBadge =
      definition.resultMode === "top-vertex" && trajectories.length === 1;
    const entries =
      roll.sides === 100 || vertexBadge
        ? []
        : trajectories.map((trajectory, index) => {
            const text = labelTextFor(roll.sides, trajectory, index);
            ensure(text);
            return { text, trajectory, index };
          });

    const combined: Array<{ text: string; position: Vector3 }> = [];
    if (roll.sides === 100) {
      for (let index = 0; index < roll.count; index += 1) {
        const tens = trajectories[index * 2];
        const units = trajectories[index * 2 + 1];
        if (!tens || !units) continue;
        const a = finalFrame(tens).p;
        const b = finalFrame(units).p;
        combined.push({
          text: String(roll.results[index] ?? roll.result),
          position: new Vector3(
            (a[0] + b[0]) / 2,
            (a[1] + b[1]) / 2 + 0.78,
            (a[2] + b[2]) / 2,
          ),
        });
      }
    }
    for (const entry of combined) ensure(entry.text);

    let vertexPosition: Vector3 | null = null;
    if (vertexBadge) {
      const last = finalFrame(trajectories[0]!);
      const quaternion = new Quaternion(
        last.q[0],
        last.q[1],
        last.q[2],
        last.q[3],
      );
      const center = new Vector3(last.p[0], last.p[1], last.p[2]);
      let top = center.clone();
      let best = -Infinity;
      for (const vertex of definition.vertices) {
        const world = new Vector3(...vertex)
          .applyQuaternion(quaternion)
          .multiplyScalar(DIE_SCALE)
          .add(center);
        if (world.y > best) {
          best = world.y;
          top = world;
        }
      }
      vertexPosition = top.add(new Vector3(0, 0.12, 0));
      ensure(String(roll.result));
    }

    return { entries, combined, vertexPosition, textures: map };
  }, [
    definition,
    roll.count,
    roll.result,
    roll.results,
    roll.sides,
    skin,
    trajectories,
  ]);

  useEffect(
    () => () => {
      for (const texture of labels.textures.values()) texture.dispose();
    },
    [labels],
  );

  return (
    <>
      {labels.entries.map(({ text, trajectory, index }) => {
        const last = finalFrame(trajectory);
        const texture = labels.textures.get(text);
        if (!texture) return null;
        return (
          <sprite
            key={index}
            position={[last.p[0], last.p[1] + 0.4, last.p[2]]}
            scale={[0.34, 0.17, 1]}
          >
            <spriteMaterial
              map={texture}
              transparent
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
        );
      })}

      {labels.vertexPosition ? (
        <sprite position={labels.vertexPosition} scale={[0.14, 0.07, 1]}>
          <spriteMaterial
            map={labels.textures.get(String(roll.result))}
            transparent
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ) : null}

      {labels.combined.map((entry, index) => (
        <sprite key={`combined-${index}`} position={entry.position} scale={[0.46, 0.23, 1]}>
          <spriteMaterial
            map={labels.textures.get(entry.text)}
            transparent
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Texturas de sombra y contacto                                              */
/* ------------------------------------------------------------------------- */

function createContactPoolTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear la luz de contacto");

  const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 126);
  gradient.addColorStop(0, "rgba(212, 167, 44, 0.95)");
  gradient.addColorStop(0.35, "rgba(212, 167, 44, 0.4)");
  gradient.addColorStop(0.7, "rgba(212, 167, 44, 0.12)");
  gradient.addColorStop(1, "rgba(212, 167, 44, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createShadowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear la sombra");

  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 63);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.82)");
  gradient.addColorStop(0.5, "rgba(0, 0, 0, 0.5)");
  gradient.addColorStop(0.8, "rgba(0, 0, 0, 0.16)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
