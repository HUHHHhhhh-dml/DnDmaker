import { describe, expect, it } from "vitest";
import {
  DIE_DEFINITIONS,
  PHYSICAL_DIE_SIDES,
  getDieDefinition,
  type BuiltDieSides,
  type DieDefinition,
} from "./diceGeometry";
import type { Vec3 } from "./dice3d";

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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
  if (magnitude === 0) throw new Error("vector nulo");
  return [
    vector[0] / magnitude,
    vector[1] / magnitude,
    vector[2] / magnitude,
  ];
}

function expectClose(
  value: number,
  expected: number,
  tolerance = 1e-6,
): void {
  expect(Math.abs(value - expected)).toBeLessThanOrEqual(tolerance);
}

const TOLERANCE = 1e-6;

interface DieCase {
  readonly sides: BuiltDieSides;
  readonly vertices: number;
  readonly faces: number;
  readonly edges: number;
  readonly resultMode: "top-face" | "top-vertex";
}

const DIE_CASES: readonly DieCase[] = [
  { sides: 4, vertices: 4, faces: 4, edges: 6, resultMode: "top-vertex" },
  { sides: 6, vertices: 8, faces: 6, edges: 12, resultMode: "top-face" },
  { sides: 8, vertices: 6, faces: 8, edges: 12, resultMode: "top-face" },
  { sides: 10, vertices: 12, faces: 10, edges: 20, resultMode: "top-face" },
  { sides: 12, vertices: 20, faces: 12, edges: 30, resultMode: "top-face" },
  { sides: 20, vertices: 12, faces: 20, edges: 30, resultMode: "top-face" },
];

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

for (const dieCase of DIE_CASES) {
  const definition: DieDefinition = getDieDefinition(dieCase.sides);

  describe(`d${dieCase.sides}`, () => {
    it("cumple la topología esperada (Euler)", () => {
      expect(definition.sides).toBe(dieCase.sides);
      expect(definition.resultMode).toBe(dieCase.resultMode);
      expect(definition.vertices).toHaveLength(dieCase.vertices);
      expect(definition.faces).toHaveLength(dieCase.faces);
      expect(definition.edges).toHaveLength(dieCase.edges);
      expect(
        definition.vertices.length -
          definition.edges.length +
          definition.faces.length,
      ).toBe(2);
    });

    it("numera las caras 1..N y el array respeta la numeración", () => {
      expect(definition.faces.map((face) => face.number)).toEqual(
        Array.from({ length: dieCase.faces }, (_, index) => index + 1),
      );
    });

    it("tiene todos los vértices a radio 1 y las caras apuntan a ellos", () => {
      for (const vertex of definition.vertices) {
        expect(Math.abs(length(vertex) - 1)).toBeLessThanOrEqual(TOLERANCE);
      }
      for (const face of definition.faces) {
        expect(face.indices.length).toBeGreaterThanOrEqual(3);
        face.indices.forEach((index, position) => {
          expect(definition.vertices[index]).toEqual(face.vertices[position]);
        });
      }
    });

    it("tiene normales unitarias, winding CCW y caras convexas", () => {
      for (const face of definition.faces) {
        expect(Math.abs(length(face.normal) - 1)).toBeLessThanOrEqual(
          TOLERANCE,
        );
        expect(dot(face.normal, face.centroid)).toBeGreaterThan(0);

        const first = face.vertices[0]!;
        const second = face.vertices[1]!;
        const third = face.vertices[2]!;
        const winding = cross(sub(second, first), sub(third, first));
        expect(dot(winding, face.normal)).toBeGreaterThan(0);

        for (let position = 0; position < face.vertices.length; position += 1) {
          const a = face.vertices[position]!;
          const b = face.vertices[(position + 1) % face.vertices.length]!;
          const c = face.vertices[(position + 2) % face.vertices.length]!;
          const turn = dot(cross(sub(b, a), sub(c, b)), face.normal);
          expect(turn).toBeGreaterThanOrEqual(-TOLERANCE);
        }
      }
    });

    it("las caras son planas", () => {
      for (const face of definition.faces) {
        for (const vertex of face.vertices) {
          const distance = dot(sub(vertex, face.centroid), face.normal);
          expect(Math.abs(distance)).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    });

    it("es convexo: ningún vértice queda fuera de una cara", () => {
      for (const face of definition.faces) {
        for (const vertex of definition.vertices) {
          const signed = dot(sub(vertex, face.centroid), face.normal);
          expect(signed).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    });

    it("la base de la etiqueta es ortonormal y está en el plano", () => {
      for (const face of definition.faces) {
        expect(Math.abs(length(face.labelUp) - 1)).toBeLessThanOrEqual(
          TOLERANCE,
        );
        expect(Math.abs(length(face.labelRight) - 1)).toBeLessThanOrEqual(
          TOLERANCE,
        );
        expect(Math.abs(dot(face.labelUp, face.normal))).toBeLessThanOrEqual(
          TOLERANCE,
        );
        expect(Math.abs(dot(face.labelRight, face.normal))).toBeLessThanOrEqual(
          TOLERANCE,
        );
        expect(
          Math.abs(dot(face.labelUp, face.labelRight)),
        ).toBeLessThanOrEqual(TOLERANCE);

        const expectedRight = normalize(cross(face.labelUp, face.normal));
        expect(dot(expectedRight, face.labelRight)).toBeCloseTo(1, 6);
      }
    });

    it("tiene aristas únicas, válidas y compartidas por dos caras", () => {
      const edges = new Map<string, number>();
      for (const face of definition.faces) {
        for (let position = 0; position < face.indices.length; position += 1) {
          const a = face.indices[position]!;
          const b = face.indices[(position + 1) % face.indices.length]!;
          const key = edgeKey(a, b);
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }

      expect(definition.edges).toHaveLength(dieCase.edges);
      const unique = new Set<string>();
      for (const [a, b] of definition.edges) {
        expect(a).not.toBe(b);
        expect(definition.vertices[a]).toBeDefined();
        expect(definition.vertices[b]).toBeDefined();
        unique.add(edgeKey(a, b));
      }
      expect(unique.size).toBe(dieCase.edges);

      for (const key of unique) {
        expect(edges.get(key)).toBe(2);
      }
    });

    it("tiene un inradio positivo igual al mínimo de las caras", () => {
      const minimum = Math.min(
        ...definition.faces.map((face) => dot(face.centroid, face.normal)),
      );
      expect(definition.inradius).toBeGreaterThan(0);
      if (dieCase.sides === 20) {
        // El d20 conserva DIE_INRADIUS = 0.794, redondeado a tres decimales en
        // dice3d.ts; el valor geométrico exacto es 0.794654...
        expectClose(definition.inradius, minimum, 1e-3);
      } else {
        expectClose(definition.inradius, minimum);
      }
    });

    if (dieCase.sides === 4) {
      it("asigna números de vértice y etiquetas coherentes", () => {
        expect(definition.vertexNumbers).toEqual([1, 2, 3, 4]);
        for (const face of definition.faces) {
          expect(face.vertexLabels).toHaveLength(3);
          const labels = face.vertexLabels!;
          expect(new Set(labels).size).toBe(3);
          face.indices.forEach((index, position) => {
            expect(labels[position]).toBe(definition.vertexNumbers![index]);
          });
        }
        expect(definition.inradius).toBeCloseTo(1 / 3, 6);
      });
    } else {
      it("las caras opuestas suman sides + 1", () => {
        for (const face of definition.faces) {
          const opposite = definition.faces[dieCase.sides - face.number];
          expect(opposite).toBeDefined();
          expect(opposite!.number).toBe(dieCase.sides + 1 - face.number);
          expect(dot(face.normal, opposite!.normal)).toBeCloseTo(-1, 6);
        }
      });
    }
  });
}

describe("formas específicas", () => {
  it("el d10 tiene 10 cometas de 4 vértices", () => {
    const d10 = getDieDefinition(10);
    expect(d10.faces).toHaveLength(10);
    for (const face of d10.faces) {
      expect(face.vertices).toHaveLength(4);
    }
  });

  it("el d12 tiene 12 pentágonos de 5 vértices", () => {
    const d12 = getDieDefinition(12);
    expect(d12.faces).toHaveLength(12);
    for (const face of d12.faces) {
      expect(face.vertices).toHaveLength(5);
    }
  });

  it("DIE_DEFINITIONS contiene todos los dados físicos", () => {
    expect(PHYSICAL_DIE_SIDES).toEqual([4, 6, 8, 10, 12, 20]);
    for (const sides of PHYSICAL_DIE_SIDES) {
      expect(DIE_DEFINITIONS[sides]).toBeDefined();
      expect(DIE_DEFINITIONS[sides]!.sides).toBe(sides);
    }
  });
});
