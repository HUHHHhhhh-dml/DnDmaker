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

/**
 * Pinta una cara de basalto con grietas de lava. Es procedural y determinista
 * por número de cara: no necesita imágenes y no cambia entre renders.
 */
function drawLavaTile(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  baseColor: string,
  seed: number,
): void {
  const random = mulberry32(seed);
  context.save();
  context.beginPath();
  context.rect(x, y, size, size);
  context.clip();

  context.fillStyle = baseColor;
  context.fillRect(x, y, size, size);

  // Moteado de basalto: manchas claras y zonas en sombra.
  for (let index = 0; index < 46; index += 1) {
    const cx = x + random() * size;
    const cy = y + random() * size;
    const rx = size * (0.015 + random() * 0.08);
    const ry = size * (0.012 + random() * 0.07);
    context.beginPath();
    context.ellipse(cx, cy, rx, ry, random() * Math.PI, 0, Math.PI * 2);
    context.fillStyle =
      random() > 0.5
        ? `rgba(82, 64, 52, ${0.05 + random() * 0.08})`
        : `rgba(0, 0, 0, ${0.12 + random() * 0.16})`;
    context.fill();
  }

  const strokePath = (
    points: ReadonlyArray<readonly [number, number]>,
    width: number,
    color: string,
    blur: number,
  ): void => {
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = "#ff5a1f";
    context.shadowBlur = blur;
    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    points.forEach(([px, py], index) => {
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();
    context.restore();
  };

  const cracks = 4 + Math.floor(random() * 2);
  for (let crack = 0; crack < cracks; crack += 1) {
    const side = Math.floor(random() * 4);
    let px = x + random() * size;
    let py = y + random() * size;
    if (side === 0) px = x;
    else if (side === 1) px = x + size;
    else if (side === 2) py = y;
    else py = y + size;

    const tx = x + size * (0.3 + random() * 0.4);
    const ty = y + size * (0.3 + random() * 0.4);
    const segments = 7 + Math.floor(random() * 5);
    const step = Math.hypot(tx - px, ty - py) / segments;
    let angle = Math.atan2(ty - py, tx - px);
    const points: Array<[number, number]> = [[px, py]];
    for (let segment = 0; segment < segments; segment += 1) {
      angle += (random() - 0.5) * 1.1;
      px += Math.cos(angle) * step;
      py += Math.sin(angle) * step;
      points.push([px, py]);
    }

    strokePath(points, 7, "rgba(50, 14, 6, 0.95)", 10);
    strokePath(points, 3.4, "#ff5a1f", 8);
    strokePath(points, 1.3, "#ffd36a", 4);

    if (random() > 0.35) {
      const start = points[Math.floor(points.length * 0.4)]!;
      const branch: Array<[number, number]> = [[start[0], start[1]]];
      let bx = start[0];
      let by = start[1];
      let branchAngle =
        Math.atan2(ty - by, tx - bx) +
        (random() > 0.5 ? 1 : -1) * (0.8 + random() * 0.6);
      const branchStep = size * 0.06;
      for (let segment = 0; segment < 4; segment += 1) {
        branchAngle += (random() - 0.5) * 0.8;
        bx += Math.cos(branchAngle) * branchStep;
        by += Math.sin(branchAngle) * branchStep;
        branch.push([bx, by]);
      }
      strokePath(branch, 4.5, "rgba(50, 14, 6, 0.9)", 8);
      strokePath(branch, 2.2, "#ff5a1f", 6);
      strokePath(branch, 0.9, "#ffd36a", 3);
    }
  }

  // Brasas sueltas.
  for (let index = 0; index < 14; index += 1) {
    const ex = x + random() * size;
    const ey = y + random() * size;
    const radius = 1 + random() * 2.6;
    context.save();
    context.shadowColor = "#ff6a1f";
    context.shadowBlur = 8;
    context.fillStyle = random() > 0.4 ? "#ff8a3c" : "#ffd36a";
    context.beginPath();
    context.arc(ex, ey, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  context.restore();
}

function drawLabel(
  context: CanvasRenderingContext2D,
  skin: DiceSkin,
  text: string,
  centerX: number,
  centerY: number,
  fontSize: number,
): void {
  context.font = `900 ${fontSize}px "Arial Black", "Liberation Sans", "DejaVu Sans", Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (skin.inkOutline) {
    context.save();
    context.strokeStyle = skin.inkOutline;
    context.lineWidth = Math.max(2, fontSize * 0.14);
    context.lineJoin = "round";
    context.strokeText(text, centerX, centerY);
    context.restore();
  }
  context.fillStyle = skin.faceInk;
  context.fillText(text, centerX, centerY);
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

    if (skin.pattern === "lava") {
      drawLavaTile(
        context,
        x,
        y,
        TILE,
        skin.faceBackground,
        face.number * 2654435761 + index * 97,
      );
    } else {
      context.fillStyle = skin.faceBackground;
      context.fillRect(x, y, TILE, TILE);
      const gradient = context.createLinearGradient(x, y, x, y + TILE);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.10)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.10)");
      context.fillStyle = gradient;
      context.fillRect(x, y, TILE, TILE);
    }

    const labels = labelsForFace(face, mode);

    if (labels.length === 1) {
      const text = labels[0]!;
      const fontSize = Math.round(TILE * (text.length >= 2 ? 0.21 : 0.27));
      drawLabel(
        context,
        skin,
        text,
        x + TILE * 0.5,
        y + TILE * 0.5,
        fontSize,
      );
      return;
    }

    // d4: un número junto a cada vértice de la cara.
    labels.forEach((text, labelIndex) => {
      const point = projection.points[labelIndex];
      if (!point) return;
      const u = 0.5 + (point[0] - 0.5) * 0.55;
      const v = 0.5 + (point[1] - 0.5) * 0.55;
      drawLabel(
        context,
        skin,
        text,
        x + u * TILE,
        y + (1 - v) * TILE,
        Math.round(TILE * 0.15),
      );
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
