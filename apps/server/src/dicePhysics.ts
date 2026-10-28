import * as CANNON from "cannon-es";
import {
  D20_FACES,
  D20_GRAVITY,
  D20_READABLE_YAW_COS,
  D20_SCREEN_UP,
  D20_SIM_DT,
  D20_SIM_MAX_MS,
  D20_TABLE_BOUNDS,
  D20_TRAJECTORY_HZ,
  D20_VERTICES,
  DIE_REST_Y,
  DIE_SCALE,
  type DiceThrowInput,
  type DiceTrajectory,
  type DiceTrajectoryFrame,
  type DiceTrajectoryImpact,
} from "@protocol-life/shared";

/**
 * Simulación física del d20 en el servidor (Vía 3).
 *
 * El servidor tira el dado de verdad: construye el `ConvexPolyhedron` con la
 * geometría compartida, lo lanza sobre el plano de la mesa, deja que rebote y
 * graba la trayectoria. La cara que queda arriba **es** el resultado; no hay
 * una cara objetivo ni un ajuste final. Después el cliente reproduce los frames
 * y todos ven la misma tirada.
 *
 * El lanzamiento del cliente (arrastrar y soltar) es opcional: se usa como
 * condición inicial y el servidor le añade entropía criptográfica, así que el
 * resultado sigue siendo impredecible y no se puede forzar desde fuera.
 */

const MAX_ATTEMPTS = 24;
const START_HEIGHT = 2.15;
const REST_SPEED = 0.06;
const REST_ANGULAR = 0.18;
const REST_HOLD_MS = 140;
const RECORD_EVERY = Math.max(
  1,
  Math.round(1 / D20_SIM_DT / D20_TRAJECTORY_HZ),
);
const MAX_STEPS = Math.round(D20_SIM_MAX_MS / 1000 / D20_SIM_DT);

interface CollideEvent {
  readonly contact: {
    getImpactVelocityAlongNormal(): number;
  };
}

const DIE_SHAPE = (() => {
  const vertices = D20_VERTICES.map(
    ([x, y, z]) =>
      new CANNON.Vec3(x * DIE_SCALE, y * DIE_SCALE, z * DIE_SCALE),
  );
  const faces = D20_FACES.map((face) => [...face.indices]);
  return new CANNON.ConvexPolyhedron({ vertices, faces });
})();

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function worldWithTable(): CANNON.World {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -D20_GRAVITY, 0),
  });
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.26;

  const floor = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
  });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);

  const wall = (x: number, z: number, rotationY: number): void => {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    body.position.set(x, 0, z);
    // El plano mira hacia +Z por defecto; se gira para que su normal apunte
    // hacia dentro de la mesa.
    body.quaternion.setFromEuler(0, rotationY, 0);
    world.addBody(body);
  };

  const { x, z } = D20_TABLE_BOUNDS;
  wall(-x, 0, Math.PI / 2);
  wall(x, 0, -Math.PI / 2);
  wall(0, -z, 0);
  wall(0, z, Math.PI);

  return world;
}

function topFace(quaternion: CANNON.Quaternion): {
  face: (typeof D20_FACES)[number];
  up: number;
} {
  let best = -Infinity;
  let bestFace: (typeof D20_FACES)[number] | null = null;

  for (const face of D20_FACES) {
    const [nx, ny, nz] = face.normal;
    const world = quaternion.vmult(new CANNON.Vec3(nx, ny, nz));
    if (world.y > best) {
      best = world.y;
      bestFace = face;
    }
  }

  if (!bestFace) throw new Error("La simulación del d20 no encontró cara");
  return { face: bestFace, up: best };
}

function readable(quaternion: CANNON.Quaternion): boolean {
  const { face } = topFace(quaternion);
  const [ux, uy, uz] = face.labelUp;
  const world = quaternion.vmult(new CANNON.Vec3(ux, uy, uz));
  const horizontal = new CANNON.Vec3(world.x, 0, world.z);
  if (horizontal.lengthSquared() < 1e-8) return false;
  horizontal.normalize();
  const [sx, , sz] = D20_SCREEN_UP;
  return horizontal.x * sx + horizontal.z * sz >= D20_READABLE_YAW_COS;
}

function pushFrame(
  frames: DiceTrajectoryFrame[],
  body: CANNON.Body,
): void {
  frames.push({
    p: [body.position.x, body.position.y, body.position.z],
    q: [
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
    ],
  });
}

function initialThrow(
  random: () => number,
  input: DiceThrowInput | undefined,
): {
  start: CANNON.Vec3;
  velocity: CANNON.Vec3;
  angular: CANNON.Vec3;
} {
  const bounds = D20_TABLE_BOUNDS;
  const startX = clamp(
    input?.start?.[0] ?? (random() * 2 - 1) * bounds.x * 0.8,
    -bounds.x + DIE_SCALE,
    bounds.x - DIE_SCALE,
  );
  const startZ = clamp(
    input?.start?.[1] ?? (random() * 2 - 1) * bounds.z * 0.8,
    -bounds.z + DIE_SCALE,
    bounds.z - DIE_SCALE,
  );

  const baseVelocity = input?.velocity ?? [0, -2.6, 0];
  const baseAngular = input?.angular ?? [0, 0, 0];
  return {
    start: new CANNON.Vec3(
      startX,
      START_HEIGHT + random() * 0.35,
      startZ,
    ),
    velocity: new CANNON.Vec3(
      baseVelocity[0] + (random() * 2 - 1) * 1.1,
      Math.min(-1.2, baseVelocity[1] + (random() * 2 - 1) * 0.9),
      baseVelocity[2] + (random() * 2 - 1) * 1.1,
    ),
    angular: new CANNON.Vec3(
      baseAngular[0] + (random() * 2 - 1) * 11,
      baseAngular[1] + (random() * 2 - 1) * 11,
      baseAngular[2] + (random() * 2 - 1) * 11,
    ),
  };
}

function simulateAttempt(
  random: () => number,
  throwInput: DiceThrowInput | undefined,
): DiceTrajectory | null {
  const world = worldWithTable();
  const { start, velocity, angular } = initialThrow(random, throwInput);

  const body = new CANNON.Body({ mass: 1, shape: DIE_SHAPE });
  body.position.copy(start);
  body.quaternion.setFromEuler(
    random() * Math.PI * 2,
    random() * Math.PI * 2,
    random() * Math.PI * 2,
  );
  body.velocity.copy(velocity);
  body.angularVelocity.copy(angular);
  body.linearDamping = 0.07;
  body.angularDamping = 0.26;
  body.allowSleep = false;
  world.addBody(body);

  const frames: DiceTrajectoryFrame[] = [];
  const impacts: DiceTrajectoryImpact[] = [];
  let currentMs = 0;

  const onCollide = (event: Event): void => {
    const contact = (event as unknown as CollideEvent).contact;
    if (!contact) return;
    const strength = clamp(
      Math.abs(contact.getImpactVelocityAlongNormal()) / 3.5,
      0,
      1,
    );
    if (strength < 0.04) return;
    impacts.push({
      atMs: currentMs,
      x: body.position.x,
      z: body.position.z,
      strength,
    });
  };
  body.addEventListener("collide", onCollide);

  let elapsedMs = 0;
  let restMs = 0;
  let recorded = false;
  let finalMs = 0;

  pushFrame(frames, body);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    currentMs = elapsedMs;
    world.step(D20_SIM_DT);
    elapsedMs += D20_SIM_DT * 1000;

    if (step % RECORD_EVERY === 0) {
      pushFrame(frames, body);
      recorded = true;
    }

    const slow =
      body.velocity.length() < REST_SPEED &&
      body.angularVelocity.length() < REST_ANGULAR &&
      Math.abs(body.position.y - DIE_REST_Y) < 0.08;
    restMs = slow ? restMs + D20_SIM_DT * 1000 : 0;

    if (restMs >= REST_HOLD_MS) {
      finalMs = elapsedMs;
      break;
    }
  }

  if (!recorded || restMs < REST_HOLD_MS) return null;

  // El último frame es la pose de reposo; la duración se ajusta a él para que
  // el cliente interpole sin huecos.
  pushFrame(frames, body);
  finalMs = elapsedMs;

  const { face, up } = topFace(body.quaternion);
  if (up < 0.995) return null;
  if (!readable(body.quaternion)) return null;

  if (
    Math.abs(body.position.x) > D20_TABLE_BOUNDS.x + 0.01 ||
    Math.abs(body.position.z) > D20_TABLE_BOUNDS.z + 0.01
  ) {
    return null;
  }

  const durationMs = Math.max(1, finalMs);
  return {
    frames,
    durationMs,
    face: face.number,
    impacts: impacts
      .filter((impact) => impact.atMs <= durationMs)
      .map((impact) => ({
        ...impact,
        atMs: Math.min(impact.atMs, durationMs),
      })),
  };
}

/**
 * Simula una tirada de d20 hasta que el dado se detiene sobre una cara legible.
 * Devuelve `null` si no lo consigue en unos pocos intentos; el llamador puede
 * caer al pop actual.
 */
export function simulateD20Throw(options: {
  seed: number;
  throw?: DiceThrowInput;
}): DiceTrajectory | null {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const random = mulberry32(
      (options.seed + attempt * 0x9e3779b1) >>> 0,
    );
    const trajectory = simulateAttempt(random, options.throw);
    if (trajectory) return trajectory;
  }
  return null;
}
