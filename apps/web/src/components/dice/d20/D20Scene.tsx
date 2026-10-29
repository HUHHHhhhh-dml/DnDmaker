import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { DiceRoll, DiceTrajectory } from "@protocol-life/shared";
import { sampleTrajectory } from "../../../lib/dice3d/trajectory";
import { createD20Atlas, faceUv } from "../../../lib/dice3d/atlas";
import { rollTrajectories } from "../../../lib/dice3d/roll";
import {
  DICE_SKINS,
  DEFAULT_DICE_SKIN,
  type DiceSkin,
  type DiceSkinId,
} from "../../../lib/diceSkin";
import {
  D20_EDGES,
  D20_FACES,
  DIE_INRADIUS,
  DIE_SCALE,
  TABLE_CAMERA_POS,
  TABLE_CAMERA_TARGET,
  faceForNumber,
} from "../../../lib/dice3d/geometry";

/**
 * Escena 3D de los dados. Este es el único módulo que importa `three` y
 * `@react-three/fiber`; `DiceCinematic` lo carga con `import()` en la primera
 * tirada. Las trayectorias vienen ya simuladas por el servidor: aquí solo se
 * reproducen los frames.
 *
 * Con un d20 la cámara se acerca a la cara del resultado. Con varios, se abre
 * a una vista de grupo y cada dado recibe una etiqueta flotante con su número,
 * porque no hay una sola cámara que mire de frente a cinco caras a la vez.
 */

export interface D20SceneProps {
  roll: DiceRoll;
  /** Saltar: salta al último frame, sin cortar el resultado. */
  skipped: boolean;
  /** Skin del dado (hueso por defecto). */
  skin?: DiceSkinId;
  onLanded: () => void;
  onError: () => void;
}

export default function D20Scene({
  roll,
  skipped,
  skin = DEFAULT_DICE_SKIN,
  onLanded,
  onError,
}: D20SceneProps) {
  const errorRef = useRef(onError);
  const activeRef = useRef(true);
  const trajectories = useMemo(() => rollTrajectories(roll), [roll]);

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
/* Recursos compartidos por todos los dados                                   */
/* ------------------------------------------------------------------------- */

interface SharedResources {
  geometry: BufferGeometry;
  edgeGeometry: BufferGeometry;
  atlas: CanvasTexture;
  shadowTexture: CanvasTexture;
  poolTexture: CanvasTexture;
}

function useSharedResources(skin: DiceSkin): SharedResources {
  const geometry = useMemo(buildDieGeometry, []);
  const edgeGeometry = useMemo(buildEdgeGeometry, []);
  const atlas = useMemo(
    () =>
      createD20Atlas(8, {
        background: skin.faceBackground,
        ink: skin.faceInk,
      }),
    [skin],
  );
  const shadowTexture = useMemo(createShadowTexture, []);
  const poolTexture = useMemo(createContactPoolTexture, []);

  useEffect(
    () => () => {
      geometry.dispose();
      edgeGeometry.dispose();
      shadowTexture.dispose();
      poolTexture.dispose();
    },
    [geometry, edgeGeometry, shadowTexture, poolTexture],
  );

  // El atlas cambia con la skin; se libera el anterior sin tocar la malla.
  useEffect(() => () => atlas.dispose(), [atlas]);

  return { geometry, edgeGeometry, atlas, shadowTexture, poolTexture };
}

/* ------------------------------------------------------------------------- */
/* Arena: reloj compartido, cámara y dados                                    */
/* ------------------------------------------------------------------------- */

function DiceArena({
  trajectories,
  skipped,
  skin,
  onLanded,
}: {
  trajectories: DiceTrajectory[];
  skipped: boolean;
  skin: DiceSkinId;
  onLanded: () => void;
}) {
  const durationMs = useMemo(
    () => Math.max(...trajectories.map((trajectory) => trajectory.durationMs)),
    [trajectories],
  );
  const multi = trajectories.length > 1;
  const elapsed = useRef(0);
  const skippedRef = useRef(skipped);
  const landedRef = useRef(false);
  const landedCallback = useRef(onLanded);
  const [landed, setLanded] = useState(false);
  const config = DICE_SKINS[skin] ?? DICE_SKINS[DEFAULT_DICE_SKIN];
  const shared = useSharedResources(config);

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
        durationMs + 500,
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

      {trajectories.map((trajectory, index) => (
        <Die
          key={index}
          trajectory={trajectory}
          elapsed={elapsed}
          skin={config}
          shared={shared}
        />
      ))}

      {multi && landed ? (
        <ResultLabels trajectories={trajectories} skin={config} />
      ) : null}

      <CameraRig
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
  trajectories,
  durationMs,
  elapsed,
}: {
  trajectories: DiceTrajectory[];
  durationMs: number;
  elapsed: { current: number };
}) {
  const camera = useThree((state) => state.camera);

  const view = useMemo(() => {
    if (trajectories.length === 1) {
      return singleCloseup(trajectories[0]!);
    }
    return groupView(trajectories);
  }, [trajectories]);

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

/**
 * Primer plano de un dado: la cámara se pone delante de la cara del resultado,
 * con el "arriba" de la etiqueta como arriba de la pantalla. No se rota el
 * dado a la fuerza: sigue apoyado donde lo dejó la física.
 */
function singleCloseup(trajectory: DiceTrajectory): CameraView {
  const last = trajectory.frames[trajectory.frames.length - 1]!;
  const finalQuaternion = new Quaternion(
    last.q[0],
    last.q[1],
    last.q[2],
    last.q[3],
  );
  const face = faceForNumber(trajectory.face);
  const normal = face.normal.clone().applyQuaternion(finalQuaternion).normalize();
  const labelUp = face.labelUp.clone().applyQuaternion(finalQuaternion).normalize();
  const labelRight = face.labelRight
    .clone()
    .applyQuaternion(finalQuaternion)
    .normalize();
  const center = new Vector3(last.p[0], last.p[1], last.p[2]);
  const faceCenter = center
    .clone()
    .addScaledVector(normal, DIE_INRADIUS * DIE_SCALE);
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
 * Vista de grupo: encuadra todos los dados en su pose final, desde arriba y en
 * ángulo de mesa, sin acercarse tanto como para dejar fuera los de los bordes.
 */
function groupView(trajectories: DiceTrajectory[]): CameraView {
  const finals = trajectories.map((trajectory) => {
    const last = trajectory.frames[trajectory.frames.length - 1]!;
    return new Vector3(last.p[0], last.p[1], last.p[2]);
  });

  // Centro de la caja envolvente, no la media: un dado desplazado no debe
  // arrastrar el encuadre y dejar a los demás fuera.
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
/* Un dado                                                                    */
/* ------------------------------------------------------------------------- */

function Die({
  trajectory,
  elapsed,
  skin,
  shared,
}: {
  trajectory: DiceTrajectory;
  elapsed: { current: number };
  skin: DiceSkin;
  shared: SharedResources;
}) {
  const group = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const shadowMaterial = useRef<MeshBasicMaterial>(null);
  const pool = useRef<Mesh>(null);
  const poolMaterial = useRef<MeshBasicMaterial>(null);
  const ring = useRef<Mesh>(null);
  const ringMaterial = useRef<MeshBasicMaterial>(null);
  const dieMaterial = useRef<MeshStandardMaterial>(null);

  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        map: shared.atlas,
        color: skin.materialColor,
        roughness: skin.roughness,
        metalness: skin.metalness,
        emissive: new Color(skin.emissiveColor),
        emissiveIntensity: 0,
      }),
    [shared.atlas, skin],
  );
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
        map: shared.shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      }),
    [shared.shadowTexture],
  );
  const contactMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        map: shared.poolTexture,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0.2,
      }),
    [shared.poolTexture],
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
      material.dispose();
      lineMaterial.dispose();
      floorMaterial.dispose();
      contactMaterial.dispose();
      impactMaterial.dispose();
    },
    [material, lineMaterial, floorMaterial, contactMaterial, impactMaterial],
  );

  useFrame((state) => {
    const finished = elapsed.current >= trajectory.durationMs;
    const pose = sampleTrajectory(
      Math.min(elapsed.current, trajectory.durationMs),
      trajectory,
    );
    const current = group.current;
    if (current) {
      current.position.copy(pose.position);
      current.quaternion.copy(pose.quaternion);
    }

    if (dieMaterial.current) {
      dieMaterial.current.emissiveIntensity = finished
        ? skin.emissiveBoost +
          Math.sin(state.clock.elapsedTime * 5) * skin.emissiveBoost * 0.16
        : pose.glow * skin.emissiveBoost;
    }
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
        <mesh geometry={shared.geometry} material={material} />
        <lineSegments geometry={shared.edgeGeometry} material={lineMaterial} />
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
/* Etiquetas de resultado para varios dados                                   */
/* ------------------------------------------------------------------------- */

function ResultLabels({
  trajectories,
  skin,
}: {
  trajectories: DiceTrajectory[];
  skin: DiceSkin;
}) {
  const textures = useMemo(() => {
    const map = new Map<number, CanvasTexture>();
    for (const trajectory of trajectories) {
      if (map.has(trajectory.face)) continue;
      map.set(trajectory.face, createResultLabelTexture(trajectory.face, skin));
    }
    return map;
  }, [trajectories, skin]);

  useEffect(
    () => () => {
      for (const texture of textures.values()) texture.dispose();
    },
    [textures],
  );

  return (
    <>
      {trajectories.map((trajectory, index) => {
        const last = trajectory.frames[trajectory.frames.length - 1]!;
        const texture = textures.get(trajectory.face);
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
    </>
  );
}

function createResultLabelTexture(
  number: number,
  skin: DiceSkin,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear la etiqueta del resultado");

  const radius = 22;
  context.beginPath();
  context.roundRect(6, 6, 244, 116, radius);
  context.fillStyle = skin.labelBackground;
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = `#${skin.edgeColor.toString(16).padStart(6, "0")}`;
  context.stroke();

  context.fillStyle = skin.labelInk;
  context.font =
    '900 78px "Arial Black", "Liberation Sans", "DejaVu Sans", Arial, sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(number), 128, 68);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/* ------------------------------------------------------------------------- */
/* Construcción de mallas y texturas                                          */
/* ------------------------------------------------------------------------- */

function buildDieGeometry(): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];

  for (const face of D20_FACES) {
    const tile = faceUv(face.number);
    face.vertices.forEach((vertex, index) => {
      positions.push(vertex.x, vertex.y, vertex.z);
      const point = tile[index];
      if (point) uvs.push(point[0], point[1]);
    });
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildEdgeGeometry(): BufferGeometry {
  const positions: number[] = [];
  for (const [a, b] of D20_EDGES) {
    positions.push(a.x * 1.003, a.y * 1.003, a.z * 1.003);
    positions.push(b.x * 1.003, b.y * 1.003, b.z * 1.003);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

function createContactPoolTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear la luz de contacto del d20");

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
  if (!context) throw new Error("No se pudo crear la sombra del d20");

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
