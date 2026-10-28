import { Vector3 } from "three";
import {
  D20_EDGE_INDICES,
  D20_FACES as SHARED_FACES,
  D20_VERTICES,
  DIE_INRADIUS,
  DIE_REST_Y,
  DIE_SCALE,
  type Vec3,
} from "@protocol-life/shared";

/**
 * Adaptador de la geometría compartida del d20 a objetos de three.
 *
 * La fuente de verdad (vértices, caras, numeración, etiquetas y escala) vive en
 * `@protocol-life/shared`; el servidor la usa para la física y el cliente para
 * la malla. Aquí solo se envuelve en `Vector3` y se exponen las constantes de
 * la mesa que necesita la escena.
 */

export { DIE_INRADIUS, DIE_REST_Y, DIE_SCALE };

export interface D20Face {
  readonly number: number;
  readonly vertices: readonly [Vector3, Vector3, Vector3];
  readonly centroid: Vector3;
  readonly normal: Vector3;
  readonly labelUp: Vector3;
  readonly labelRight: Vector3;
}

function toVector(value: Vec3): Vector3 {
  return new Vector3(value[0], value[1], value[2]);
}

export const D20_FACES: readonly D20Face[] = SHARED_FACES.map((face) => ({
  number: face.number,
  vertices: [
    toVector(face.vertices[0]),
    toVector(face.vertices[1]),
    toVector(face.vertices[2]),
  ],
  centroid: toVector(face.centroid),
  normal: toVector(face.normal),
  labelUp: toVector(face.labelUp),
  labelRight: toVector(face.labelRight),
}));

const BY_NUMBER = new Map(D20_FACES.map((face) => [face.number, face]));

export function faceForNumber(number: number): D20Face {
  const face = BY_NUMBER.get(number);
  if (!face) throw new Error(`El d20 no tiene cara ${number}`);
  return face;
}

/** Las 30 aristas, con los vértices compartidos. */
export const D20_EDGES: ReadonlyArray<readonly [Vector3, Vector3]> =
  D20_EDGE_INDICES.map(([ia, ib]) => {
    const a = D20_VERTICES[ia];
    const b = D20_VERTICES[ib];
    if (!a || !b) throw new Error("Arista del d20 con índice inválido");
    return [toVector(a), toVector(b)] as const;
  });

/** Cámara cenital en ángulo de la mesa. */
export const TABLE_CAMERA_POS = new Vector3(0, 4.6, 3.4);
export const TABLE_CAMERA_TARGET = new Vector3(0, 0.2, 0);
