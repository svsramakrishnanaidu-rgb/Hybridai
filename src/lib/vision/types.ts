/**
 * HYDRO AI — camera vision protocol.
 *
 * Everything here is a *measurement*. Nothing is inferred about the user's
 * identity, emotions or intentions: the vision layer only reports geometry it
 * can actually see, plus a confidence value for how reliable that estimate is.
 */

export type VisionStatus =
  | "idle"
  | "requesting"
  | "loading"
  | "live"
  | "denied"
  | "unsupported"
  | "error";

export type GestureName =
  | "wave"
  | "raised_hand"
  | "open_palm"
  | "thumbs_up"
  | "thumbs_down"
  | "point"
  | "pinch"
  | "swipe_left"
  | "swipe_right"
  | "swipe_up"
  | "swipe_down"
  | "two_hand_expand"
  | "two_hand_contract";

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export interface HandFrame {
  landmarks: Landmark[];
  handedness: "Left" | "Right" | "Unknown";
  score: number;
}

export type GestureEventName = GestureName | "custom" | "head_nod" | "head_shake";

export interface GestureEvent {
  id: number;
  name: GestureEventName;
  confidence: number;
  at: number;
  /** present when the event came from a user-taught pose template */
  custom?: { id: string; name: string; command: string };
}

export interface FaceSignal {
  present: boolean;
  /** horizontal attention target, −1 (user left of frame) … 1 (right) */
  gazeX: number;
  /** vertical attention target, −1 (low) … 1 (high) */
  gazeY: number;
  /** head yaw in −1…1 normalised units derived from landmark geometry */
  yaw: number;
  pitch: number;
  /** 0 = eyes open, 1 = eyes closed */
  blink: number;
  /** 0 = mouth closed, 1 = jaw wide open */
  mouth: number;
  /** 0…1 smile blendshape; surfaced as a weak context signal only */
  smile: number;
  /** 0…1 inner-brow-raise blendshape, surfaced as a visible cue only */
  brow: number;
  /** 0…1 eye-squint blendshape, surfaced as a visible cue only */
  squint: number;
  /** 0…1 brow-lowerer blendshape (AU4); a visible shape, not a mood */
  browDown: number;
  /** 0…1 lip-corner-depress blendshape (AU15); a visible shape, not a mood */
  frown: number;
}

export interface PoseSignal {
  present: boolean;
  /** normalised frame position of the shoulder midpoint, null when unseen */
  shoulderX: number | null;
  shoulderY: number | null;
  /** approximate sideways lean from shoulder tilt, −1…1; 0 when unknown */
  lean: number;
  /** approximate lowering relative to this session's own shoulder baseline, 0…1 */
  settle: number;
}

export interface VisionSample {
  at: number;
  face: FaceSignal;
  /** how many faces the detector reported in this frame (max 2 requested) */
  faces: number;
  hands: { count: number; gesture: GestureName | null; confidence: number };
  pose: PoseSignal;
  /** measured detector throughput, not a target */
  fps: number;
  inferenceMs: number;
  /** whether the landmark models loaded, or only the fallback ran */
  quality: "landmarks" | "unavailable";
}

/** Per-frame signals read by the hologram render loop (never through state). */
export interface VisionSignals {
  gazeX: number;
  gazeY: number;
  attention: number;
  blink: number;
  mouth: number;
  presence: number;
  scan: number;
  /** visible cues mirrored weakly by the expression engine (never interpreted) */
  mirrorSmile: number;
  mirrorBrow: number;
  mirrorSquint: number;
}

export const EMPTY_SIGNALS: VisionSignals = {
  gazeX: 0,
  gazeY: 0,
  attention: 0,
  blink: 0,
  mouth: 0,
  presence: 0,
  scan: 0,
  mirrorSmile: 0,
  mirrorBrow: 0,
  mirrorSquint: 0,
};

export const EMPTY_FACE: FaceSignal = {
  present: false,
  gazeX: 0,
  gazeY: 0,
  yaw: 0,
  pitch: 0,
  blink: 0,
  mouth: 0,
  smile: 0,
  brow: 0,
  squint: 0,
  browDown: 0,
  frown: 0,
};

export const EMPTY_SAMPLE: VisionSample = {
  at: 0,
  face: EMPTY_FACE,
  faces: 0,
  hands: { count: 0, gesture: null, confidence: 0 },
  pose: { present: false, shoulderX: null, shoulderY: null, lean: 0, settle: 0 },
  fps: 0,
  inferenceMs: 0,
  quality: "unavailable",
};

export const GESTURE_LABELS: Record<GestureEventName, string> = {
  custom: "Custom gesture",
  wave: "Wave",
  raised_hand: "Raised hand",
  open_palm: "Open palm",
  thumbs_up: "Thumbs up",
  thumbs_down: "Thumbs down",
  point: "Pointing",
  pinch: "Pinch",
  swipe_left: "Swipe left",
  swipe_right: "Swipe right",
  swipe_up: "Swipe up",
  swipe_down: "Swipe down",
  head_nod: "Head nod",
  head_shake: "Head shake",
  two_hand_expand: "Two-hand expand",
  two_hand_contract: "Two-hand contract",
};
