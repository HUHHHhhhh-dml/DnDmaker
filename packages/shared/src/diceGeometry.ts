import {
  D20_EDGE_INDICES,
  D20_FACES,
  D20_SCREEN_UP,
  D20_VERTICES,
  DIE_INRADIUS,
  type Vec3,
} from "./dice3d";
import type { DiceSides } from "./types";

/**
 * Definición geométrica de cada dado físico.
 *
 * La fuente de verdad es este módulo: servidor y cliente construyen con él el
 * `ConvexPolyhedron`, la malla, las etiquetas y la lectura del resultado. Cada
 * cara es un polígono convexo (triángulo, cuadrado, pentágono o cometa) con su
 * normal, su centro y una base 2D (`labelUp`/`labelRight`) para orientar el
 * número en el atlas.
 *
 * - `top-face`: el resultado es la cara que queda arriba (d6, d8, d10, d12, d20).
 * - `top-vertex`: el resultado es el vértice que queda arriba (d4).
 *
 * d100 no tiene geometría propia: son dos d10 (decenas y unidades).
 */

export type BuiltDieSides = 4 | 6 | 8 | 10 | 12 | 20;

export type DieResultMode = "top-face" | "top-vertex";

export interface DieFace {
  /** Número de cara (1..sides). En el d4 es el índice de la cara. */
  readonly number: number;
  /** Índices de los vértices del polígono, en orden CCW hacia fuera. */
  readonly indices: readonly number[];
  /** Vértices del polígono, en el mismo orden que `indices`. */
  readonly vertices: readonly Vec3[];
  readonly centroid: Vec3;
  /** Normal unitaria hacia fuera. */
  readonly normal: Vec3;
  /** "Arriba" de la etiqueta dentro del plano de la cara. */
  readonly labelUp: Vec3;
  /** "Derecha" de la etiqueta dentro del plano de la cara. */
  readonly labelRight: Vec3;
  /**
   * Solo en dados de vértice (d4): número que se pinta junto a cada vértice de
   * esta cara, en el mismo orden que `indices`.
   */
  readonly vertexLabels?: readonly number[];
}

export interface DieDefinition {
  readonly sides: BuiltDieSides;
  readonly resultMode: DieResultMode;
  /** Vértices normalizados a circunradio 1. */
  readonly vertices: readonly Vec3[];
  readonly faces: readonly DieFace[];
  /** Aristas únicas como pares de índices de `vertices`. */
  readonly edges: ReadonlyArray<readonly [number, number]>;
  /** Distancia del centro al plano de una cara (para la altura de reposo). */
  readonly inradius: number;
  /** Solo en dados de vértice: número asignado a cada vértice. */
  readonly vertexNumbers?: readonly number[];
}

/* ------------------------------------------------------------------------- */
/* Álgebra de vectores                                                       */
/* ------------------------------------------------------------------------- */

/** Umbral para considerar que una proyección es degenerada. */
const DEGENERATE_LENGTH = 1e-9;
/** Coseno con el que se considera que dos normales son opuestas. */
const OPPOSITE_NORMAL_DOT = -0.999;

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = length(vector);
  if (magnitude === 0) throw new Error("No se puede normalizar un vector nulo");
  return scale(vector, 1 / magnitude);
}

function vertexAt(vertices: readonly Vec3[], index: number): Vec3 {
  const vertex = vertices[index];
  if (!vertex) throw new Error(`Vértice fuera de rango: ${index}`);
  return vertex;
}

/** Componente de `vector` perpendicular al plano de normal `normal`. */
function rejectFromPlane(vector: Vec3, normal: Vec3): Vec3 {
  return sub(vector, scale(normal, dot(vector, normal)));
}

function centroidOf(
  vertices: readonly Vec3[],
  indices: readonly number[],
): Vec3 {
  if (indices.length === 0) throw new Error("Una cara no puede estar vacía");
  let sum: Vec3 = [0, 0, 0];
  for (const index of indices) sum = add(sum, vertexAt(vertices, index));
  return scale(sum, 1 / indices.length);
}

/**
 * Base 2D de la etiqueta: `labelUp` es la proyección de `D20_SCREEN_UP` sobre
 * el plano de la cara (con los respaldos indicados) y `labelRight` completa la
 * base dextrógira con `cross(labelUp, normal)`.
 */
function labelBasis(normal: Vec3): { labelUp: Vec3; labelRight: Vec3 } {
  let up = rejectFromPlane(D20_SCREEN_UP, normal);
  if (length(up) < DEGENERATE_LENGTH) {
    up = rejectFromPlane([0, 1, 0], normal);
  }
  if (length(up) < DEGENERATE_LENGTH) {
    // Cualquier dirección que no sea paralela a la normal sirve como respaldo.
    const reference: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    up = rejectFromPlane(reference, normal);
  }
  const labelUp = normalize(up);
  const labelRight = normalize(cross(labelUp, normal));
  return { labelUp, labelRight };
}

/* ------------------------------------------------------------------------- */
/* Construcción genérica                                                     */
/* ------------------------------------------------------------------------- */

interface FaceData {
  indices: number[];
  vertices: Vec3[];
  centroid: Vec3;
  normal: Vec3;
  labelUp: Vec3;
  labelRight: Vec3;
}

function buildFace(
  vertices: readonly Vec3[],
  rawIndices: readonly number[],
): FaceData {
  if (rawIndices.length < 3) {
    throw new Error(
      `Una cara necesita al menos 3 vértices: ${rawIndices.join(",")}`,
    );
  }
  let indices = [...rawIndices];
  let faceVertices = indices.map((index) => vertexAt(vertices, index));
  const centroid = centroidOf(vertices, indices);
  let normal = normalize(
    cross(
      sub(faceVertices[1]!, faceVertices[0]!),
      sub(faceVertices[2]!, faceVertices[0]!),
    ),
  );

  // Winding CCW hacia fuera: si la normal apunta hacia dentro, se invierte.
  if (dot(normal, centroid) < 0) {
    indices = [...indices].reverse();
    faceVertices = [...faceVertices].reverse();
    normal = scale(normal, -1);
  }

  const { labelUp, labelRight } = labelBasis(normal);
  return {
    indices,
    vertices: faceVertices,
    centroid,
    normal,
    labelUp,
    labelRight,
  };
}

/**
 * Numera las caras 1..sides. En los dados de cara se emparejan las caras
 * opuestas (normales casi contrarias) para que sus números sumen `sides + 1`.
 * El d4 no usa esta regla: su resultado es un vértice.
 */
function numberFaces(
  rawFaces: readonly FaceData[],
  sides: BuiltDieSides,
  pairOppositeFaces: boolean,
): DieFace[] {
  if (rawFaces.length !== sides) {
    throw new Error(
      `El d${sides} necesita ${sides} caras, tiene ${rawFaces.length}`,
    );
  }

  if (!pairOppositeFaces) {
    return rawFaces.map((face, index) => ({ ...face, number: index + 1 }));
  }

  if (sides % 2 !== 0) {
    throw new Error(`El d${sides} no puede emparejar caras opuestas`);
  }

  const remaining = new Set(rawFaces.map((_, index) => index));
  const slots: Array<DieFace | undefined> = new Array(sides);
  let pairIndex = 0;

  for (let index = 0; index < rawFaces.length; index += 1) {
    if (!remaining.has(index)) continue;
    const face = rawFaces[index]!;
    remaining.delete(index);

    let oppositeIndex = -1;
    for (const candidate of remaining) {
      const other = rawFaces[candidate]!;
      if (dot(face.normal, other.normal) <= OPPOSITE_NORMAL_DOT) {
        oppositeIndex = candidate;
        break;
      }
    }
    if (oppositeIndex < 0) {
      throw new Error(`El d${sides} tiene una cara sin opuesta`);
    }
    remaining.delete(oppositeIndex);

    const low = pairIndex + 1;
    const high = sides - pairIndex;
    slots[low - 1] = { ...face, number: low };
    slots[high - 1] = { ...rawFaces[oppositeIndex]!, number: high };
    pairIndex += 1;
  }

  if (pairIndex * 2 !== sides) {
    throw new Error(`El d${sides} no tiene todas sus caras emparejadas`);
  }

  return slots.map((face, index) => {
    if (!face) throw new Error(`Falta la cara ${index + 1} del d${sides}`);
    return face;
  });
}

function collectEdges(
  faces: readonly DieFace[],
): ReadonlyArray<readonly [number, number]> {
  const seen = new Set<string>();
  const edges: Array<readonly [number, number]> = [];
  for (const face of faces) {
    for (let position = 0; position < face.indices.length; position += 1) {
      const a = face.indices[position]!;
      const b = face.indices[(position + 1) % face.indices.length]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  return edges;
}

interface BuildDefinitionOptions {
  readonly sides: BuiltDieSides;
  readonly resultMode: DieResultMode;
  readonly vertices: readonly Vec3[];
  readonly faceIndices: ReadonlyArray<readonly number[]>;
  readonly pairOppositeFaces?: boolean;
  readonly vertexNumbers?: readonly number[];
}

function buildDefinition(options: BuildDefinitionOptions): DieDefinition {
  const vertices = options.vertices.map(normalize);
  const rawFaces = options.faceIndices.map((indices) =>
    buildFace(vertices, indices),
  );
  const numberedFaces = numberFaces(
    rawFaces,
    options.sides,
    options.pairOppositeFaces ?? true,
  );

  let faces: readonly DieFace[] = numberedFaces;
  if (options.vertexNumbers) {
    const vertexNumbers = options.vertexNumbers;
    if (vertexNumbers.length !== vertices.length) {
      throw new Error(
        `El d${options.sides} necesita ${vertices.length} números de vértice`,
      );
    }
    faces = numberedFaces.map((face) => ({
      ...face,
      vertexLabels: face.indices.map((index) => {
        const label = vertexNumbers[index];
        if (label === undefined) {
          throw new Error(`Falta el número del vértice ${index}`);
        }
        return label;
      }),
    }));
  }

  const edges = collectEdges(faces);
  let inradius = Infinity;
  for (const face of faces) {
    inradius = Math.min(inradius, dot(face.centroid, face.normal));
  }

  return {
    sides: options.sides,
    resultMode: options.resultMode,
    vertices,
    faces,
    edges,
    inradius,
    ...(options.vertexNumbers ? { vertexNumbers: options.vertexNumbers } : {}),
  };
}

/**
 * Ordena las caras que concurren en un vértice alrededor de su dirección. Se
 * usa para el d12: los centros de las caras del icosaedro son coplanarios
 * (el plano es perpendicular a la dirección del vértice), así que el ángulo
 * en ese plano da directamente el orden del polígono.
 */
function orderFaceIndicesAround(
  axis: Vec3,
  faceIndices: readonly number[],
  vertices: readonly Vec3[],
): number[] {
  const normal = normalize(axis);
  const reference: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const tangent = normalize(rejectFromPlane(reference, normal));
  // `tangent × bitangent = normal`: el ángulo creciente gira en sentido CCW.
  const bitangent = cross(normal, tangent);
  return [...faceIndices].sort((left, right) => {
    const leftVertex = vertexAt(vertices, left);
    const rightVertex = vertexAt(vertices, right);
    const leftAngle = Math.atan2(
      dot(leftVertex, bitangent),
      dot(leftVertex, tangent),
    );
    const rightAngle = Math.atan2(
      dot(rightVertex, bitangent),
      dot(rightVertex, tangent),
    );
    return leftAngle - rightAngle;
  });
}

/* ------------------------------------------------------------------------- */
/* d4: tetraedro regular                                                     */
/* ------------------------------------------------------------------------- */

const TETRAHEDRON_VERTICES: readonly Vec3[] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
];

const TETRAHEDRON_FACES: ReadonlyArray<readonly number[]> = [
  [0, 1, 2],
  [0, 3, 1],
  [0, 2, 3],
  [1, 3, 2],
];

const D4_DEFINITION: DieDefinition = buildDefinition({
  sides: 4,
  resultMode: "top-vertex",
  vertices: TETRAHEDRON_VERTICES,
  faceIndices: TETRAHEDRON_FACES,
  pairOppositeFaces: false,
  vertexNumbers: [1, 2, 3, 4],
});

/* ------------------------------------------------------------------------- */
/* d6: cubo                                                                  */
/* ------------------------------------------------------------------------- */

const CUBE_SCALE = 1 / Math.sqrt(3);

/** Vértices del cubo a circunradio 1 (coordenadas ±1/√3). */
const CUBE_UNIT_VERTICES: readonly Vec3[] = [
  [1, 1, 1],
  [1, 1, -1],
  [1, -1, 1],
  [1, -1, -1],
  [-1, 1, 1],
  [-1, 1, -1],
  [-1, -1, 1],
  [-1, -1, -1],
];

const CUBE_VERTICES: readonly Vec3[] = CUBE_UNIT_VERTICES.map((vertex) =>
  scale(vertex, CUBE_SCALE),
);

const CUBE_FACES: ReadonlyArray<readonly number[]> = [
  [0, 1, 3, 2],
  [4, 6, 7, 5],
  [0, 4, 5, 1],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 5, 7, 3],
];

const D6_DEFINITION: DieDefinition = buildDefinition({
  sides: 6,
  resultMode: "top-face",
  vertices: CUBE_VERTICES,
  faceIndices: CUBE_FACES,
});

/* ------------------------------------------------------------------------- */
/* d8: octaedro                                                              */
/* ------------------------------------------------------------------------- */

const OCTAHEDRON_VERTICES: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const OCTAHEDRON_FACES: ReadonlyArray<readonly number[]> = [
  [0, 2, 4],
  [2, 1, 4],
  [1, 3, 4],
  [3, 0, 4],
  [2, 0, 5],
  [1, 2, 5],
  [3, 1, 5],
  [0, 3, 5],
];

const D8_DEFINITION: DieDefinition = buildDefinition({
  sides: 8,
  resultMode: "top-face",
  vertices: OCTAHEDRON_VERTICES,
  faceIndices: OCTAHEDRON_FACES,
});

/* ------------------------------------------------------------------------- */
/* d10: trapezoedro pentagonal                                               */
/* ------------------------------------------------------------------------- */

/**
 * El d10 es el dual del antiprisma pentagonal. Si se parte de un antiprisma de
 * radio 1 y semialtura H, el centro de una cara triangular está a altura H/3 y
 * a distancia radial
 *
 *   c = (1 + cos 36° + cos 72°) / (3 cos 36°)
 *
 * del eje. Al normalizar los 12 centros a radio 1, la altura de la cintura es
 * u = H / sqrt(9c² + H²). Para que las cometas del dual sean planas, los cuatro
 * vértices de una cara (ápice, dos vértices superiores y el inferior) deben ser
 * coplanarios; con el ápice en (0,0,1) y la cintura en z = ±u y radio
 * sqrt(1-u²), eso exige
 *
 *   u = (1 - cos 36°) / (1 + cos 36°) = tan² 18°.
 *
 * (El antiprisma de aristas iguales, H = 0,5, no cumple esta condición; por eso
 * se resuelve H a partir de u.) Despejando:
 *
 *   H = 3 c u / sqrt(1 - u²).
 *
 * Con esta altura, los centros normalizados forman un trapezoedro pentagonal
 * convexo de 12 vértices, 20 aristas y 10 cometas planas.
 */
const D10_BELT_Z = Math.tan(Math.PI / 10) ** 2;
const D10_TRIANGLE_CENTROID_RADIUS =
  (1 + Math.cos(Math.PI / 5) + Math.cos((2 * Math.PI) / 5)) /
  (3 * Math.cos(Math.PI / 5));
const D10_ANTIPRISM_HEIGHT =
  (3 * D10_TRIANGLE_CENTROID_RADIUS * D10_BELT_Z) /
  Math.sqrt(1 - D10_BELT_Z ** 2);

function buildD10(): DieDefinition {
  const pentagonAngle = (2 * Math.PI) / 5;
  const top: Vec3[] = [];
  const bottom: Vec3[] = [];

  for (let index = 0; index < 5; index += 1) {
    const topAngle = pentagonAngle * index;
    top.push([Math.cos(topAngle), Math.sin(topAngle), D10_ANTIPRISM_HEIGHT]);
    // El pentágono inferior gira 36° (medio paso) para formar el antiprisma.
    const bottomAngle = pentagonAngle * (index + 0.5);
    bottom.push([
      Math.cos(bottomAngle),
      Math.sin(bottomAngle),
      -D10_ANTIPRISM_HEIGHT,
    ]);
  }

  const antiprismVertices: readonly Vec3[] = [...top, ...bottom];
  const antiprismFaces: number[][] = [
    // Pentágonos superior e inferior.
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8, 9],
  ];
  for (let index = 0; index < 5; index += 1) {
    const next = (index + 1) % 5;
    // Triángulos con arista superior / inferior.
    antiprismFaces.push([index, next, 5 + index]);
    antiprismFaces.push([5 + index, 5 + next, next]);
  }

  // Vértices del dual: centros de las 12 caras del antiprisma, a radio 1.
  const dualVertices = antiprismFaces.map((indices) =>
    normalize(centroidOf(antiprismVertices, indices)),
  );

  // Cada vértice del antiprisma produce una cometa con los cuatro centros de
  // sus caras incidentes, en orden alrededor del vértice.
  const dualFaces: number[][] = [];
  for (let index = 0; index < 5; index += 1) {
    const previous = (index + 4) % 5;
    const previousTopTriangle = 2 + 2 * previous;
    const previousBottomTriangle = previousTopTriangle + 1;
    const topTriangle = 2 + 2 * index;
    const bottomTriangle = topTriangle + 1;

    // Cometa del ápice superior (vértice superior del antiprisma).
    dualFaces.push([
      0,
      previousTopTriangle,
      previousBottomTriangle,
      topTriangle,
    ]);
    // Cometa del ápice inferior (vértice inferior del antiprisma).
    dualFaces.push([1, previousBottomTriangle, topTriangle, bottomTriangle]);
  }

  return buildDefinition({
    sides: 10,
    resultMode: "top-face",
    vertices: dualVertices,
    faceIndices: dualFaces,
  });
}

const D10_DEFINITION: DieDefinition = buildD10();

/* ------------------------------------------------------------------------- */
/* d12: dodecaedro (dual del icosaedro)                                      */
/* ------------------------------------------------------------------------- */

function buildD12(): DieDefinition {
  // Los 20 vértices del dodecaedro son los centros normalizados de las 20 caras
  // del icosaedro (D20_FACES).
  const vertices = D20_FACES.map((face) => normalize(face.centroid));

  // Cada una de las 12 caras corresponde a un vértice del icosaedro: los cinco
  // centros de las caras que concurren en él, ordenados alrededor de su normal.
  const faceIndices: number[][] = [];
  for (
    let vertexIndex = 0;
    vertexIndex < D20_VERTICES.length;
    vertexIndex += 1
  ) {
    const incidentFaces: number[] = [];
    D20_FACES.forEach((face, faceIndex) => {
      if (face.indices.includes(vertexIndex)) incidentFaces.push(faceIndex);
    });
    if (incidentFaces.length !== 5) {
      throw new Error(
        `El vértice ${vertexIndex} del icosaedro debería tocar 5 caras`,
      );
    }
    faceIndices.push(
      orderFaceIndicesAround(
        vertexAt(D20_VERTICES, vertexIndex),
        incidentFaces,
        vertices,
      ),
    );
  }

  return buildDefinition({
    sides: 12,
    resultMode: "top-face",
    vertices,
    faceIndices,
  });
}

const D12_DEFINITION: DieDefinition = buildD12();

/* ------------------------------------------------------------------------- */
/* d20: ya construido en dice3d.ts                                          */
/* ------------------------------------------------------------------------- */

const D20_DEFINITION: DieDefinition = {
  sides: 20,
  resultMode: "top-face",
  vertices: D20_VERTICES,
  faces: D20_FACES.map((face) => ({
    number: face.number,
    indices: face.indices,
    vertices: face.vertices,
    centroid: face.centroid,
    normal: face.normal,
    labelUp: face.labelUp,
    labelRight: face.labelRight,
  })),
  edges: D20_EDGE_INDICES,
  inradius: DIE_INRADIUS,
};

export const DIE_DEFINITIONS: Partial<
  Record<BuiltDieSides, DieDefinition>
> = {
  4: D4_DEFINITION,
  6: D6_DEFINITION,
  8: D8_DEFINITION,
  10: D10_DEFINITION,
  12: D12_DEFINITION,
  20: D20_DEFINITION,
};

export const PHYSICAL_DIE_SIDES: readonly BuiltDieSides[] = [
  4, 6, 8, 10, 12, 20,
];

/** d100 también tiene física, pero se simula como dos d10. */
export function isPhysicalDieSides(sides: DiceSides): boolean {
  return sides === 100 || PHYSICAL_DIE_SIDES.includes(sides as BuiltDieSides);
}

export function getDieDefinition(sides: BuiltDieSides): DieDefinition {
  const definition = DIE_DEFINITIONS[sides];
  if (!definition) {
    throw new Error(`No hay geometría física para el d${sides}`);
  }
  return definition;
}

/** Altura del centro cuando el dado descansa sobre una cara. */
export function restHeight(definition: DieDefinition, scale: number): number {
  return definition.inradius * scale;
}

/** d100 = dos d10: decenas 00-90 + unidades 0-9; 00+0 se lee como 100. */
export function combineD100(tensFace: number, unitsFace: number): number {
  const tens = (tensFace % 10) * 10;
  const units = unitsFace % 10;
  const value = tens + units;
  return value === 0 ? 100 : value;
}

/** Etiqueta de una cara del d10 de decenas: 00, 10, ..., 90. */
export function d100TensLabel(face: number): string {
  return String((face % 10) * 10).padStart(2, "0");
}

/** Etiqueta de una cara del d10 de unidades: 0..9. */
export function d100UnitsLabel(face: number): string {
  return String(face % 10);
}
