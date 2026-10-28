import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { DIE_REST_Y, type DiceTrajectory } from "@protocol-life/shared";
import { sampleTrajectory } from "./trajectory";

function trajectory(): DiceTrajectory {
  const axis = new Vector3(0, 0, 1);
  const quarter = new Quaternion().setFromAxisAngle(axis, Math.PI / 4);
  const half = new Quaternion().setFromAxisAngle(axis, Math.PI / 2);
  return {
    frames: [
      { p: [0, 1, 0], q: [0, 0, 0, 1] },
      {
        p: [0, 0.5, 0],
        q: [quarter.x, quarter.y, quarter.z, quarter.w],
      },
      { p: [0, DIE_REST_Y, 0], q: [half.x, half.y, half.z, half.w] },
    ],
    durationMs: 1000,
    face: 17,
    impacts: [{ atMs: 500, x: 0, z: 0, strength: 1 }],
  };
}

describe("reproductor de trayectoria", () => {
  it("empieza en el primer frame", () => {
    const pose = sampleTrajectory(0, trajectory());
    expect(pose.position.toArray()).toEqual([0, 1, 0]);
    expect(pose.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-9);
  });

  it("interpola posición y orientación entre frames", () => {
    const pose = sampleTrajectory(250, trajectory());
    expect(pose.position.y).toBeCloseTo(0.75, 6);
    expect(pose.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0);
  });

  it("en el final copia exactamente el último frame de reposo", () => {
    const trajectoryData = trajectory();
    const pose = sampleTrajectory(1000, trajectoryData);
    expect(pose.position.y).toBeCloseTo(DIE_REST_Y, 9);
    expect(pose.shadowScale).toBeCloseTo(1, 9);
    expect(pose.shadowOpacity).toBeCloseTo(0.7, 9);
    expect(pose.contactGlow).toBeCloseTo(0.6, 9);
    expect(pose.glow).toBe(1);

    const final = trajectoryData.frames[2]!;
    expect(pose.quaternion.x).toBeCloseTo(final.q[0], 9);
    expect(pose.quaternion.y).toBeCloseTo(final.q[1], 9);
    expect(pose.quaternion.z).toBeCloseTo(final.q[2], 9);
    expect(pose.quaternion.w).toBeCloseTo(final.q[3], 9);
  });

  it("se queda en el último frame si el tiempo se pasa", () => {
    const pose = sampleTrajectory(5000, trajectory());
    expect(pose.position.y).toBeCloseTo(DIE_REST_Y, 9);
  });

  it("el anillo de impacto aparece y se desvanece", () => {
    const t = trajectory();
    expect(sampleTrajectory(400, t).ringOpacity).toBe(0);
    expect(sampleTrajectory(500, t).ringOpacity).toBeCloseTo(0.8, 6);
    expect(sampleTrajectory(600, t).ringOpacity).toBeGreaterThan(0);
    expect(sampleTrajectory(900, t).ringOpacity).toBe(0);
  });

  it("la sombra se pega a la mesa al reposar", () => {
    const pose = sampleTrajectory(1000, trajectory());
    expect(pose.shadowScale).toBeGreaterThan(0.9);
    expect(pose.shadowOpacity).toBeGreaterThan(0.5);
  });
});
