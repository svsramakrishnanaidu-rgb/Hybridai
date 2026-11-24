/**
 * HYDRO AI — gesture recognition.
 *
 * Pure geometry over MediaPipe's 21-point hand model, plus a temporal tracker
 * for the gestures that only exist across frames (wave, swipe, two-hand zoom).
 * No dependencies and no DOM, so the thresholds can be tested directly.
 *
 * Rule of thumb: a gesture that is ambiguous returns null. Executing an
 * unintended command is worse than missing one.
 */

import type { GestureEvent, GestureName, HandFrame, Landmark } from "./types";

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 } as const;
const PIP = { thumb: 3, index: 6, middle: 10, ring: 14, pinky: 18 } as const;

export interface ExtendedFingers {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
  count: number;
}

export interface HandReading {
  gesture: GestureName | null;
  confidence: number;
  palmX: number;
  palmY: number;
  /** normalised hand size, used to make distance tests scale invariant */
  scale: number;
  extended: ExtendedFingers;
}

function dist(a: Landmark, b: Landmark): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz * 0.5);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function handScale(lm: Landmark[]): number {
  return Math.max(1e-4, dist(lm[0], lm[9]));
}

export function extendedFingers(lm: Landmark[]): ExtendedFingers {
  const wrist = lm[0];
  const ext = (tip: number, pip: number) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.18;
  const thumb = ext(TIP.thumb, PIP.thumb) && dist(lm[4], lm[5]) > dist(lm[2], lm[5]) * 1.05;
  const index = ext(TIP.index, PIP.index);
  const middle = ext(TIP.middle, PIP.middle);
  const ring = ext(TIP.ring, PIP.ring);
  const pinky = ext(TIP.pinky, PIP.pinky);
  const count = [index, middle, ring, pinky].filter(Boolean).length;
  return { thumb, index, middle, ring, pinky, count };
}

/** Palm centre: wrist blended with the index/middle knuckles. */
function palmCentre(lm: Landmark[]): { x: number; y: number } {
  return {
    x: (lm[0].x + lm[5].x + lm[9].x + lm[17].x) / 4,
    y: (lm[0].y + lm[5].y + lm[9].y + lm[17].y) / 4,
  };
}

/**
 * Classify one hand. Static poses only — wave, swipe and two-hand zoom are
 * resolved by GestureTracker, because they need a history of frames.
 */
export function readHand(frame: HandFrame | null | undefined): HandReading | null {
  if (!frame || frame.landmarks.length < 21) return null;
  const lm = frame.landmarks;
  const scale = handScale(lm);
  const ext = extendedFingers(lm);
  const palm = palmCentre(lm);
  const base = {
    palmX: palm.x,
    palmY: palm.y,
    scale,
    extended: ext,
  };

  // pinch — thumb and index tips close together, other fingers not fanned out
  const pinch = dist(lm[4], lm[8]) / scale;
  if (pinch < 0.45 && !ext.middle && !ext.ring) {
    return {
      ...base,
      gesture: "pinch",
      confidence: clamp01(0.95 - pinch * 0.7) * clamp01(0.6 + frame.score * 0.4),
    };
  }

  const onlyThumb = ext.thumb && !ext.index && !ext.middle && !ext.ring && !ext.pinky;
  if (onlyThumb) {
    const vertical = lm[4].y - lm[2].y;
    if (vertical < -0.06) {
      return { ...base, gesture: "thumbs_up", confidence: clamp01(0.72 + Math.abs(vertical)) };
    }
    if (vertical > 0.06) {
      return { ...base, gesture: "thumbs_down", confidence: clamp01(0.72 + Math.abs(vertical)) };
    }
    return { ...base, gesture: null, confidence: 0 };
  }

  const spread = dist(lm[8], lm[20]) / scale;
  if (ext.count >= 4) {
    return {
      ...base,
      gesture: "open_palm",
      confidence: clamp01(0.7 + (spread - 0.9) * 0.35) * clamp01(0.6 + frame.score * 0.4),
    };
  }

  if (ext.index && !ext.middle && !ext.ring && !ext.pinky) {
    return { ...base, gesture: "point", confidence: 0.8 };
  }

  return { ...base, gesture: null, confidence: 0 };
}

export interface TrackerOptions {
  /** minimum confidence before an event is emitted */
  threshold?: number;
  /** milliseconds before the same gesture can fire again */
  cooldownMs?: number;
  /** how far (normalised) the palm must travel for a swipe */
  swipeDistance?: number;
}

interface Point {
  x: number;
  y: number;
  at: number;
}

const HISTORY_MS = 900;

export class GestureTracker {
  private history: Point[] = [];
  /** most recent static reading, for the live readout */
  lastGestures: { gesture: GestureName | null; confidence: number } = {
    gesture: null,
    confidence: 0,
  };
  private palmHistory: Point[] = [];
  private handDistance: Point[] = [];
  private lastOpenPalmAt = 0;
  private openPalmSince = 0;
  private lastEmit: Partial<Record<GestureName, number>> = {};
  private seq = 0;

  private threshold: number;
  private cooldownMs: number;
  private swipeDistance: number;

  constructor(opts: TrackerOptions = {}) {
    this.threshold = opts.threshold ?? 0.62;
    this.cooldownMs = opts.cooldownMs ?? 1400;
    this.swipeDistance = opts.swipeDistance ?? 0.22;
  }

  reset() {
    this.history = [];
    this.palmHistory = [];
    this.handDistance = [];
    this.openPalmSince = 0;
    this.lastGestures = { gesture: null, confidence: 0 };
  }

  /**
   * Feed one frame of detections. Returns gesture events that just became
   * certain enough to act on.
   */
  push(frames: HandFrame[], at: number): GestureEvent[] {
    const events: GestureEvent[] = [];
    const emit = (name: GestureName, confidence: number) => {
      if (confidence < this.threshold) return;
      const last = this.lastEmit[name] ?? 0;
      if (at - last < this.cooldownMs) return;
      this.lastEmit[name] = at;
      events.push({ id: ++this.seq, name, confidence, at });
    };

    const readings = frames.map(readHand).filter((r): r is HandReading => r !== null);
    const openPalm = readings.find((r) => r.gesture === "open_palm");

    const named = readings.find((r) => r.gesture !== null);
    this.lastGestures = named
      ? { gesture: named.gesture, confidence: named.confidence }
      : { gesture: null, confidence: 0 };

    if (openPalm) {
      if (!this.openPalmSince) this.openPalmSince = at;
      this.palmHistory.push({ x: openPalm.palmX, y: openPalm.palmY, at });
    } else {
      this.openPalmSince = 0;
    }
    this.palmHistory = this.palmHistory.filter((p) => at - p.at < HISTORY_MS);

    // raised hand: an open palm held in the upper half of the frame
    if (openPalm && openPalm.palmY < 0.45 && at - this.openPalmSince > 350) {
      emit("raised_hand", openPalm.confidence);
    }

    // wave: the palm reverses horizontal direction twice while open
    if (this.palmHistory.length >= 6) {
      let previousSign = 0;
      let reversals = 0;
      let travel = 0;
      for (let i = 1; i < this.palmHistory.length; i++) {
        const dx = this.palmHistory[i].x - this.palmHistory[i - 1].x;
        travel += Math.abs(dx);
        const sign = Math.sign(dx);
        if (sign !== 0 && previousSign !== 0 && sign !== previousSign && Math.abs(dx) > 0.004) {
          reversals += 1;
        }
        if (sign !== 0) previousSign = sign;
      }
      if (reversals >= 2 && travel > 0.09 && openPalm) {
        emit("wave", Math.min(1, 0.6 + reversals * 0.1));
        this.palmHistory = [];
      }
    }

    // swipe: a fast palm sweep in one dominant direction. Horizontal is a
    // page change; vertical scrolls, and is only accepted when it is clearly
    // not a horizontal wave.
    const first = this.palmHistory[0];
    const last = this.palmHistory[this.palmHistory.length - 1];
    if (first && last && openPalm) {
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      if (Math.abs(dx) > this.swipeDistance && Math.abs(dy) < Math.abs(dx) * 0.55) {
        emit(dx < 0 ? "swipe_left" : "swipe_right", 0.78);
        this.palmHistory = [];
      } else if (Math.abs(dy) > this.swipeDistance && Math.abs(dx) < Math.abs(dy) * 0.55) {
        // Frame y grows downward, so a rising palm is a negative dy.
        emit(dy < 0 ? "swipe_up" : "swipe_down", 0.76);
        this.palmHistory = [];
      }
    }

    // two hands: wrist separation trend drives expand / contract
    if (readings.length === 2) {
      const d = Math.hypot(readings[0].palmX - readings[1].palmX, readings[0].palmY - readings[1].palmY);
      this.handDistance.push({ x: d, y: 0, at });
    }
    this.handDistance = this.handDistance.filter((p) => at - p.at < 800);
    if (this.handDistance.length >= 4) {
      const a = this.handDistance[0];
      const b = this.handDistance[this.handDistance.length - 1];
      const delta = b.x - a.x;
      if (Math.abs(delta) > 0.14) {
        emit(delta > 0 ? "two_hand_expand" : "two_hand_contract", 0.74);
        this.handDistance = [];
      }
    }

    // static poses are reported with their own confidence, throttled by cooldown
    for (const reading of readings) {
      if (!reading.gesture) continue;
      if (reading.gesture === "open_palm") continue;
      emit(reading.gesture, reading.confidence);
    }

    this.history.push({ x: openPalm?.palmX ?? 0, y: openPalm?.palmY ?? 0, at });
    this.history = this.history.filter((p) => at - p.at < HISTORY_MS);
    return events;
  }
}

/** Convert a normalised landmark to mirror-corrected frame space. */
export function mirrorX(x: number): number {
  return 1 - x;
}
