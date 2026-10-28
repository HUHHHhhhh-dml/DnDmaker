import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD_PX, throwFromDrag } from "./diceThrow";

describe("gesto de lanzamiento", () => {
  it("un clic o un movimiento mínimo no es un lanzamiento", () => {
    expect(throwFromDrag(0, 0)).toBeNull();
    expect(throwFromDrag(5, 4)).toBeNull();
    expect(throwFromDrag(DRAG_THRESHOLD_PX - 1, 0)).toBeNull();
  });

  it("arrastrar a la derecha lanza a la derecha y arranca a la izquierda", () => {
    const input = throwFromDrag(80, 0);
    expect(input).not.toBeNull();
    expect(input!.velocity![0]).toBeGreaterThan(0);
    expect(input!.velocity![1]).toBeLessThan(0);
    expect(input!.start![0]).toBeLessThan(0);
  });

  it("arrastrar hacia arriba lanza hacia el fondo de la mesa", () => {
    const input = throwFromDrag(0, -80);
    expect(input).not.toBeNull();
    expect(input!.velocity![2]).toBeLessThan(0);
    expect(input!.start![1]).toBeGreaterThan(0);
  });

  it("a más distancia, más fuerza", () => {
    const soft = throwFromDrag(25, 0)!;
    const hard = throwFromDrag(MAX_DRAG_FOR_TEST, 0)!;
    expect(Math.abs(hard.velocity![0])).toBeGreaterThan(
      Math.abs(soft.velocity![0]),
    );
    expect(Math.abs(hard.angular![1])).toBeGreaterThan(
      Math.abs(soft.angular![1]),
    );
  });

  it("respeta los límites del schema del servidor", () => {
    const input = throwFromDrag(500, 500)!;
    expect(Math.abs(input.velocity![0])).toBeLessThanOrEqual(10);
    expect(Math.abs(input.velocity![1])).toBeLessThanOrEqual(10);
    expect(Math.abs(input.velocity![2])).toBeLessThanOrEqual(10);
    expect(Math.abs(input.angular![0])).toBeLessThanOrEqual(40);
    expect(Math.abs(input.angular![1])).toBeLessThanOrEqual(40);
    expect(Math.abs(input.angular![2])).toBeLessThanOrEqual(40);
    expect(Math.abs(input.start![0])).toBeLessThanOrEqual(3);
    expect(Math.abs(input.start![1])).toBeLessThanOrEqual(3);
  });
});

const MAX_DRAG_FOR_TEST = 300;
