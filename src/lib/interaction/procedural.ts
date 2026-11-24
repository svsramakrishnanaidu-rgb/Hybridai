/**
 * HYDRO AI — procedural idle motion.
 *
 * Blinking, breathing, saccades and micro-expressions are generated, not played
 * from a clip. Every timer is seeded, so a test can reproduce the exact same
 * sequence, and every output is bounded to a small range so the face never
 * performs a mechanical loop.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface IdleFrame {
  /** 0 open … 1 closed */
  blink: number;
  /** 0 exhaled … 1 inhaled */
  breath: number;
  /** −1…1 small eye drift */
  saccadeX: number;
  saccadeY: number;
  /** 0…1 brief involuntary expression accent */
  micro: number;
  /** −1…1, which way the micro-expression leans */
  microSign: number;
  /** −1…1 slow head nod */
  nod: number;
  /** −1…1 head tilt */
  tilt: number;
  /** −1…1 lateral sway */
  sway: number;
}

const BLINK_MS = 150;
const MICRO_MS = 620;

export class IdleMotion {
  constructor(seed = 20240717) {
    this.random = mulberry32(seed);
    this.nextBlinkAt = 1400 + this.random() * 2600;
    this.nextMicroAt = 3200 + this.random() * 5200;
    this.nextSaccadeAt = 400 + this.random() * 1200;
  }

  random: () => number;
  time = 0;

  blinkStartedAt = -1;
  pendingBlinkAt = -1;
  nextBlinkAt: number;

  microStartedAt = -1;
  nextMicroAt: number;
  microSign = 1;

  nextSaccadeAt: number;
  targetX = 0;
  targetY = 0;
  currentX = 0;
  currentY = 0;

  phaseA = 0.7;
  phaseB = 2.1;

  /**
   * Advance the generator. `dtMs` is clamped so a backgrounded tab that wakes
   * up does not fast-forward through twenty blinks at once.
   */
  update(dtMs: number): IdleFrame {
    const dt = Math.max(0, Math.min(120, dtMs));
    this.time += dt;
    const now = this.time;

    // ── blink: single, with an occasional double ───────────────────────────
    if (this.blinkStartedAt < 0 && now >= this.nextBlinkAt) {
      this.blinkStartedAt = now;
      if (this.random() < 0.22) this.pendingBlinkAt = now + BLINK_MS + 90;
    }
    if (this.pendingBlinkAt > 0 && now >= this.pendingBlinkAt) {
      this.pendingBlinkAt = -1;
      this.blinkStartedAt = now;
    }
    let blink = 0;
    if (this.blinkStartedAt >= 0) {
      const progress = (now - this.blinkStartedAt) / BLINK_MS;
      if (progress >= 1) {
        this.blinkStartedAt = -1;
        this.nextBlinkAt = now + 2400 + this.random() * 4000;
      } else {
        blink = Math.sin(Math.PI * Math.max(0, progress));
      }
    }

    // ── micro-expression: a short asymmetry the speech layer can ignore ────
    if (this.microStartedAt < 0 && now >= this.nextMicroAt) {
      this.microStartedAt = now;
      this.microSign = this.random() < 0.5 ? -1 : 1;
    }
    let micro = 0;
    if (this.microStartedAt >= 0) {
      const progress = (now - this.microStartedAt) / MICRO_MS;
      if (progress >= 1) {
        this.microStartedAt = -1;
        this.nextMicroAt = now + 4200 + this.random() * 6400;
      } else {
        micro = Math.sin(Math.PI * progress) ** 2;
      }
    }

    // ── saccades: small, damped eye movements between fixations ────────────
    if (now >= this.nextSaccadeAt) {
      this.targetX = (this.random() * 2 - 1) * 0.34;
      this.targetY = (this.random() * 2 - 1) * 0.2;
      this.nextSaccadeAt = now + 900 + this.random() * 2100;
    }
    const k = 1 - Math.exp(-dt / 90);
    this.currentX += (this.targetX - this.currentX) * k;
    this.currentY += (this.targetY - this.currentY) * k;

    // ── breathing: 4.6 s cycle with a slow amplitude drift ─────────────────
    const cycle = (this.time / 4600) * Math.PI * 2;
    const breath = 0.5 + 0.42 * Math.sin(cycle) + 0.08 * Math.sin(cycle * 0.37 + this.phaseA);

    return {
      blink,
      breath: Math.max(0, Math.min(1, breath)),
      saccadeX: this.currentX,
      saccadeY: this.currentY,
      micro,
      microSign: this.microSign,
      nod: Math.sin((this.time / 5200) * Math.PI * 2 + this.phaseA) * 0.45,
      tilt: Math.sin((this.time / 7300) * Math.PI * 2 + this.phaseB) * 0.5,
      sway: Math.sin((this.time / 4300) * Math.PI * 2 + this.phaseB * 0.6) * 0.5,
    };
  }
}
