import { describe, expect, it } from "vitest";
import {
  D20_EDGE_INDICES,
  D20_FACES,
  D20_VERTICES,
  DIE_INRADIUS,
  DIE_REST_Y,
  DIE_SCALE,
  d20Face,
} from "./dice3d";

function sub(a: readonly number[], b: readonly number[]) {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!] as const;
}

function cross(a: readonly number[], b: readonly number[]) {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ] as const;
}

function dot(a: readonly number[], b: readonly number[]) {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function length(a: readonly number[]) {
  return Math.hypot(a[0]!, a[1]!, a[2]!);
}

describe("geometría compartida del d20", () => {
  it("tiene 20 caras numeradas 1..20 y la cara n está en n-1", () => {
    expect(D20_FACES).toHaveLength(20);
    expect(D20_FACES.map((face) => face.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    for (let number = 1; number <= 20; number += 1) {
      expect(d20Face(number)).toBe(D20_FACES[number - 1]);
    }
  });

  it("las caras opuestas suman 21", () => {
    for (const face of D20_FACES) {
      const opposite = d20Face(21 - face.number);
      expect(dot(face.normal, opposite.normal)).toBeCloseTo(-1, 6);
    }
  });

  it("los vértices están a radio 1 y los índices apuntan a ellos", () => {
    for (const vertex of D20_VERTICES) {
      expect(length(vertex)).toBeCloseTo(1, 6);
    }
    expect(D20_VERTICES).toHaveLength(12);
    for (const face of D20_FACES) {
      face.indices.forEach((index, position) => {
        expect(D20_VERTICES[index]).toEqual(face.vertices[position]);
      });
    }
  });

  it("cada cara tiene winding CCW hacia fuera y normal unitaria", () => {
    for (const face of D20_FACES) {
      const [a, b, c] = face.vertices;
      const winding = cross(sub(b, a), sub(c, a));
      expect(dot(winding, face.normal)).toBeGreaterThan(0);
      expect(length(face.normal)).toBeCloseTo(1, 6);
      expect(dot(face.normal, face.centroid)).toBeGreaterThan(0);
    }
  });

  it("las bases de la etiqueta son ortonormales y están en el plano de la cara", () => {
    for (const face of D20_FACES) {
      expect(dot(face.labelUp, face.normal)).toBeCloseTo(0, 6);
      expect(dot(face.labelRight, face.normal)).toBeCloseTo(0, 6);
      expect(dot(face.labelUp, face.labelRight)).toBeCloseTo(0, 6);
      expect(length(face.labelUp)).toBeCloseTo(1, 6);
      expect(length(face.labelRight)).toBeCloseTo(1, 6);
    }
  });

  it("tiene las 30 aristas únicas y sus índices son válidos", () => {
    expect(D20_EDGE_INDICES).toHaveLength(30);
    const keys = new Set(
      D20_EDGE_INDICES.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)),
    );
    expect(keys.size).toBe(30);
    for (const [a, b] of D20_EDGE_INDICES) {
      expect(D20_VERTICES[a]).toBeDefined();
      expect(D20_VERTICES[b]).toBeDefined();
      expect(a).not.toBe(b);
    }
  });

  it("la altura de reposo es el inradio escalado", () => {
    expect(DIE_REST_Y).toBeCloseTo(DIE_INRADIUS * DIE_SCALE, 9);
  });
});
