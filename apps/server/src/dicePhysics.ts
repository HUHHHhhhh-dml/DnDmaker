import * as CANNON from "cannon-es";
import {
  D20_FACES,
  D20_GRAVITY,
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
 * Simulación física del d20 en el servidor.
 *
 * El servidor tira los dados de verdad: construye un `ConvexPolyhedron` con la
 * geometría compartida, los lanza sobre el plano de la mesa, deja que reboten y
 * graba las trayectorias. La cara que queda arriba de cada dado **es** su
 * resultado; no hay una cara objetivo ni un ajuste final. Después el cliente
 * reproduce los frames y todos ven la misma caída.
 *
 * El lanzamiento del cliente (arrastrar y soltar) es opcional: se usa como
 * condición inicial y el servidor le añade entropía criptográfica, así que el
 * resultado sigue siendo impredecible y no se puede forzar desde fuera. El
 * gesto sí controla una cosa puramente visual: los rebotes contra la mesa
 * (`bounces`). Se ajusta la restitución del contacto dado-mesa y se cuentan los
 * impactos hasta dar con el objetivo, sin tocar la cara final.
 */

const MAX_ATTEMPTS = 24;
/** Con varios dados hay más restricciones; más intentos saldrían caros. */
const MULTI_MAX_ATTEMPTS = 16;
/** Con rebotes el objetivo es más difícil de clavar; se permite buscar más. */
const BOUNCE_MAX_ATTEMPTS = 48;
const MAX_DICE = 20;
const START_HEIGHT = 2.15;
const REST_SPEED = 0.06;
const REST_ANGULAR = 0.18;
const REST_HOLD_MS = 140;
const MIN_IMPACT_STRENGTH = 0.18;
/** Dos contactos más juntos que esto son chatter del solver, no un rebote. */
const MIN_CONTACT_GAP_MS = 80;
const DEFAULT_RESTITUTION = 0.26;
/** Valor de restitución de partida para cada número de rebotes visibles. */
const BOUNCE_RESTITUTION = [0.1, 0.1, 0.38, 0.5, 0.62] as const;

const RECORD_EVERY = Math.max(
  1,
  Math.round(1 / D20_SIM_DT / D20_TRAJECTORY_HZ),
);
const MAX_STEPS = Math.round(D20_SIM_MAX_MS / 1000 / D20_SIM_DT);

interface CollideEvent {
  /** El otro cuerpo del contacto (la mesa, una pared u otro dado). */
  readonly body: CANNON.Body;
  readonly contact: {
    getImpactVelocityAlongNormal(): number;
  };
}

const DIE_MATERIAL = new CANNON.Material("d20");

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

/** Redondeo de la trayectoria: 0,1 mm de precisión y payload mucho menor. */
function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

interface TableWorld {
  world: CANNON.World;
  table: CANNON.Body;
}

function worldWithTable(tableRestitution: number): TableWorld {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -D20_GRAVITY, 0),
  });
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.26;

  const tableMaterial = new CANNON.Material("table");
  world.addContactMaterial(
    new CANNON.ContactMaterial(DIE_MATERIAL, tableMaterial, {
      friction: 0.42,
      restitution: tableRestitution,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(DIE_MATERIAL, DIE_MATERIAL, {
      friction: 0.35,
      restitution: 0.2,
    }),
  );

  const table = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
    material: tableMaterial,
  });
  table.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(table);

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

  return { world, table };
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

function pushFrame(
  frames: DiceTrajectoryFrame[],
  body: CANNON.Body,
): void {
  frames.push({
    p: [round(body.position.x), round(body.position.y), round(body.position.z)],
    q: [
      round(body.quaternion.x),
      round(body.quaternion.y),
      round(body.quaternion.z),
      round(body.quaternion.w),
    ],
  });
}

interface InitialCondition {
  start: CANNON.Vec3;
  velocity: CANNON.Vec3;
  angular: CANNON.Vec3;
  quaternion: CANNON.Quaternion;
}

/**
 * Reparte los puntos de salida de `count` dados en una rejilla que cabe en la
 * mesa. Con un solo dado reproduce el comportamiento anterior (aleatorio o el
 * `start` del gesto); con varios, los dados no se solapan al aparecer.
 */
function spreadStarts(
  random: () => number,
  input: DiceThrowInput | undefined,
  count: number,
): Array<[number, number]> {
  const { x: maxX, z: maxZ } = D20_TABLE_BOUNDS;
  const margin = DIE_SCALE * 1.5;

  if (count === 1) {
    return [
      [
        clamp(
          input?.start?.[0] ?? (random() * 2 - 1) * maxX * 0.8,
          -maxX + margin,
          maxX - margin,
        ),
        clamp(
          input?.start?.[1] ?? (random() * 2 - 1) * maxZ * 0.8,
          -maxZ + margin,
          maxZ - margin,
        ),
      ],
    ];
  }

  const columns = Math.min(
    count,
    Math.max(2, Math.ceil(Math.sqrt(count * (maxX / maxZ)))),
  );
  const rows = Math.ceil(count / columns);
  const spacingX = Math.min(0.64, (maxX * 2 - margin * 2) / columns);
  const spacingZ = Math.min(0.64, (maxZ * 2 - margin * 2) / rows);
  const centerX = clamp(
    input?.start?.[0] ?? 0,
    -maxX + (spacingX * (columns - 1)) / 2 + margin,
    maxX - (spacingX * (columns - 1)) / 2 - margin,
  );
  const centerZ = clamp(
    input?.start?.[1] ?? 0,
    -maxZ + (spacingZ * (rows - 1)) / 2 + margin,
    maxZ - (spacingZ * (rows - 1)) / 2 - margin,
  );

  const positions: Array<[number, number]> = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const inRow = Math.min(columns, count - row * columns);
    const rowOffset = ((columns - inRow) * spacingX) / 2;
    positions.push([
      centerX + (column - (columns - 1) / 2) * spacingX + rowOffset,
      centerZ + (row - (rows - 1) / 2) * spacingZ,
    ]);
  }
  return positions;
}

function initialConditions(
  random: () => number,
  input: DiceThrowInput | undefined,
  count: number,
): InitialCondition[] {
  const positions = spreadStarts(random, input, count);
  const baseVelocity = input?.velocity ?? [0, -2.6, 0];
  const baseAngular = input?.angular ?? [0, 0, 0];
  // Con varios dados hay que repartir el impulso: si todos salieran con la
  // velocidad máxima del gesto se saldrían de la mesa.
  const horizontalJitter = count > 1 ? 1.35 : 1.1;
  // Con varios dados, una parte del impulso apunta al centro de la mesa para
  // que se crucen y colisionen entre ellos; el resto es entropía.
  const centerX =
    positions.reduce((sum, [x]) => sum + x, 0) / positions.length;
  const centerZ =
    positions.reduce((sum, [, z]) => sum + z, 0) / positions.length;
  const inward = count > 1 ? 1.15 : 0;

  return positions.map(([startX, startZ]) => {
    const start = new CANNON.Vec3(
      startX,
      START_HEIGHT + random() * 0.35 + (count > 1 ? random() * 0.2 : 0),
      startZ,
    );
    return {
      start,
      velocity: new CANNON.Vec3(
        (centerX - startX) * inward +
          baseVelocity[0] * 0.4 +
          (random() * 2 - 1) * horizontalJitter,
        Math.min(-1.2, baseVelocity[1] + (random() * 2 - 1) * 0.9),
        (centerZ - startZ) * inward +
          baseVelocity[2] * 0.4 +
          (random() * 2 - 1) * horizontalJitter,
      ),
      angular: new CANNON.Vec3(
        baseAngular[0] + (random() * 2 - 1) * 11,
        baseAngular[1] + (random() * 2 - 1) * 11,
        baseAngular[2] + (random() * 2 - 1) * 11,
      ),
      quaternion: new CANNON.Quaternion().setFromEuler(
        random() * Math.PI * 2,
        random() * Math.PI * 2,
        random() * Math.PI * 2,
      ),
    };
  });
}

interface AttemptResult {
  trajectories: DiceTrajectory[];
  results: number[];
  /** Impactos fuertes contra la mesa de cada dado (el primero es el aterrizaje). */
  tableContacts: number[];
}

function runSimulation(
  conditions: readonly InitialCondition[],
  tableRestitution: number,
): AttemptResult | null {
  const { world, table } = worldWithTable(tableRestitution);
  const count = conditions.length;
  const frames: DiceTrajectoryFrame[][] = conditions.map(() => []);
  const impacts: DiceTrajectoryImpact[][] = conditions.map(() => []);
  const tableContacts = conditions.map(() => 0);
  const lastContactMs = conditions.map(() => -Infinity);
  const bodies: CANNON.Body[] = [];
  let currentMs = 0;

  conditions.forEach((condition, index) => {
    const body = new CANNON.Body({
      mass: 1,
      shape: DIE_SHAPE,
      material: DIE_MATERIAL,
    });
    body.position.copy(condition.start);
    body.quaternion.copy(condition.quaternion);
    body.velocity.copy(condition.velocity);
    body.angularVelocity.copy(condition.angular);
    body.linearDamping = 0.07;
    body.angularDamping = 0.26;
    body.allowSleep = false;

    body.addEventListener("collide", (event: Event) => {
      const { body: other, contact } = event as unknown as CollideEvent;
      // Solo cuentan los contactos contra la mesa: ni paredes ni otros dados.
      if (other !== table || !contact) return;
      const strength = clamp(
        Math.abs(contact.getImpactVelocityAlongNormal()) / 3.5,
        0,
        1,
      );
      if (strength < MIN_IMPACT_STRENGTH) return;
      if (currentMs - (lastContactMs[index] ?? -Infinity) < MIN_CONTACT_GAP_MS) return;
      lastContactMs[index] = currentMs;
      tableContacts[index] = (tableContacts[index] ?? 0) + 1;
      impacts[index]?.push({
        atMs: currentMs,
        x: round(body.position.x),
        z: round(body.position.z),
        strength: round(strength),
      });
    });

    world.addBody(body);
    bodies.push(body);
  });

  let elapsedMs = 0;
  const restMs = new Array<number>(count).fill(0);
  let recorded = false;
  let finalMs = 0;
  let settled = false;

  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const framesForDie = frames[index];
    if (body && framesForDie) pushFrame(framesForDie, body);
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    currentMs = elapsedMs;
    world.step(D20_SIM_DT);
    elapsedMs += D20_SIM_DT * 1000;

    if (step % RECORD_EVERY === 0) {
      for (let index = 0; index < bodies.length; index += 1) {
        const body = bodies[index];
        const framesForDie = frames[index];
        if (body && framesForDie) pushFrame(framesForDie, body);
      }
      recorded = true;
    }

    let allSlow = true;
    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index];
      if (!body) continue;
      const slow =
        body.velocity.length() < REST_SPEED &&
        body.angularVelocity.length() < REST_ANGULAR &&
        Math.abs(body.position.y - DIE_REST_Y) < 0.08;
      restMs[index] = slow ? (restMs[index] ?? 0) + D20_SIM_DT * 1000 : 0;
      if ((restMs[index] ?? 0) < REST_HOLD_MS) allSlow = false;
    }

    if (allSlow) {
      finalMs = elapsedMs;
      settled = true;
      break;
    }
  }

  if (!recorded || !settled) return null;

  // El último frame es la pose de reposo; todas las trayectorias comparten
  // duración para que la escena las reproduzca sincronizadas.
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const framesForDie = frames[index];
    if (body && framesForDie) pushFrame(framesForDie, body);
  }
  finalMs = elapsedMs;

  const trajectories: DiceTrajectory[] = [];
  const results: number[] = [];

  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const framesForDie = frames[index];
    const impactsForDie = impacts[index] ?? [];
    if (!body || !framesForDie) return null;

    if (
      Math.abs(body.position.x) > D20_TABLE_BOUNDS.x + 0.01 ||
      Math.abs(body.position.z) > D20_TABLE_BOUNDS.z + 0.01
    ) {
      return null;
    }

    const { face, up } = topFace(body.quaternion);
    if (up < 0.995) return null;

    const durationMs = Math.max(1, finalMs);
    trajectories.push({
      frames: framesForDie,
      durationMs,
      face: face.number,
      impacts: impactsForDie
        .filter((impact) => impact.atMs <= durationMs)
        .map((impact) => ({
          ...impact,
          atMs: Math.min(impact.atMs, durationMs),
        })),
      bounces: Math.max(0, impactsForDie.length - 1),
    });
    results.push(face.number);
  }

  return { trajectories, results, tableContacts };
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Busca, para unas condiciones iniciales fijas, la restitución dado-mesa que
 * produce exactamente `targetContacts` impactos. La relación suele ser
 * monótona (más restitución, más contactos), así que se corrige en la dirección
 * del error y se reintenta con condiciones nuevas si no se clava.
 */
function runWithBounceTarget(
  conditions: readonly InitialCondition[],
  targetBounces: number,
): AttemptResult | null {
  const targetContacts = targetBounces + 1;
  let restitution = BOUNCE_RESTITUTION[targetBounces] ?? DEFAULT_RESTITUTION;
  const tried = new Set<number>();
  let fallback: AttemptResult | null = null;
  let fallbackDelta = Infinity;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const key = Math.round(restitution * 1000);
    if (tried.has(key)) break;
    tried.add(key);

    const result = runSimulation(conditions, restitution);
    if (!result) {
      restitution = clamp(restitution + 0.05, 0.02, 0.85);
      continue;
    }

    const counts = result.tableContacts;
    if (counts.every((count) => count === targetContacts)) return result;

    const delta = average(counts) - targetContacts;
    if (Math.abs(delta) < fallbackDelta) {
      fallback = result;
      fallbackDelta = Math.abs(delta);
    }
    // Si hay demasiados contactos hay que bajar la restitución, y al revés.
    restitution = clamp(restitution - delta * 0.05, 0.02, 0.85);
  }

  return fallback;
}

export interface SimulatedD20Roll {
  /** Cara superior de cada dado, en el orden en que se lanzaron. */
  results: number[];
  /** Una trayectoria por dado, en el mismo orden que `results`. */
  trajectories: DiceTrajectory[];
}

/**
 * Simula una tirada de `count` d20 en la misma mesa. Devuelve `null` si no lo
 * consigue en unos pocos intentos; el llamador cae al número aleatorio y el
 * cliente usa el pop.
 */
export function simulateD20Roll(options: {
  seed: number;
  count?: number;
  throw?: DiceThrowInput;
}): SimulatedD20Roll | null {
  const count = clamp(Math.round(options.count ?? 1), 1, MAX_DICE);
  const targetBounces =
    count === 1 && options.throw?.bounces !== undefined
      ? clamp(Math.round(options.throw.bounces), 1, 4)
      : null;
  const maxAttempts =
    targetBounces !== null
      ? BOUNCE_MAX_ATTEMPTS
      : count > 1
        ? MULTI_MAX_ATTEMPTS
        : MAX_ATTEMPTS;
  let fallback: SimulatedD20Roll | null = null;
  let fallbackDelta = Infinity;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const random = mulberry32(
      (options.seed + attempt * 0x9e3779b1) >>> 0,
    );
    const conditions = initialConditions(random, options.throw, count);

    if (targetBounces !== null) {
      const result = runWithBounceTarget(conditions, targetBounces);
      if (!result) continue;
      if (result.tableContacts.every((c) => c === targetBounces + 1)) {
        return {
          results: result.results,
          trajectories: result.trajectories,
        };
      }
      // Guarda el mejor aunque no dé el número exacto de rebotes: es una
      // restricción visual, la cara física manda.
      const delta = Math.max(
        ...result.tableContacts.map((c) => Math.abs(c - targetBounces - 1)),
      );
      if (delta < fallbackDelta) {
        fallbackDelta = delta;
        fallback = {
          results: result.results,
          trajectories: result.trajectories,
        };
      }
      continue;
    }

    const result = runSimulation(conditions, DEFAULT_RESTITUTION);
    if (result) {
      return {
        results: result.results,
        trajectories: result.trajectories,
      };
    }
  }

  return fallback;
}

/** Compatibilidad: una tirada física de un d20. */
export function simulateD20Throw(options: {
  seed: number;
  throw?: DiceThrowInput;
}): DiceTrajectory | null {
  return simulateD20Roll({ ...options, count: 1 })?.trajectories[0] ?? null;
}