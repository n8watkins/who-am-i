// Party kit: sound cues and haptics for a game's key moments, behind a mute switch that each
// device remembers. Game-agnostic: games map their own events to the cues below.
//
// - Silent until the player has touched the page: no AudioContext exists before the first
//   pointer or key press, so nothing can play on load (and browsers would block it anyway).
// - Muted means no sound and no vibration.
// - "Reduce motion" turns vibration off; sounds still play.
// - Tones are synthesized with Web Audio, so there are no sound files to load.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Cue } from "../shared/cues";

export type { Cue };

/** Fired on window for every cue, with what was actually played. Handy for tests and analytics. */
export const FEEDBACK_EVENT = "kit:feedback";
export interface FeedbackEventDetail {
  cue: Cue;
  sound: boolean;
  haptic: boolean;
}

const STORAGE_KEY = "kit:sound";

type Note = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number };
const TONES: Record<Cue, Note[]> = {
  // Two quick rising notes: "your move".
  attention: [
    { freq: 660, at: 0, dur: 0.12 },
    { freq: 880, at: 0.11, dur: 0.16 },
  ],
  // A bright major arpeggio.
  success: [
    { freq: 523.25, at: 0, dur: 0.12 },
    { freq: 659.25, at: 0.09, dur: 0.12 },
    { freq: 783.99, at: 0.18, dur: 0.26 },
  ],
  victory: [
    { freq: 523.25, at: 0, dur: 0.14 },
    { freq: 659.25, at: 0.12, dur: 0.14 },
    { freq: 783.99, at: 0.24, dur: 0.14 },
    { freq: 1046.5, at: 0.36, dur: 0.45, gain: 0.2 },
  ],
  // Gentle, not mocking: a soft falling pair.
  defeat: [
    { freq: 523.25, at: 0, dur: 0.18, type: "triangle" },
    { freq: 392, at: 0.16, dur: 0.34, type: "triangle" },
  ],
  draw: [
    { freq: 587.33, at: 0, dur: 0.16, type: "triangle" },
    { freq: 587.33, at: 0.2, dur: 0.24, type: "triangle" },
  ],
};
const VIBRATIONS: Record<Cue, number[]> = {
  attention: [30, 60, 30],
  success: [40],
  victory: [60, 80, 60, 80, 120],
  defeat: [80],
  draw: [50, 80, 50],
};

// ---------------------------------------------------------------------------
// The mute preference, shared by every component through useSyncExternalStore.

const listeners = new Set<() => void>();
let muted = readMuted();

function readMuted(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "off";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "off" : "on");
  } catch {
    // Private mode: the choice lasts for this page.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Audio, created on the first user gesture.

let audio: AudioContext | null = null;
let armed = false;

function unlock(): void {
  if (audio) {
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
    return;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    audio = new Ctor();
    // iOS needs resume() inside the gesture.
    void audio.resume().catch(() => undefined);
  } catch {
    audio = null;
  }
}

/** Listens for the first tap or key press; until then every cue is silent. */
function armOnFirstGesture(): void {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const options = { capture: true, passive: true } as const;
  for (const type of ["pointerdown", "keydown", "touchend"] as const) window.addEventListener(type, unlock, options);
}

function playTone(ctx: AudioContext, notes: Note[]): void {
  const start = ctx.currentTime + 0.01;
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.freq;
    const peak = note.gain ?? 0.16;
    const t0 = start + note.at;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.02);
  }
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Plays a cue's sound and vibration, as far as the player's settings and the browser allow. */
export function playCue(cue: Cue): void {
  armOnFirstGesture();
  const ready = !!audio && audio.state === "running";
  const sound = !muted && ready;
  // Vibration also waits for a first tap (browsers require it), and respects "reduce motion".
  const haptic = !muted && !!audio && !prefersReducedMotion() && typeof navigator.vibrate === "function";
  if (sound) playTone(audio!, TONES[cue]);
  if (haptic) {
    try {
      navigator.vibrate(VIBRATIONS[cue]);
    } catch {
      // Ignore.
    }
  }
  window.dispatchEvent(new CustomEvent<FeedbackEventDetail>(FEEDBACK_EVENT, { detail: { cue, sound, haptic } }));
}

/** The mute switch, plus `play`. Mounting it starts listening for the first gesture. */
export function useFeedback(): { muted: boolean; setMuted: (muted: boolean) => void; play: (cue: Cue) => void } {
  const current = useSyncExternalStore(subscribe, isMuted, () => false);
  useEffect(armOnFirstGesture, []);
  const play = useCallback((cue: Cue) => playCue(cue), []);
  return { muted: current, setMuted, play };
}
