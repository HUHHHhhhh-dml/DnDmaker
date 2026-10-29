import {
  D20_TABLE_BOUNDS,
  type DiceSides,
  type DiceTrajectory,
} from "@protocol-life/shared";

/**
 * Sonido de los dados sintetizado con Web Audio: no hay ficheros ni
 * dependencias. Cada impacto de la trayectoria se convierte en un chasquido
 * con fuerza, tono y paneo, y el cliente lo programa contra el reloj de audio
 * para que suene sincronizado con la caída 3D.
 *
 * El módulo es seguro de importar en Node: el `AudioContext` se crea de forma
 * perezosa y solo dentro de funciones que se ejecutan en el navegador.
 */

const MAX_IMPACTS = 28;
const REMEMBER_LIMIT = 40;
const MASTER_VOLUME = 0.45;

let enabled = true;
let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let generation = 0;
const active = new Set<AudioScheduledSourceNode>();
const soundedRolls = new Set<string>();
const soundedCelebrations = new Set<string>();

export interface ImpactSound {
  atMs: number;
  strength: number;
  pan: number;
}

export interface SoundProfile {
  pitch: number;
  decay: number;
  gain: number;
}

export type CelebrationSoundKind = "nat20" | "nat1";

export interface CelebrationNote {
  /** Segundos desde el inicio de la celebración. */
  at: number;
  frequency: number;
  duration: number;
  gain: number;
  type: OscillatorType;
}

/** Melodía del Nat 20 (arpegio ascendente) o golpe grave del Nat 1. */
export function celebrationSoundSpec(
  kind: CelebrationSoundKind,
): CelebrationNote[] {
  if (kind === "nat20") {
    return [
      { at: 0, frequency: 1046.5, duration: 0.22, gain: 0.16, type: "sine" },
      { at: 0.08, frequency: 1318.51, duration: 0.25, gain: 0.14, type: "sine" },
      { at: 0.16, frequency: 1567.98, duration: 0.3, gain: 0.12, type: "triangle" },
      { at: 0.27, frequency: 2093, duration: 0.4, gain: 0.09, type: "sine" },
      { at: 0.4, frequency: 2637.02, duration: 0.45, gain: 0.05, type: "sine" },
    ];
  }
  return [
    { at: 0, frequency: 82.41, duration: 0.55, gain: 0.22, type: "sine" },
    { at: 0.03, frequency: 61.74, duration: 0.6, gain: 0.17, type: "triangle" },
    { at: 0.17, frequency: 49, duration: 0.45, gain: 0.11, type: "sine" },
    { at: 0.3, frequency: 41.2, duration: 0.35, gain: 0.07, type: "sine" },
  ];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Tono base según el dado: los pequeños suenan más agudos y secos. */
export function pitchForSides(sides: DiceSides): number {
  switch (sides) {
    case 4:
      return 2100;
    case 6:
      return 1600;
    case 8:
      return 1300;
    case 10:
      return 1100;
    case 12:
      return 950;
    case 20:
      return 780;
    case 100:
      return 1100;
    default:
      return 1000;
  }
}

export function impactSoundProfile(
  strength: number,
  sides: DiceSides,
): SoundProfile {
  const force = clamp01(strength);
  return {
    pitch: pitchForSides(sides) * (0.88 + force * 0.28),
    decay: 0.03 + force * 0.045,
    gain: 0.07 + force * 0.18,
  };
}

/** Paneo estéreo del impacto según su x sobre la mesa. */
export function panForImpact(x: number): number {
  return clamp(x / D20_TABLE_BOUNDS.x, -1, 1) * 0.55;
}

/**
 * Convierte los impactos de todas las trayectorias en una lista ordenada y
 * acotada. Con muchos dados se muestrea para no saturar el mezclador.
 */
export function collectImpactSounds(
  trajectories: readonly DiceTrajectory[],
): ImpactSound[] {
  const sounds: ImpactSound[] = [];
  for (const trajectory of trajectories) {
    for (const impact of trajectory.impacts) {
      sounds.push({
        atMs: Math.max(0, impact.atMs),
        strength: clamp01(impact.strength),
        pan: panForImpact(impact.x),
      });
    }
  }
  sounds.sort((a, b) => a.atMs - b.atMs);
  if (sounds.length <= MAX_IMPACTS) return sounds;

  const step = sounds.length / MAX_IMPACTS;
  return Array.from({ length: MAX_IMPACTS }, (_, index) => {
    const source =
      sounds[Math.min(sounds.length - 1, Math.floor(index * step))];
    return source ?? sounds[0]!;
  });
}

export function setDiceAudioEnabled(value: boolean): void {
  enabled = value;
  if (!value) {
    generation += 1;
    stopActiveSources();
  }
  if (context && master) {
    master.gain.setTargetAtTime(
      value ? MASTER_VOLUME : 0,
      context.currentTime,
      0.02,
    );
  }
}

export function isDiceAudioEnabled(): boolean {
  return enabled;
}

function track(source: AudioScheduledSourceNode): void {
  active.add(source);
  source.addEventListener("ended", () => active.delete(source));
}

function stopActiveSources(): void {
  for (const source of active) {
    try {
      source.stop();
    } catch {
      // Ya estaba parada.
    }
  }
  active.clear();
}

function rememberSounded(id: string): void {
  soundedRolls.add(id);
  if (soundedRolls.size <= REMEMBER_LIMIT) return;
  const oldest = soundedRolls.values().next().value;
  if (oldest !== undefined) soundedRolls.delete(oldest);
}

export function wasRollSounded(id: string): boolean {
  return soundedRolls.has(id);
}

function rememberCelebration(id: string): void {
  soundedCelebrations.add(id);
  if (soundedCelebrations.size <= REMEMBER_LIMIT) return;
  const oldest = soundedCelebrations.values().next().value;
  if (oldest !== undefined) soundedCelebrations.delete(oldest);
}

function createNoiseBuffer(audio: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(audio.sampleRate));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * 0.7;
  }
  return buffer;
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) {
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    return context;
  }

  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return null;

  try {
    const audio = new AudioContextClass();
    const compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 14;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    const output = audio.createGain();
    output.gain.value = enabled ? MASTER_VOLUME : 0;
    output.connect(compressor);
    compressor.connect(audio.destination);
    context = audio;
    master = output;
    noise = createNoiseBuffer(audio);
    return audio;
  } catch {
    context = null;
    master = null;
    noise = null;
    return null;
  }
}

/**
 * Desbloquea el audio dentro de un gesto del usuario (clic/arrastre). Los
 * navegadores no dejan sonar antes de una interacción.
 */
export async function unlockDiceAudio(): Promise<void> {
  const audio = ensureContext();
  if (audio?.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      // El navegador ha rechazado el desbloqueo; se reintentará en otro gesto.
    }
  }
}

function withContext(
  run: (
    audio: AudioContext,
    output: GainNode,
    noiseBuffer: AudioBuffer,
  ) => void,
): void {
  const audio = ensureContext();
  if (!audio || !master || !noise) return;
  if (audio.state === "running") {
    run(audio, master, noise);
    return;
  }
  void audio
    .resume()
    .then(() => {
      if (audio.state === "running" && master && noise) {
        run(audio, master, noise);
      }
    })
    .catch(() => undefined);
}

function playImpactAt(
  audio: AudioContext,
  output: GainNode,
  noiseBuffer: AudioBuffer,
  when: number,
  sound: ImpactSound,
  sides: DiceSides,
): void {
  const time = Math.max(when, audio.currentTime + 0.005);
  const profile = impactSoundProfile(sound.strength, sides);

  const panner =
    typeof audio.createStereoPanner === "function"
      ? audio.createStereoPanner()
      : null;
  if (panner) {
    panner.pan.value = sound.pan;
    panner.connect(output);
  }
  const sink = panner ?? output;

  const tone = audio.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(profile.pitch, time);
  tone.frequency.exponentialRampToValueAtTime(
    Math.max(60, profile.pitch * 0.55),
    time + profile.decay,
  );
  const toneGain = audio.createGain();
  toneGain.gain.setValueAtTime(0.0001, time);
  toneGain.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, profile.gain * 0.72),
    time + 0.003,
  );
  toneGain.gain.exponentialRampToValueAtTime(0.0001, time + profile.decay);
  tone.connect(toneGain);
  toneGain.connect(sink);
  tone.start(time);
  tone.stop(time + profile.decay + 0.03);
  track(tone);

  const crack = audio.createBufferSource();
  crack.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(profile.pitch * 1.6, time);
  filter.Q.value = 0.9;
  const crackGain = audio.createGain();
  crackGain.gain.setValueAtTime(0.0001, time);
  crackGain.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, profile.gain * 0.9),
    time + 0.002,
  );
  crackGain.gain.exponentialRampToValueAtTime(
    0.0001,
    time + profile.decay * 0.85,
  );
  crack.connect(filter);
  filter.connect(crackGain);
  crackGain.connect(sink);
  crack.start(time, Math.random() * 0.5, profile.decay * 1.2);
  crack.stop(time + profile.decay * 1.2);
  track(crack);
}

function playRollStartAt(
  audio: AudioContext,
  output: GainNode,
  noiseBuffer: AudioBuffer,
  time: number,
  count: number,
): void {
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(500, time);
  filter.frequency.exponentialRampToValueAtTime(1800, time + 0.16);
  const gain = audio.createGain();
  const volume = 0.035 + Math.min(0.03, count * 0.004);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  source.start(time, Math.random() * 0.4, 0.2);
  source.stop(time + 0.2);
  track(source);
}

function playSettleAt(
  audio: AudioContext,
  output: GainNode,
  noiseBuffer: AudioBuffer,
  time: number,
): void {
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 420;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.05, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  source.start(time, Math.random() * 0.5, 0.18);
  source.stop(time + 0.18);
  track(source);
}

/**
 * Programa los sonidos de una tirada 3D. Debe llamarse cuando arranca la
 * reproducción de la trayectoria; el `id` evita dobles disparos.
 */
export function scheduleDiceRollSound(
  rollId: string,
  trajectories: readonly DiceTrajectory[],
  sides: DiceSides,
  count = 1,
): void {
  if (!enabled || soundedRolls.has(rollId)) return;
  rememberSounded(rollId);
  stopActiveSources();
  const scheduleGeneration = ++generation;

  withContext((audio, output, noiseBuffer) => {
    if (scheduleGeneration !== generation) return;
    const start = audio.currentTime + 0.08;
    playRollStartAt(audio, output, noiseBuffer, start, count);
    const sounds = collectImpactSounds(trajectories);
    for (const sound of sounds) {
      playImpactAt(
        audio,
        output,
        noiseBuffer,
        start + sound.atMs / 1000,
        sound,
        sides,
      );
    }
    const duration = Math.max(
      0,
      ...trajectories.map((trajectory) => trajectory.durationMs),
    );
    playSettleAt(audio, output, noiseBuffer, start + duration / 1000);
  });
}

/** Sonido corto para tiradas que caen al pop (sin escena 3D). */
export function playPopDiceSound(
  rollId: string,
  sides: DiceSides,
  count = 1,
): void {
  if (!enabled || soundedRolls.has(rollId)) return;
  rememberSounded(rollId);
  withContext((audio, output, noiseBuffer) => {
    if (!enabled) return;
    const start = audio.currentTime + 0.03;
    playRollStartAt(audio, output, noiseBuffer, start, count);
    const impacts = Math.min(4, Math.max(2, count));
    for (let index = 0; index < impacts; index += 1) {
      playImpactAt(
        audio,
        output,
        noiseBuffer,
        start + 0.04 + index * 0.055,
        {
          atMs: 0,
          strength: 0.45 + index * 0.12,
          pan: (index % 2 === 0 ? -1 : 1) * 0.22,
        },
        sides,
      );
    }
    playSettleAt(audio, output, noiseBuffer, start + 0.32);
  });
}

/** Dos chasquidos para confirmar que el sonido está activo. */
export function playDicePreviewSound(): void {
  if (!enabled) return;
  withContext((audio, output, noiseBuffer) => {
    if (!enabled) return;
    const start = audio.currentTime + 0.03;
    playImpactAt(audio, output, noiseBuffer, start, {
      atMs: 0,
      strength: 0.8,
      pan: -0.2,
    }, 20);
    playImpactAt(audio, output, noiseBuffer, start + 0.09, {
      atMs: 0,
      strength: 0.65,
      pan: 0.2,
    }, 20);
  });
}

function playChimeAt(
  audio: AudioContext,
  output: GainNode,
  time: number,
  note: CelebrationNote,
): void {
  const start = Math.max(time, audio.currentTime + 0.005);
  const playTone = (
    frequency: number,
    gainValue: number,
    duration: number,
    type: OscillatorType,
  ): void => {
    const tone = audio.createOscillator();
    tone.type = type;
    tone.frequency.setValueAtTime(frequency, start);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, gainValue),
      start + 0.006,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    tone.connect(gain);
    gain.connect(output);
    tone.start(start);
    tone.stop(start + duration + 0.03);
    track(tone);
  };
  playTone(note.frequency, note.gain, note.duration, note.type);
  // Armónico suave para que suene a campana, no a pitido.
  playTone(note.frequency * 2.01, note.gain * 0.22, note.duration * 0.7, "sine");
}

function playSparkleAt(
  audio: AudioContext,
  output: GainNode,
  noiseBuffer: AudioBuffer,
  time: number,
): void {
  const start = Math.max(time, audio.currentTime + 0.005);
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 3200;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.025, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  source.start(start, Math.random() * 0.4, 0.35);
  source.stop(start + 0.35);
  track(source);
}

function playLowAt(
  audio: AudioContext,
  output: GainNode,
  time: number,
  note: CelebrationNote,
): void {
  const start = Math.max(time, audio.currentTime + 0.005);
  const tone = audio.createOscillator();
  tone.type = note.type;
  tone.frequency.setValueAtTime(note.frequency, start);
  tone.frequency.exponentialRampToValueAtTime(
    Math.max(30, note.frequency * 0.82),
    start + note.duration,
  );
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, note.gain),
    start + 0.012,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
  tone.connect(gain);
  gain.connect(output);
  tone.start(start);
  tone.stop(start + note.duration + 0.03);
  track(tone);
}

function playRumbleAt(
  audio: AudioContext,
  output: GainNode,
  noiseBuffer: AudioBuffer,
  time: number,
): void {
  const start = Math.max(time, audio.currentTime + 0.005);
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 160;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  source.start(start, Math.random() * 0.4, 0.6);
  source.stop(start + 0.6);
  track(source);
}

/** Chime del Nat 20 o golpe grave del Nat 1; se dispara una vez por tirada. */
export function playDiceCelebration(
  rollId: string,
  kind: CelebrationSoundKind,
): void {
  if (!enabled || soundedCelebrations.has(rollId)) return;
  rememberCelebration(rollId);
  withContext((audio, output, noiseBuffer) => {
    if (!enabled) return;
    const start = audio.currentTime + 0.03;
    const notes = celebrationSoundSpec(kind);
    if (kind === "nat20") {
      for (const note of notes) {
        playChimeAt(audio, output, start + note.at, note);
      }
      playSparkleAt(audio, output, noiseBuffer, start + 0.1);
    } else {
      for (const note of notes) {
        playLowAt(audio, output, start + note.at, note);
      }
      playRumbleAt(audio, output, noiseBuffer, start);
    }
  });
}

/** Para al saltar o desmontar la escena; libera los sonidos programados. */
export function stopDiceSounds(rollId?: string): void {
  generation += 1;
  stopActiveSources();
  if (rollId) soundedRolls.delete(rollId);
}
