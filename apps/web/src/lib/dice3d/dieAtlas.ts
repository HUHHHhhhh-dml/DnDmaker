import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from "three";
import {
  d100TensLabel,
  d100UnitsLabel,
  type DieDefinition,
  type DieFace,
} from "@protocol-life/shared";
import type { DiceSkin } from "../diceSkin";

/**
 * Atlas y malla genéricos para cualquier dado.
 *
 * Cada cara se proyecta sobre su base 2D (`labelRight`/`labelUp`) y se mapea a
 * un tile del atlas. El número se dibuja en el tile en la misma posición 2D, así
 * que la UV y la etiqueta quedan alineadas para triángulos, cuadrados,
 * pentágonos y cometas.
 *
 * En el d4 no hay un número por cara: cada cara lleva tres números, uno junto a
 * cada vértice; el resultado es el vértice que queda arriba.
 */

const TILE = 256;

export type DieLabelMode = "face" | "vertex" | "d100-tens" | "d100-units";

export interface DieAtlasLayout {
  /** UVs por cara, en el mismo orden que `definition.faces`. */
  uvs: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** Puntos 2D normalizados dentro del tile, por cara. */
  projections: ReadonlyArray<TileProjection>;
  columns: number;
  rows: number;
}

export interface DieAtlas extends DieAtlasLayout {
  texture: CanvasTexture;
}

interface TileProjection {
  /** Puntos normalizados dentro del tile, en orden de vértices de la cara. */
  points: ReadonlyArray<readonly [number, number]>;
}

function labelsForFace(face: DieFace, mode: DieLabelMode): string[] {
  if (mode === "d100-tens") return [d100TensLabel(face.number)];
  if (mode === "d100-units") return [d100UnitsLabel(face.number)];
  if (face.vertexLabels && face.vertexLabels.length > 0) {
    return face.vertexLabels.map((value) => String(value));
  }
  return [String(face.number)];
}

function projectFace(face: DieFace): TileProjection {
  const [cx, cy, cz] = face.centroid;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const raw = face.vertices.map(([x, y, z]) => {
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const u =
      dx * face.labelRight[0] +
      dy * face.labelRight[1] +
      dz * face.labelRight[2];
    const v =
      dx * face.labelUp[0] +
      dy * face.labelUp[1] +
      dz * face.labelUp[2];
    minX = Math.min(minX, u);
    maxX = Math.max(maxX, u);
    minY = Math.min(minY, v);
    maxY = Math.max(maxY, v);
    return [u, v] as const;
  });

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const span = Math.max(spanX, spanY, 1e-6);
  const padding = 0.11;
  const scale = (1 - padding * 2) / span;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    points: raw.map(([u, v]) => [
      0.5 + (u - centerX) * scale,
      0.5 + (v - centerY) * scale,
    ]),
  };
}

function tileGrid(faceCount: number): { columns: number; rows: number } {
  const columns = faceCount <= 4 ? 2 : Math.min(5, faceCount);
  return { columns, rows: Math.ceil(faceCount / columns) };
}

/**
 * Calcula la rejilla y las UVs sin tocar el canvas: sirve para tests y para
 * compartir la disposición entre la textura y la malla.
 */
export function layoutDieAtlas(definition: DieDefinition): DieAtlasLayout {
  const { columns, rows } = tileGrid(definition.faces.length);
  const projections = definition.faces.map(projectFace);
  const uvs: Array<Array<readonly [number, number]>> = [];

  definition.faces.forEach((_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const baseU = column / columns;
    const baseV = 1 - (row + 1) / rows;
    const projection = projections[index]!;
    uvs.push(
      projection.points.map(
        ([u, v]) => [baseU + u / columns, baseV + v / rows] as const,
      ),
    );
  });

  return { columns, rows, projections, uvs };
}

/**
 * Calcula la textura y las UVs. Solo se llama en el navegador (canvas 2D).
 */
export function createDieAtlas(
  definition: DieDefinition,
  skin: DiceSkin,
  mode: DieLabelMode,
  anisotropy = 8,
): DieAtlas {
  const layout = layoutDieAtlas(definition);
  const { columns, rows, projections, uvs } = layout;
  const canvas = document.createElement("canvas");
  canvas.width = columns * TILE;
  canvas.height = rows * TILE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear el canvas del atlas del dado");

  definition.faces.forEach((face, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * TILE;
    const y = row * TILE;
    const projection = projections[index]!;

    context.fillStyle = skin.faceBackground;
    context.fillRect(x, y, TILE, TILE);
    const gradient = context.createLinearGradient(x, y, x, y + TILE);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.10)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.10)");
    context.fillStyle = gradient;
    context.fillRect(x, y, TILE, TILE);

    const labels = labelsForFace(face, mode);
    context.fillStyle = skin.faceInk;
    context.textAlign = "center";
    context.textBaseline = "middle";

    if (labels.length === 1) {
      const text = labels[0]!;
      const fontSize = Math.round(TILE * (text.length >= 2 ? 0.21 : 0.27));
      context.font = `900 ${fontSize}px "Arial Black", "Liberation Sans", "DejaVu Sans", Arial, sans-serif`;
      context.fillText(text, x + TILE * 0.5, y + TILE * 0.5);
      return;
    }

    // d4: un número junto a cada vértice de la cara.
    labels.forEach((text, labelIndex) => {
      const point = projection.points[labelIndex];
      if (!point) return;
      const u = 0.5 + (point[0] - 0.5) * 0.55;
      const v = 0.5 + (point[1] - 0.5) * 0.55;
      const fontSize = Math.round(TILE * 0.15);
      context.font = `900 ${fontSize}px "Arial Black", "Liberation Sans", "DejaVu Sans", Arial, sans-serif`;
      context.fillText(text, x + u * TILE, y + (1 - v) * TILE);
    });
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  return { texture, ...layout };
}

/** Malla del dado: triángulos de cada cara con sus UVs. */
export function buildDieGeometry(
  definition: DieDefinition,
  uvs: DieAtlas["uvs"],
): BufferGeometry {
  const positions: number[] = [];
  const textureCoordinates: number[] = [];

  definition.faces.forEach((face, faceIndex) => {
    const faceUvs = uvs[faceIndex];
    if (!faceUvs || faceUvs.length !== face.vertices.length) {
      throw new Error(`Faltan UVs para la cara ${faceIndex + 1}`);
    }
    for (let corner = 1; corner < face.vertices.length - 1; corner += 1) {
      for (const index of [0, corner, corner + 1]) {
        const vertex = face.vertices[index]!;
        positions.push(vertex[0], vertex[1], vertex[2]);
        const uv = faceUvs[index]!;
        textureCoordinates.push(uv[0], uv[1]);
      }
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    "uv",
    new Float32BufferAttribute(textureCoordinates, 2),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Aristas del dado, ligeramente separadas para que no haya z-fighting. */
export function buildDieEdgeGeometry(
  definition: DieDefinition,
): BufferGeometry {
  const positions: number[] = [];
  for (const [a, b] of definition.edges) {
    const va = definition.vertices[a];
    const vb = definition.vertices[b];
    if (!va || !vb) continue;
    positions.push(va[0] * 1.003, va[1] * 1.003, va[2] * 1.003);
    positions.push(vb[0] * 1.003, vb[1] * 1.003, vb[2] * 1.003);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Etiqueta flotante del resultado en tiradas múltiples. */
export function createResultLabelTexture(
  text: string,
  skin: DiceSkin,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear la etiqueta del resultado");

  context.beginPath();
  context.roundRect(6, 6, 244, 116, 22);
  context.fillStyle = skin.labelBackground;
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = `#${skin.edgeColor.toString(16).padStart(6, "0")}`;
  context.stroke();

  context.fillStyle = skin.labelInk;
  const fontSize = text.length >= 3 ? 58 : text.length === 2 ? 70 : 78;
  context.font = `900 ${fontSize}px "Arial Black", "Liberation Sans", "DejaVu Sans", Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 128, 68);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
