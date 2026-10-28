import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  D20_EDGES,
  D20_FACES,
  DIE_INRADIUS,
  DIE_REST_Y,
  DIE_SCALE,
  TABLE_CAMERA_POS,
  TABLE_CAMERA_TARGET,
  faceForNumber,
} from "./geometry";

describe("adaptador de geometría del d20", () => {
  it("envuelve las 20 caras numeradas 1..20", () => {
    expect(D20_FACES).toHaveLength(20);
    for (let number = 1; number <= 20; number += 1) {
      expect(faceForNumber(number).number).toBe(number);
    }
  });

  it("mantiene las caras opuestas sumando 21", () => {
    for (const face of D20_FACES) {
      const opposite = faceForNumber(21 - face.number);
      expect(face.normal.dot(opposite.normal)).toBeCloseTo(-1, 6);
    }
  });

  it("los vértices están a radio 1 y el winding mira hacia fuera", () => {
    for (const face of D20_FACES) {
      for (const vertex of face.vertices) {
        expect(vertex.length()).toBeCloseTo(1, 6);
      }
      const [a, b, c] = face.vertices;
      const winding = new Vector3()
        .subVectors(b, a)
        .cross(new Vector3().subVectors(c, a))
        .normalize();
      expect(winding.dot(face.normal)).toBeCloseTo(1, 6);
      expect(face.normal.length()).toBeCloseTo(1, 6);
    }
  });

  it("las bases de la etiqueta son ortonormales", () => {
    for (const face of D20_FACES) {
      expect(face.labelUp.dot(face.normal)).toBeCloseTo(0, 6);
      expect(face.labelRight.dot(face.normal)).toBeCloseTo(0, 6);
      expect(face.labelUp.dot(face.labelRight)).toBeCloseTo(0, 6);
      expect(face.labelUp.length()).toBeCloseTo(1, 6);
      expect(face.labelRight.length()).toBeCloseTo(1, 6);
    }
  });

  it("expone las 30 aristas con vértices de radio 1", () => {
    expect(D20_EDGES).toHaveLength(30);
    for (const [a, b] of D20_EDGES) {
      expect(a.length()).toBeCloseTo(1, 6);
      expect(b.length()).toBeCloseTo(1, 6);
    }
  });

  it("la cámara mira la mesa y la altura de reposo es el inradio escalado", () => {
    expect(TABLE_CAMERA_POS.y).toBeGreaterThan(TABLE_CAMERA_POS.z);
    expect(TABLE_CAMERA_TARGET.y).toBeGreaterThanOrEqual(0);
    expect(DIE_REST_Y).toBeCloseTo(DIE_INRADIUS * DIE_SCALE, 9);
  });
});
