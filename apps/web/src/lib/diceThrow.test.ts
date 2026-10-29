import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  MAX_DRAG_PX,
  bouncesForDrag,
  dragForce,
  throwFromDrag,
} from "./diceThrow";

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

  it("a más distancia, más fuerza y más rebotes", () => {
    const soft = throwFromDrag(25, 0)!;
    const hard = throwFromDrag(MAX_DRAG_PX, 0)!;
    expect(Math.abs(hard.velocity![0])).toBeGreaterThan(
      Math.abs(soft.velocity![0]),
    );
    expect(Math.abs(hard.angular![1])).toBeGreaterThan(
      Math.abs(soft.angular![1]),
    );
    expect(hard.bounces).toBe(4);
    expect(soft.bounces).toBeLessThanOrEqual(hard.bounces!);
  });

  it("la fuerza va de 0 a 1 y nunca se pasa del máximo", () => {
    expect(dragForce(0, 0)).toBe(0);
    expect(dragForce(MAX_DRAG_PX, 0)).toBe(1);
    expect(dragForce(MAX_DRAG_PX * 3, 0)).toBe(1);
    expect(dragForce(Number.NaN, 0)).toBe(0);
  });

  it("mapea 1..4 rebotes de forma monótona y llega a 4 en el máximo", () => {
    const distances = [0, 10, 20, 30, 50, 70, 90, 110, 125, 140];
    let previous = 0;
    for (const distance of distances) {
      const bounces = bouncesForDrag(distance, 0);
      expect(bounces).toBeGreaterThanOrEqual(1);
      expect(bounces).toBeLessThanOrEqual(4);
      expect(bounces).toBeGreaterThanOrEqual(previous);
      previous = bounces;
    }
    expect(bouncesForDrag(DRAG_THRESHOLD_PX, 0)).toBe(1);
    expect(bouncesForDrag(MAX_DRAG_PX, 0)).toBe(4);
    expect(bouncesForDrag(MAX_DRAG_PX * 2, 0)).toBe(4);
    expect(bouncesForDrag(0, MAX_DRAG_PX)).toBe(4);
    expect(
      new Set([10, 50, 90, 140].map((distance) => bouncesForDrag(distance, 0)))
        .size,
    ).toBe(4);
  });

  it("el gesto incluye bounces en la condición inicial", () => {
    for (const distance of [MAX_DRAG_PX / 4, MAX_DRAG_PX / 2, MAX_DRAG_PX]) {
      const input = throwFromDrag(distance, 0)!;
      expect(input.bounces).toBe(bouncesForDrag(distance, 0));
    }
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
    expect(input.bounces).toBeLessThanOrEqual(4);
    expect(input.bounces).toBeGreaterThanOrEqual(1);
  });
});
