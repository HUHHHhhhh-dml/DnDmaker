import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
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
 * Escena 3D del d20. Este es el único módulo que importa `three` y
 * `@react-three/fiber`; `DiceCinematic` lo carga con `import()` en la primera
 * tirada. La trayectoria viene ya simulada por el servidor: aquí solo se
 * reproducen los frames y se mantiene la cara del resultado arriba.
 */

export interface D20SceneProps {
  roll: DiceRoll;
  /** Saltar: salta al último frame, sin cortar el resultado. */
  skipped: boolean;
  onLanded: () => void;
  onError: () => void;
}

export default function D20Scene({ roll, skipped, onLanded, onError }: D20SceneProps) {
  const errorRef = useRef(onError);
  const activeRef = useRef(true);
  const trajectory = roll.trajectory;

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
    if (!trajectory || trajectory.frames.length < 2) errorRef.current();
  }, [trajectory]);

  if (!trajectory || trajectory.frames.length < 2) return null;

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
      <CameraRig trajectory={trajectory} skipped={skipped} />
      <Die trajectory={trajectory} skipped={skipped} onLanded={onLanded} />
    </Canvas>
  );
}

const CAMERA_CLOSEUP_MS = 800;
const CAMERA_CLOSEUP_DISTANCE = 1.8;
const CAMERA_CLOSEUP_TILT = (12 * Math.PI) / 180;
const CAMERA_WORLD_UP = new Vector3(0, 1, 0);

function cameraSmoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Al terminar la tirada, la cámara se inclina y se acerca a la cara del
 * resultado. El dado no se rota a la fuerza: sigue apoyado donde lo dejó la
 * física; es la cámara la que se pone delante del número para que mire al
 * jugador, con el "arriba" de la etiqueta como arriba de la pantalla.
 */
function CameraRig({
  trajectory,
  skipped,
}: {
  trajectory: DiceTrajectory;
  skipped: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const elapsed = useRef(0);
  const skippedRef = useRef(skipped);

  useEffect(() => {
    skippedRef.current = skipped;
  }, [skipped]);

  const closeup = useMemo(() => {
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
    const targetPosition = faceCenter
      .clone()
      .addScaledVector(
        normal,
        CAMERA_CLOSEUP_DISTANCE * Math.cos(CAMERA_CLOSEUP_TILT),
      )
      .addScaledVector(
        labelRight,
        CAMERA_CLOSEUP_DISTANCE * Math.sin(CAMERA_CLOSEUP_TILT),
      );
    return { faceCenter, targetPosition, labelUp };
  }, [trajectory]);

  useFrame((_, delta) => {
    if (skippedRef.current) {
      elapsed.current = trajectory.durationMs + CAMERA_CLOSEUP_MS;
    } else {
      elapsed.current = Math.min(
        elapsed.current + Math.min(delta, 0.05) * 1000,
        trajectory.durationMs + CAMERA_CLOSEUP_MS,
      );
    }

    if (elapsed.current <= trajectory.durationMs) {
      camera.position.copy(TABLE_CAMERA_POS);
      camera.up.copy(CAMERA_WORLD_UP);
      camera.lookAt(TABLE_CAMERA_TARGET);
      return;
    }

    const u = cameraSmoothstep(
      (elapsed.current - trajectory.durationMs) / CAMERA_CLOSEUP_MS,
    );
    camera.position.lerpVectors(TABLE_CAMERA_POS, closeup.targetPosition, u);
    const target = new Vector3().lerpVectors(
      TABLE_CAMERA_TARGET,
      closeup.faceCenter,
      u,
    );
    camera.up.copy(CAMERA_WORLD_UP).lerp(closeup.labelUp, u).normalize();
    camera.lookAt(target);
  });

  return null;
}

function Die({
  trajectory,
  skipped,
  onLanded,
}: {
  trajectory: DiceTrajectory;
  skipped: boolean;
  onLanded: () => void;
}) {
  const group = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const shadowMaterial = useRef<MeshBasicMaterial>(null);
  const pool = useRef<Mesh>(null);
  const poolMaterial = useRef<MeshBasicMaterial>(null);
  const ring = useRef<Mesh>(null);
  const ringMaterial = useRef<MeshBasicMaterial>(null);
  const dieMaterial = useRef<MeshStandardMaterial>(null);
  const elapsed = useRef(0);
  const finished = useRef(false);
  const skippedRef = useRef(skipped);
  const landedRef = useRef(onLanded);

  useEffect(() => {
    skippedRef.current = skipped;
  }, [skipped]);

  useEffect(() => {
    landedRef.current = onLanded;
  }, [onLanded]);

  const geometry = useMemo(buildDieGeometry, []);
  const edgeGeometry = useMemo(buildEdgeGeometry, []);
  const atlas = useMemo(() => createD20Atlas(8), []);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        map: atlas,
        color: 0xffffff,
        roughness: 0.52,
        metalness: 0.06,
        emissive: new Color(0xd4a72c),
        emissiveIntensity: 0,
      }),
    [atlas],
  );
  const lineMaterial = useMemo(
    () =>
      new LineBasicMaterial({
        color: 0xd4a72c,
        transparent: true,
        opacity: 0.55,
      }),
    [],
  );
  const shadowTexture = useMemo(createShadowTexture, []);
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
  const poolTexture = useMemo(createContactPoolTexture, []);
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
        color: 0xd4a72c,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        opacity: 0,
      }),
    [],
  );

  useFrame((state, delta) => {
    if (finished.current) {
      // Posado: un pulso muy leve del borde dorado mientras el overlay se va.
      if (dieMaterial.current) {
        dieMaterial.current.emissiveIntensity =
          0.2 + Math.sin(state.clock.elapsedTime * 5) * 0.035;
      }
      return;
    }

    if (skippedRef.current) {
      elapsed.current = trajectory.durationMs;
    } else {
      // Un salto de pestaña no debe teletransportar el dado: como mucho
      // avanzamos 50 ms por frame.
      elapsed.current = Math.min(
        elapsed.current + Math.min(delta, 0.05) * 1000,
        trajectory.durationMs + 500,
      );
    }

    const pose = sampleTrajectory(elapsed.current, trajectory);
    const current = group.current;
    if (current) {
      current.position.copy(pose.position);
      current.quaternion.copy(pose.quaternion);
    }

    if (dieMaterial.current) dieMaterial.current.emissiveIntensity = pose.glow * 0.22;
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

    if (elapsed.current >= trajectory.durationMs) {
      finished.current = true;
      landedRef.current();
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <hemisphereLight intensity={1} color="#f4ead2" groundColor="#221b12" />
      <directionalLight position={[3.5, 5.5, 4.5]} intensity={2.6} />
      <directionalLight position={[-4, -1.5, -2.5]} intensity={1.15} color="#d4a72c" />

      <group ref={group} scale={DIE_SCALE}>
        <mesh geometry={geometry} material={material} />
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
/* Construcción de mallas                                                     */
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
