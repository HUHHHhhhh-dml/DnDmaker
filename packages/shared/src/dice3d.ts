/**
 * Geometría, numeración y constantes del d20 compartidas por servidor y cliente.
 *
 * El servidor construye con esto el `ConvexPolyhedron` de la simulación; el
 * cliente construye la malla y el atlas. Las caras están numeradas 1..20 (las
 * opuestas suman 21) y el orden del array es el de la numeración: la cara `n`
 * es `D20_FACES[n - 1]`. Así el índice de cara que devuelve la física es
 * directamente el número que se pinta en el dado y el que viaja en `DiceRoll`.
 *
 * Este módulo no depende de three ni de cannon: solo datos y matemáticas
 * básicas, para poder importarse desde ambos lados.
 */

export type Vec3 = readonly [number, number, number];

export interface D20FaceData {
  /** Cara 1..20; coincide con la posición en `D20_FACES` + 1. */
  readonly number: number;
  /** Índices de los tres vértices en `D20_VERTICES`, en orden CCW hacia fuera. */
  readonly indices: readonly [number, number, number];
  /** Los tres vértices, en orden CCW hacia fuera. */
  readonly vertices: readonly [Vec3, Vec3, Vec3];
  readonly centroid: Vec3;
  /** Normal unitaria hacia fuera. */
  readonly normal: Vec3;
  /** "Arriba" de la etiqueta dentro del plano de la cara. */
  readonly labelUp: Vec3;
  /** "Derecha" de la etiqueta dentro del plano de la cara. */
  readonly labelRight: Vec3;
}

const PHI = (1 + Math.sqrt(5)) / 2;

const RAW_VERTICES: ReadonlyArray<Vec3> = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
];

const RAW_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

function normalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function unit(a: Vec3): Vec3 {
  const magnitude = length(a);
  return magnitude > 0 ? scale(a, 1 / magnitude) : [0, 1, 0];
}

/** 12 vértices del icosaedro normalizados a radio 1. */
export const D20_VERTICES: readonly Vec3[] = RAW_VERTICES.map(normalize);

interface RawFace {
  readonly indices: [number, number, number];
  readonly vertices: [Vec3, Vec3, Vec3];
  readonly centroid: Vec3;
  readonly normal: Vec3;
}

function toRawFace(indices: readonly [number, number, number]): RawFace {
  const [ia, ib, ic] = indices;
  const a = D20_VERTICES[ia];
  const b = D20_VERTICES[ib];
  const c = D20_VERTICES[ic];
  if (!a || !b || !c) {
    throw new Error(`Vértice fuera de rango en el d20: ${indices.join(",")}`);
  }

  const centroid = scale(add(add(a, b), c), 1 / 3);
  let v1: Vec3 = b;
  let v2: Vec3 = c;
  let outIndices: [number, number, number] = [ia, ib, ic];
  let normal = unit(cross(sub(v1, a), sub(v2, a)));

  // Winding CCW hacia fuera; si no, intercambia dos vértices y sus índices.
  if (dot(normal, centroid) < 0) {
    [v1, v2] = [v2, v1];
    outIndices = [ia, ic, ib];
    normal = scale(normal, -1);
  }

  return {
    indices: outIndices,
    vertices: [a, v1, v2],
    centroid,
    normal,
  };
}

function buildFaces(): readonly D20FaceData[] {
  const raw = RAW_FACES.map(toRawFace);
  const remaining = new Set(raw.map((_, index) => index));
  const pairs: Array<readonly [RawFace, RawFace]> = [];

  for (let index = 0; index < raw.length; index += 1) {
    if (!remaining.has(index)) continue;
    const face = raw[index];
    if (!face) continue;
    remaining.delete(index);

    let opposite = -1;
    for (const candidate of remaining) {
      const other = raw[candidate];
      if (other && dot(other.normal, face.normal) < -0.999) {
        opposite = candidate;
        break;
      }
    }
    if (opposite < 0) throw new Error("El icosaedro del d20 no tiene cara opuesta");

    remaining.delete(opposite);
    const other = raw[opposite];
    if (!other) throw new Error("Cara opuesta inválida en el d20");
    pairs.push([face, other]);
  }

  if (pairs.length !== 10) {
    throw new Error(`El d20 debe tener 10 pares de caras, tiene ${pairs.length}`);
  }

  const faces: D20FaceData[] = new Array(20);
  pairs.forEach(([first, second], pairIndex) => {
    const low = pairIndex + 1;
    const high = 20 - pairIndex;
    faces[low - 1] = withNumber(first, low);
    faces[high - 1] = withNumber(second, high);
  });

  return faces;
}

function withNumber(raw: RawFace, number: number): D20FaceData {
  const [a, b, c] = raw.vertices;
  const baseMidpoint = scale(add(a, b), 0.5);
  return {
    number,
    indices: raw.indices,
    vertices: raw.vertices,
    centroid: raw.centroid,
    normal: raw.normal,
    // La UV del vértice c (ápice del triángulo de textura) marca el "arriba".
    labelUp: unit(sub(c, baseMidpoint)),
    labelRight: unit(sub(b, a)),
  };
}

/** Caras numeradas 1..20; `D20_FACES[n - 1].number === n`. */
export const D20_FACES: readonly D20FaceData[] = buildFaces();

/** Las 30 aristas únicas, como pares de índices de `D20_VERTICES`. */
export const D20_EDGE_INDICES: ReadonlyArray<readonly [number, number]> = (() => {
  const seen = new Set<string>();
  const edges: Array<readonly [number, number]> = [];
  for (const [ia, ib, ic] of RAW_FACES) {
    for (const [i, j] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ] as const) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([i, j]);
    }
  }
  return edges;
})();

/* ------------------------------------------------------------------------- */
/* Escala, mesa y simulación                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Escala del dado respecto a la geometría de radio 1. La versión de mesa
 * anterior usaba 0,46; a mitad de tamaño queda en la mitad de píxeles.
 */
export const DIE_SCALE = 0.23;
/** Inradio del icosaedro de circunradio 1. */
export const DIE_INRADIUS = 0.794;
/** Altura del centro del dado cuando descansa sobre una cara (mesa en y=0). */
export const DIE_REST_Y = DIE_INRADIUS * DIE_SCALE;

/** Mesa visible: el dado no debe salirse de estos límites. */
export const D20_TABLE_BOUNDS = { x: 2, z: 1.2 } as const;

/** Dirección "arriba" de la pantalla proyectada sobre la mesa (cámara en +Z). */
export const D20_SCREEN_UP: Vec3 = [0, 0, -1];

/** Frecuencia con la que se graban los frames que viajan al cliente. */
export const D20_TRAJECTORY_HZ = 30;
/** Paso fijo de la simulación del servidor (más fino que la grabación). */
export const D20_SIM_DT = 1 / 120;
/** Tiempo máximo que puede durar una tirada simulada. */
export const D20_SIM_MAX_MS = 5_000;
/** Coseno del ángulo máximo entre el número y la pantalla para darlo por legible. */
export const D20_READABLE_YAW_COS = Math.cos((60 * Math.PI) / 180);
/** Gravedad de la simulación, en unidades de mesa. */
export const D20_GRAVITY = 9.82;

/** Devuelve la cara numerada `number` (1..20). */
export function d20Face(number: number): D20FaceData {
  const face = D20_FACES[number - 1];
  if (!face) throw new Error(`El d20 no tiene cara ${number}`);
  return face;
}
