import { describe, expect, it } from "vitest";
import type { DiceTrajectory } from "@protocol-life/shared";
import {
  celebrationSoundSpec,
  collectImpactSounds,
  impactSoundProfile,
  panForImpact,
  pitchForSides,
} from "./diceSound";

function trajectory(
  impacts: Array<{ atMs: number; x: number; strength: number }>,
): DiceTrajectory {
  return {
    frames: [
      { p: [0, 1, 0], q: [0, 0, 0, 1] },
      { p: [0, 0.18, 0], q: [0, 0, 0, 1] },
    ],
    durationMs: 1000,
    face: 1,
    impacts: impacts.map((impact) => ({ ...impact, z: 0 })),
    bounces: Math.max(0, impacts.length - 1),
  };
}

describe("sonido de dados", () => {
  it("ordena los impactos y los panea según la mesa", () => {
    const sounds = collectImpactSounds([
      trajectory([
        { atMs: 800, x: 1.2, strength: 0.4 },
        { atMs: 200, x: -1.2, strength: 1 },
      ]),
      trajectory([{ atMs: 500, x: 0, strength: 0.6 }]),
    ]);
    expect(sounds.map((sound) => sound.atMs)).toEqual([200, 500, 800]);
    expect(sounds[0]!.pan).toBeLessThan(0);
    expect(sounds[2]!.pan).toBeGreaterThan(0);
    expect(sounds[1]!.pan).toBeCloseTo(0, 6);
    for (const sound of sounds) {
      expect(sound.strength).toBeGreaterThanOrEqual(0);
      expect(sound.strength).toBeLessThanOrEqual(1);
      expect(Math.abs(sound.pan)).toBeLessThanOrEqual(0.55);
    }
  });

  it("acota el número de impactos cuando hay muchos dados", () => {
    const impacts = Array.from({ length: 200 }, (_, index) => ({
      atMs: index * 10,
      x: (index % 2 === 0 ? -1 : 1) * 0.5,
      strength: 0.5,
    }));
    const sounds = collectImpactSounds([trajectory(impacts)]);
    expect(sounds).toHaveLength(28);
    expect(sounds[0]!.atMs).toBe(0);
    for (let index = 1; index < sounds.length; index += 1) {
      expect(sounds[index]!.atMs).toBeGreaterThanOrEqual(
        sounds[index - 1]!.atMs,
      );
    }
  });

  it("los dados pequeños suenan más agudos y los perfiles son razonables", () => {
    expect(pitchForSides(4)).toBeGreaterThan(pitchForSides(20));
    expect(pitchForSides(20)).toBeGreaterThan(0);
    for (const sides of [4, 6, 8, 10, 12, 20, 100] as const) {
      const soft = impactSoundProfile(0, sides);
      const hard = impactSoundProfile(1, sides);
      expect(soft.gain).toBeGreaterThan(0);
      expect(hard.gain).toBeGreaterThan(soft.gain);
      expect(hard.decay).toBeGreaterThan(soft.decay);
      expect(soft.pitch).toBeGreaterThan(0);
      expect(hard.pitch).toBeGreaterThan(soft.pitch);
    }
  });

  it("el paneo se mantiene dentro de [-1, 1]", () => {
    expect(panForImpact(-100)).toBeCloseTo(-0.55, 6);
    expect(panForImpact(100)).toBeCloseTo(0.55, 6);
    expect(panForImpact(0)).toBe(0);
  });
});


describe("celebraciones de Nat 20 y Nat 1", () => {
  it("el Nat 20 es un arpegio ascendente y brillante", () => {
    const notes = celebrationSoundSpec("nat20");
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < notes.length; index += 1) {
      const note = notes[index]!;
      expect(note.frequency).toBeGreaterThan(500);
      expect(note.gain).toBeGreaterThan(0);
      expect(note.duration).toBeGreaterThan(0);
      expect(note.at).toBeGreaterThanOrEqual(0);
      if (index > 0) {
        expect(note.frequency).toBeGreaterThan(notes[index - 1]!.frequency);
        expect(note.at).toBeGreaterThanOrEqual(notes[index - 1]!.at);
      }
    }
    const total = Math.max(...notes.map((note) => note.at + note.duration));
    expect(total).toBeLessThan(2.2);
  });

  it("el Nat 1 es un golpe grave descendente", () => {
    const notes = celebrationSoundSpec("nat1");
    expect(notes.length).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < notes.length; index += 1) {
      const note = notes[index]!;
      expect(note.frequency).toBeLessThanOrEqual(100);
      expect(note.gain).toBeGreaterThan(0);
      expect(note.duration).toBeGreaterThan(0);
      if (index > 0) {
        expect(note.frequency).toBeLessThan(notes[index - 1]!.frequency);
      }
    }
    const total = Math.max(...notes.map((note) => note.at + note.duration));
    expect(total).toBeLessThan(1.5);
  });
});
