import { describe, expect, it } from "vitest";
import {
  getDieDefinition,
  type BuiltDieSides,
} from "@protocol-life/shared";
import { layoutDieAtlas } from "./dieAtlas";

/**
 * Disposición 2D del atlas: cada cara cae en su tile, con el "arriba" de la
 * etiqueta hacia +V y sin salirse de la textura. No necesita canvas.
 */

const SIDES: readonly BuiltDieSides[] = [4, 6, 8, 10, 12, 20];

describe("layout del atlas por dado", () => {
  for (const sides of SIDES) {
    it(`mapea las ${sides} caras del d${sides} dentro de su tile`, () => {
      const definition = getDieDefinition(sides);
      const layout = layoutDieAtlas(definition);
      expect(layout.uvs).toHaveLength(definition.faces.length);
      expect(layout.projections).toHaveLength(definition.faces.length);
      expect(layout.columns).toBeGreaterThan(0);
      expect(layout.rows).toBeGreaterThan(0);

      layout.uvs.forEach((faceUvs, index) => {
        const face = definition.faces[index]!;
        expect(faceUvs).toHaveLength(face.vertices.length);
        const column = index % layout.columns;
        const row = Math.floor(index / layout.columns);
        const u0 = column / layout.columns;
        const u1 = (column + 1) / layout.columns;
        const v0 = 1 - (row + 1) / layout.rows;
        const v1 = 1 - row / layout.rows;

        for (const [u, v] of faceUvs) {
          expect(u).toBeGreaterThanOrEqual(u0 - 1e-9);
          expect(u).toBeLessThanOrEqual(u1 + 1e-9);
          expect(v).toBeGreaterThanOrEqual(v0 - 1e-9);
          expect(v).toBeLessThanOrEqual(v1 + 1e-9);
        }

        // El vértice más "arriba" en la base 2D debe quedar en la mitad
        // superior del tile: la etiqueta no sale girada.
        const projection = layout.projections[index]!;
        const maxV = Math.max(...projection.points.map(([, v]) => v));
        expect(maxV).toBeGreaterThan(0.55);
      });
    });
  }

  it("el d4 lleva tres etiquetas de vértice por cara", () => {
    const definition = getDieDefinition(4);
    expect(definition.resultMode).toBe("top-vertex");
    for (const face of definition.faces) {
      expect(face.vertexLabels).toHaveLength(3);
    }
  });
});
