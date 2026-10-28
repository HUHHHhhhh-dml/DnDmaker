import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from "three";

/**
 * Atlas de las 20 etiquetas del d20, generado con canvas 2D.
 *
 * Cada cara usa un tile de 256×256 dentro de un atlas de 1280×1024 (5×4). El
 * triángulo útil de cada tile deja un 10 % de margen para evitar sangrado entre
 * mips. El vértice superior del triángulo es el "arriba" de la etiqueta y se
 * corresponde con `D20Face.labelUp`.
 *
 * No hay fuentes ni imágenes externas: solo `fillText` con una fuente de
 * sistema y un subrayado para el 6 y el 9.
 */

const COLUMNS = 5;
const ROWS = 4;
const TILE = 256;
const ATLAS_WIDTH = COLUMNS * TILE;
const ATLAS_HEIGHT = ROWS * TILE;

const FACE_BACKGROUND = "#d8cbb0";
const FACE_INK = "#1b160f";

/** Triángulo de la etiqueta dentro de cada tile, en UV local (v hacia arriba). */
const LABEL_TRIANGLE_UV: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0.1],
  [0.9, 0.1],
  [0.5, 0.9],
];

/** UVs de los tres vértices de la cara `number` (1..20), en el atlas completo. */
export function faceUv(number: number): Array<[number, number]> {
  const index = number - 1;
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const baseU = column / COLUMNS;
  // El canvas crece hacia abajo; la UV crece hacia arriba.
  const baseV = 1 - (row + 1) / ROWS;

  return LABEL_TRIANGLE_UV.map(
    ([u, v]) => [baseU + u / COLUMNS, baseV + v / ROWS] as [number, number],
  );
}

/** Crea la textura del atlas. Solo se llama dentro de la escena 3D (browser). */
export function createD20Atlas(anisotropy = 1): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_HEIGHT;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear el canvas del atlas del d20");

  const fontSize = Math.round(TILE * 0.27);

  for (let number = 1; number <= 20; number += 1) {
    const index = number - 1;
    const x = (index % COLUMNS) * TILE;
    const y = Math.floor(index / COLUMNS) * TILE;

    context.fillStyle = FACE_BACKGROUND;
    context.fillRect(x, y, TILE, TILE);

    // Luz muy leve de arriba a abajo: la iluminación 3D hace el resto.
    const gradient = context.createLinearGradient(x, y, x, y + TILE);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.10)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.10)");
    context.fillStyle = gradient;
    context.fillRect(x, y, TILE, TILE);

    context.fillStyle = FACE_INK;
    context.font = `900 ${fontSize}px "Arial Black", "Liberation Sans", "DejaVu Sans", Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(number), x + TILE * 0.5, y + TILE * 0.635);

    if (number === 6 || number === 9) {
      context.strokeStyle = FACE_INK;
      context.lineWidth = Math.max(3, TILE * 0.018);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(x + TILE * 0.4, y + TILE * 0.735);
      context.lineTo(x + TILE * 0.6, y + TILE * 0.735);
      context.stroke();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
