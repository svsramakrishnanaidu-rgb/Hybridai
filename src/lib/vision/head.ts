/**
 * HYDRO AI — head gesture tracking.
 *
 * A nod and a shake are the only two head movements this system treats as a
 * signal, and only when the head actually reverses direction twice with real
 * amplitude. Looking around, leaning in or a dropped frame all return null.
 *
 * Pure geometry and timing: no DOM, no MediaPipe, so the thresholds are tested
 * in `live-selftest`.
 */

export interface HeadSample {
  /** normalised head yaw, −1 … 1 */
  yaw: number;
  /** normalised head pitch, −1 … 1 */
  pitch: number;
  /** false when no face was tracked in this frame */
  present: boolean;
  at: number;
}

export type HeadGesture = "head_nod" | "head_shake";

const WINDOW_MS = 1400;
/** minimum travel of the pitch (nod) or yaw (shake) to count at all */
export const MIN_NOD_TRAVEL = 0.1;
export const MIN_SHAKE_TRAVEL = 0.12;
/** reverse motions required, each larger than the noise floor */
const MIN_REVERSALS = 2;
const NOISE = 0.012;
const COOLDOWN_MS = 1500;

interface Reading {
  yaw: number;
  pitch: number;
  at: number;
}

export class HeadGestureTracker {
  private history: Reading[] = [];
  private lastEmit: Partial<Record<HeadGesture, number>> = {};
  private previousSign = { yaw: 0, pitch: 0 };

  reset(): void {
    this.history = [];
    this.previousSign = { yaw: 0, pitch: 0 };
  }

  /** Feed one face sample; returns a head gesture only when it is unambiguous. */
  push(sample: HeadSample): HeadGesture | null {
    if (!sample.present) {
      this.reset();
      return null;
    }
    this.history.push({ yaw: sample.yaw, pitch: sample.pitch, at: sample.at });
    this.history = this.history.filter((r) => sample.at - r.at <= WINDOW_MS);

    // Two samples cannot show a movement.
    if (this.history.length < 6) return null;

    const at = sample.at;
    const nod = this.measure("pitch", MIN_NOD_TRAVEL, at);
    if (nod) return nod;
    return this.measure("yaw", MIN_SHAKE_TRAVEL, at);
  }

  private measure(axis: "yaw" | "pitch", minTravel: number, at: number): HeadGesture | null {
    const values = this.history.map((r) => r[axis]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min < minTravel) return null;

    let reversals = 0;
    let previous = 0;
    for (let i = 1; i < values.length; i++) {
      const delta = values[i] - values[i - 1];
      if (Math.abs(delta) < NOISE) continue;
      const sign = Math.sign(delta);
      if (previous !== 0 && sign !== previous) reversals += 1;
      previous = sign;
    }
    if (reversals < MIN_REVERSALS) return null;

    const gesture: HeadGesture = axis === "pitch" ? "head_nod" : "head_shake";
    const last = this.lastEmit[gesture];
    // No previous event yet — only a real previous timestamp may cool down.
    if (last !== undefined && at - last < COOLDOWN_MS) return null;
    this.lastEmit[gesture] = at;
    this.history = [];
    this.previousSign = { yaw: 0, pitch: 0 };
    return gesture;
  }
}
