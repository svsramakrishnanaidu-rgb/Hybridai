/**
 * HYDRO AI — visual attention policy ("continuous sight").
 *
 * Decides *when* a camera frame is worth sending to a vision model. Nothing
 * here touches the DOM, the camera or the network, so the policy can be tested
 * without a device. The camera wiring lives in useVision.
 *
 * Design goals:
 *  - never send every frame (that would be expensive and slow),
 *  - notice a genuine scene change instead of camera noise,
 *  - keep a hard cap on paid observations per camera session,
 *  - stay silent while the user is already waiting on a reply.
 */

/** Luminance fingerprint of a frame: a small grid plus its mean. */
export interface SceneSignature {
  cells: number[];
  mean: number;
}

export const SIGHT_BUDGET = {
  /** how often a frame is *sampled* locally (no network) */
  sampleIntervalMs: 1200,
  /** minimum gap between two vision-model calls */
  minIntervalMs: 12_000,
  /** mean absolute luminance change that counts as a new scene (0..1) */
  sceneThreshold: 0.075,
  /** hard ceiling on paid observations per camera session */
  maxObservations: 30,
  /** width of the frame actually sent to the model */
  frameWidth: 640,
} as const;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Build a signature from an already-computed luminance grid. */
export function signatureFromLuma(luma: ArrayLike<number>): SceneSignature {
  const cells = new Array<number>(luma.length);
  let sum = 0;
  for (let i = 0; i < luma.length; i++) {
    const v = clamp01(luma[i]);
    cells[i] = v;
    sum += v;
  }
  return { cells, mean: luma.length ? sum / luma.length : 0 };
}

/** Downsample raw RGBA pixels into a `cols × rows` luminance signature. */
export function signatureFromRgba(
  rgba: ArrayLike<number>,
  cols = 16,
  rows = 9,
): SceneSignature {
  const count = Math.max(1, cols * rows);
  const luma = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (o + 2 >= rgba.length) {
      luma[i] = 0;
      continue;
    }
    luma[i] = (0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]) / 255;
  }
  return signatureFromLuma(luma);
}

/** Mean absolute difference between two frames, 0 (identical) … 1. */
export function signatureDelta(a: SceneSignature | null, b: SceneSignature | null): number {
  if (!a || !b || a.cells.length !== b.cells.length || !a.cells.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.cells.length; i++) sum += Math.abs(a.cells[i] - b.cells[i]);
  return sum / a.cells.length;
}

export type SightDecisionReason =
  | "first-frame"
  | "scene-change"
  | "unchanged"
  | "cooldown"
  | "budget"
  | "busy"
  | "disabled";

export interface SightDecisionInput {
  enabled: boolean;
  /** true while another observation request is in flight */
  busy: boolean;
  now: number;
  /** when the last frame was actually analysed, null if never */
  lastSentAt: number | null;
  observations: number;
  /** scene delta against the last *analysed* frame */
  delta: number;
}

/**
 * Pure decision: should this sampled frame be sent to the vision model?
 * A cooldown never discards a real scene change — it only postpones it, because
 * the next sample is still compared against the last analysed frame.
 */
export function shouldObserve(input: SightDecisionInput): {
  observe: boolean;
  reason: SightDecisionReason;
} {
  if (!input.enabled) return { observe: false, reason: "disabled" };
  if (input.busy) return { observe: false, reason: "busy" };
  if (input.observations >= SIGHT_BUDGET.maxObservations) {
    return { observe: false, reason: "budget" };
  }
  if (input.lastSentAt === null) return { observe: true, reason: "first-frame" };
  if (input.delta < SIGHT_BUDGET.sceneThreshold) {
    return { observe: false, reason: "unchanged" };
  }
  if (input.now - input.lastSentAt < SIGHT_BUDGET.minIntervalMs) {
    return { observe: false, reason: "cooldown" };
  }
  return { observe: true, reason: "scene-change" };
}

/**
 * Measured image quality from the luminance fingerprint.
 *
 * A camera pointed at a dark room or a covered lens still returns a frame, and a
 * vision model will happily describe something confidently from it. Measuring
 * brightness and contrast locally lets the question carry that fact, so the
 * model is told what the numbers already show.
 */
export interface FrameQuality {
  mean: number;
  contrast: number;
  level: "good" | "dim" | "bright" | "flat";
  note: string | null;
}

export function frameQuality(sig: SceneSignature): FrameQuality {
  let min = 1;
  let max = 0;
  for (const cell of sig.cells) {
    if (cell < min) min = cell;
    if (cell > max) max = cell;
  }
  const contrast = max - min;
  const round = (v: number) => Math.round(v * 1000) / 1000;

  if (sig.mean < 0.14) {
    return {
      mean: round(sig.mean),
      contrast: round(contrast),
      level: "dim",
      note: "The scene is very dark — say plainly when detail is too poor to make out.",
    };
  }
  if (sig.mean > 0.92) {
    return {
      mean: round(sig.mean),
      contrast: round(contrast),
      level: "bright",
      note: "The scene is very bright — highlights may be hiding detail.",
    };
  }
  if (contrast < 0.035) {
    return {
      mean: round(sig.mean),
      contrast: round(contrast),
      level: "flat",
      note: "The frame has almost no contrast — it may be a blank surface or a covered lens.",
    };
  }
  return { mean: round(sig.mean), contrast: round(contrast), level: "good", note: null };
}

/** Proactive comments are tightly capped: they cost a model call already made,
 *  but they interrupt the user, so the budget is about attention, not money. */
export const PROACTIVE = { minIntervalMs: 20_000, maxPerSession: 6 } as const;

export type ProactiveMode = "off" | "assist" | "comment";

export interface CommentDecisionInput {
  mode: ProactiveMode;
  /** true while the user is waiting on a reply; never talk over that */
  busy: boolean;
  now: number;
  lastCommentAt: number | null;
  comments: number;
  /** scene delta of the observation that just arrived */
  delta: number;
}

/** Pure decision: should this finished observation be spoken into the thread? */
export function shouldComment(input: CommentDecisionInput): boolean {
  if (input.mode !== "comment") return false;
  if (input.busy) return false;
  if (input.comments >= PROACTIVE.maxPerSession) return false;
  if (input.delta < SIGHT_BUDGET.sceneThreshold) return false;
  if (input.lastCommentAt !== null && input.now - input.lastCommentAt < PROACTIVE.minIntervalMs) {
    return false;
  }
  return true;
}

/** The question asked of the vision model for an unattended observation. */
export const SIGHT_QUESTION =
  "This frame is from the user's own camera. In 2–4 short sentences, describe only what is clearly visible: the setting, the most prominent objects, anything the user is holding up or showing, and any legible text. Do not guess, do not identify people, and say plainly when something is unclear.";

/**
 * Build the observation question, adding the locally measured light conditions.
 * A measured fact about the frame is more useful to the model than a warning.
 */
export function observationQuestion(quality: FrameQuality | null): string {
  if (!quality?.note) return SIGHT_QUESTION;
  const brightness = Math.round(quality.mean * 100);
  const contrast = Math.round(quality.contrast * 100);
  return `${SIGHT_QUESTION}\nMeasured image quality: ${quality.level} — brightness ${brightness}%, contrast ${contrast}%. ${quality.note}`;
}

/** A reading pass over one frame, for documents, labels and handwriting. */
export const READ_TEXT_QUESTION =
  "Read the text visible in this frame. Transcribe only what is actually legible, line by line, keeping the original language and spelling. If a line is cut off or blurred, say so rather than guessing the missing words. If there is no readable text in the frame, say that plainly and do not describe anything else.";
