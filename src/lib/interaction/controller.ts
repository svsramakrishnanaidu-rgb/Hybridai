/**
 * HYDRO AI — real-time interaction controller.
 *
 * One place decides what the face, mouth and body are doing. Vision, speech,
 * the pipeline and gestures all arrive as events; the controller resolves them
 * into layered behaviour states, drives the emotion engine, and produces a
 * per-frame `InteractionFrame` the renderer reads without re-rendering React.
 *
 * States can coexist: `active` lists every state that currently applies (for
 * example OBSERVING while LISTENING), and only the highest-priority one is the
 * primary. Nothing destructive is triggered from here.
 */

import {
  EMOTION_LABELS,
  EmotionEngine,
  addFace,
  clampFace,
  type EmotionName,
  type FaceBlendshapes,
  type Prosody,
} from "../../core/emotion.ts";
import {
  REST_MOUTH,
  mouthAt,
  textToVisemes,
  timelineDuration,
  type MouthShape,
  type VisemeCue,
} from "../../core/visemes.ts";
import { IdleMotion } from "./procedural.ts";

export type BehaviourState =
  | "idle"
  | "listening"
  | "thinking"
  | "reasoning"
  | "searching"
  | "speaking"
  | "observing"
  | "analyzing"
  | "learning"
  | "remembering"
  | "executing"
  | "curious"
  | "concerned"
  | "excited"
  | "confused"
  | "recovering"
  | "standby"
  | "sleeping";

/** Work the controller performs on the user's behalf, distinct from talking. */
export type ActivityState = "reasoning" | "searching" | "analyzing" | "remembering" | "executing";

export const STATE_LABELS: Record<BehaviourState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  reasoning: "Reasoning",
  searching: "Searching",
  speaking: "Speaking",
  observing: "Observing",
  analyzing: "Analysing",
  learning: "Learning",
  remembering: "Remembering",
  executing: "Executing",
  curious: "Curious",
  concerned: "Concerned",
  excited: "Engaged",
  confused: "Uncertain",
  recovering: "Recovering",
  standby: "Standby",
  sleeping: "Sleeping",
};

/**
 * The one mapping from behaviour to the hologram's visual state.
 *
 * The core used to be driven by a second, React-side switch that could disagree
 * with the face (the readout said "Thinking" while the expression was already
 * concerned). Every key here must exist in shaders.ts STATES; the self-test
 * asserts that.
 */
export const CORE_STATE: Record<BehaviourState, string> = {
  idle: "IDLE",
  listening: "LISTENING",
  thinking: "THINKING",
  reasoning: "THINKING",
  searching: "RESEARCHING",
  speaking: "SPEAKING",
  observing: "OBSERVING",
  analyzing: "VERIFYING",
  learning: "LEARNING",
  remembering: "REMEMBERING",
  executing: "EXECUTING",
  curious: "CURIOUS",
  concerned: "CONCERNED",
  excited: "SUCCESS",
  confused: "CONFUSED",
  recovering: "RECOVERING",
  standby: "SLEEPING",
  sleeping: "SLEEPING",
};

const PRIORITY: Record<BehaviourState, number> = {
  sleeping: 0,
  standby: 1,
  idle: 2,
  confused: 3,
  concerned: 4,
  curious: 5,
  remembering: 6,
  learning: 7,
  analyzing: 8,
  observing: 9,
  thinking: 10,
  reasoning: 11,
  searching: 12,
  listening: 13,
  excited: 14,
  executing: 15,
  speaking: 16,
  recovering: 17,
};

/** Which states may run *alongside* the primary one. */
const COMPATIBLE: Record<BehaviourState, BehaviourState[]> = {
  idle: ["observing", "learning", "listening", "curious"],
  standby: ["observing"],
  sleeping: ["observing"],
  listening: ["observing", "learning", "excited", "analyzing"],
  thinking: ["learning", "observing", "reasoning", "analyzing"],
  reasoning: ["thinking", "learning", "analyzing", "observing"],
  searching: ["reasoning", "analyzing", "observing", "listening"],
  analyzing: ["thinking", "reasoning", "observing", "learning"],
  speaking: ["observing", "excited", "analyzing"],
  observing: ["listening", "thinking", "learning", "reasoning"],
  learning: ["thinking", "observing", "listening", "reasoning"],
  remembering: ["thinking", "observing", "listening"],
  executing: ["observing", "speaking", "listening"],
  concerned: ["listening", "observing"],
  excited: ["listening", "observing", "speaking"],
  confused: ["thinking", "listening"],
  recovering: ["listening", "observing", "analyzing"],
  curious: ["listening", "observing", "thinking"],
};

const STATE_BIAS: Record<BehaviourState, Partial<FaceBlendshapes>> = {
  idle: {},
  standby: { browLower: 0.05, mouthPress: 0.05 },
  sleeping: { mouthPress: 0.04, browLower: 0.03 },
  listening: { browRaise: 0.16, squint: 0.05, lipStretch: 0.04 },
  thinking: { browLower: 0.2, squint: 0.16, mouthPress: 0.1 },
  reasoning: { browLower: 0.26, squint: 0.22, mouthPress: 0.08 },
  searching: { browRaise: 0.2, squint: 0.14, lipStretch: 0.04 },
  analyzing: { browLower: 0.3, squint: 0.26, mouthPress: 0.12 },
  speaking: { browRaise: 0.06, cheek: 0.05 },
  observing: { browRaise: 0.22, lidWide: 0.1 },
  learning: { browRaise: 0.18, squint: 0.08 },
  remembering: { browRaise: 0.24, squint: 0.1, lidWide: 0.08 },
  executing: { browLower: 0.2, squint: 0.2, mouthPress: 0.1, browRaise: 0.06 },
  curious: { browRaise: 0.34, lidWide: 0.16, smile: 0.08 },
  concerned: { frown: 0.22, browRaise: 0.16, mouthPress: 0.08 },
  excited: { smile: 0.18, cheek: 0.12, jaw: 0.08 },
  confused: { browLower: 0.22, mouthPress: 0.12, squint: 0.12 },
  recovering: { frown: 0.12, browLower: 0.14, mouthPress: 0.12 },
};

export type InteractionEvent =
  | { kind: "user-message"; text: string }
  | { kind: "reply-start" }
  | { kind: "reply-complete"; degraded?: boolean }
  | { kind: "error"; message?: string }
  | { kind: "speech-start"; text: string; rate?: number; durationMs?: number }
  | { kind: "speech-end" }
  | { kind: "listen-start" }
  | { kind: "listen-end" }
  | { kind: "observe-start" }
  | { kind: "observe-end" }
  | { kind: "phase"; phase: string }
  | { kind: "activity"; activity: ActivityState; on: boolean; ms?: number }
  | { kind: "gesture"; name: string }
  | { kind: "presence"; present: boolean }
  | { kind: "camera"; live: boolean }
  | { kind: "interrupt" };

export interface VisibleCues {
  /** blendshape-style 0…1 values measured from the user's face */
  smile?: number;
  brow?: number;
  squint?: number;
  jaw?: number;
}

export interface InteractionSettings {
  /** 0…1 — scales every expressive channel */
  expressiveness: number;
  /** weak mirroring of visible user movement (never an emotion claim) */
  mirror: boolean;
}

export const DEFAULT_SETTINGS: InteractionSettings = { expressiveness: 0.8, mirror: true };

export interface InteractionFrame {
  state: BehaviourState;
  active: BehaviourState[];
  face: FaceBlendshapes;
  mouth: MouthShape;
  blink: number;
  posture: { pitch: number; roll: number; sway: number; breath: number };
  /** measured speech amplitude, echoed for the renderer */
  audio: number;
}

export interface Describe {
  state: BehaviourState;
  label: string;
  expression: string;
  emotion: EmotionName;
  intensity: number;
  /** hologram visual state, always consistent with `state` */
  core: string;
}

/** Pipeline phase → the work HYDRO is visibly doing. */
const PHASE_ACTIVITY: Record<string, ActivityState> = {
  classify: "reasoning",
  plan: "reasoning",
  draft: "reasoning",
  research: "searching",
  verify: "analyzing",
  debate: "analyzing",
  fuse: "reasoning",
};

const SERIOUS_PHASES = new Set(["verify", "debate", "learn"]);

export class InteractionController {
  readonly emotion = new EmotionEngine();
  settings: InteractionSettings = { ...DEFAULT_SETTINGS };

  state: BehaviourState = "idle";
  active: BehaviourState[] = ["idle"];

  clock = 0;
  since = 0;
  lastActivityAt = 0;

  speaking = false;
  listening = false;
  thinking = false;
  observing = false;
  learning = false;
  present = false;
  cameraLive = false;

  /** Wall-clock deadlines for timed activities; no flag can get stuck on. */
  private activityUntil: Partial<Record<ActivityState, number>> = {};

  timeline: VisemeCue[] = [];
  speechStart = 0;

  visible: VisibleCues = {};

  idle = new IdleMotion();

  flash: { state: BehaviourState; until: number } | null = null;

  constructor(settings: Partial<InteractionSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  setSettings(patch: Partial<InteractionSettings>): void {
    this.settings = {
      ...this.settings,
      ...patch,
      expressiveness: Math.max(0, Math.min(1, patch.expressiveness ?? this.settings.expressiveness)),
    };
    this.emotion.setPersonality({ expressiveness: this.settings.expressiveness });
  }

  /** Visible cues measured this frame; mirrored weakly, never interpreted. */
  setVisibleCues(cues: VisibleCues): void {
    this.visible = cues;
  }

  push(event: InteractionEvent): void {
    this.lastActivityAt = this.clock;
    switch (event.kind) {
      case "user-message": {
        this.emotion.read(event.text);
        this.listening = false;
        break;
      }
      case "reply-start":
        this.thinking = true;
        this.emotion.stimulate({ arousal: 0.08 });
        break;
      case "reply-complete":
        this.thinking = false;
        this.learning = false;
        this.emotion.stimulate({
          valence: event.degraded ? 0.1 : 0.24,
          arousal: 0.08,
          dominance: 0.14,
        });
        break;
      case "error":
        this.thinking = false;
        this.emotion.stimulate({ valence: -0.45, arousal: 0.3, dominance: -0.2 });
        this.flashState("concerned", 2200);
        break;
      case "speech-start":
        this.beginSpeech(event.text, { rate: event.rate, durationMs: event.durationMs });
        break;
      case "speech-end":
        this.endSpeech();
        break;
      case "listen-start":
        this.listening = true;
        this.emotion.stimulate({ arousal: 0.05 });
        break;
      case "listen-end":
        this.listening = false;
        break;
      case "observe-start":
        this.observing = true;
        this.emotion.stimulate({ arousal: 0.12, valence: 0.05 });
        break;
      case "observe-end":
        this.observing = false;
        break;
      case "phase": {
        this.thinking = true;
        const activity = PHASE_ACTIVITY[event.phase];
        if (activity) this.setActivity(activity, true, 30_000);
        if (event.phase === "learn") this.learning = true;
        if (SERIOUS_PHASES.has(event.phase)) this.emotion.serious = Math.max(this.emotion.serious, 0.25);
        break;
      }
      case "activity":
        this.setActivity(event.activity, event.on, event.ms);
        if (event.activity === "reasoning" && event.on) this.thinking = true;
        break;
      case "gesture":
        if (event.name === "wave") {
          this.emotion.stimulate({ valence: 0.4, arousal: 0.28, dominance: 0.1 });
          this.flashState("excited", 1300);
        } else if (event.name === "raised_hand" || event.name === "open_palm") {
          this.emotion.stimulate({ arousal: 0.1 });
        }
        break;
      case "presence":
        this.present = event.present;
        if (event.present) {
          this.emotion.stimulate({ valence: 0.14, arousal: 0.06 });
        }
        break;
      case "camera":
        this.cameraLive = event.live;
        if (!event.live) {
          this.present = false;
          this.visible = {};
        }
        break;
      case "interrupt":
        this.thinking = false;
        this.speaking = false;
        this.emotion.stimulate({ arousal: 0.22, dominance: -0.15 });
        this.flashState("confused", 900);
        break;
    }
    // Resolve immediately so the readout never lags behind an event, even when
    // the render loop is paused (a hidden tab produces no frames).
    this.sample(0);
  }

  flashState(state: BehaviourState, ms: number): void {
    this.flash = { state, until: this.clock + ms };
  }

  /**
   * Mark a unit of work as running. A deadline is mandatory, so a lost
   * "finished" event degrades into idle instead of a permanent Executing face.
   */
  setActivity(activity: ActivityState, on: boolean, ms = 2400): void {
    this.activityUntil[activity] = on ? this.clock + Math.max(400, Math.min(120_000, ms)) : 0;
  }

  isActive(activity: ActivityState): boolean {
    return (this.activityUntil[activity] ?? 0) > this.clock;
  }

  /**
   * Start a lip-sync timeline.
   *
   * `text` should be the text actually sent to the synthesizer (normalised, with
   * numbers as words), not the Markdown answer — otherwise the mouth is chasing
   * characters that were never spoken. When the caller knows the real audio
   * duration, the whole timeline is scaled to it, which removes the drift that
   * a fixed per-grapheme duration accumulates over a long sentence.
   */
  beginSpeech(text: string, options: { rate?: number; durationMs?: number } = {}): void {
    this.speaking = true;
    this.listening = false;
    this.thinking = false;
    const rate = Math.max(0.7, Math.min(1.3, options.rate ?? this.prosody().speed));
    let timeline = textToVisemes(text, { rate });
    const measured = options.durationMs;
    if (measured && measured > 200) {
      const total = timelineDuration(timeline);
      if (total > 0) {
        const scale = measured / total;
        timeline = timeline.map((cue) => ({
          ...cue,
          start: cue.start * scale,
          end: cue.end * scale,
        }));
      }
    }
    this.timeline = timeline;
    this.speechStart = this.clock;
  }

  endSpeech(): void {
    this.speaking = false;
    this.timeline = [];
  }

  prosody(): Prosody {
    return this.emotion.prosody();
  }

  describe(): Describe {
    const snap = this.emotion.snapshot();
    return {
      state: this.state,
      label: STATE_LABELS[this.state],
      expression: EMOTION_LABELS[snap.dominant],
      emotion: snap.dominant,
      intensity: snap.intensity,
      core: CORE_STATE[this.state],
    };
  }

  private resolvePrimary(): BehaviourState {
    if (this.flash && this.clock < this.flash.until) return this.flash.state;
    if (this.speaking) return "speaking";
    // Work outranks conversation only while it is actually running; the
    // deadline on every activity keeps this honest.
    if (this.isActive("executing")) return "executing";
    if (this.listening) return "listening";
    if (this.isActive("searching")) return "searching";
    if (this.isActive("reasoning")) return "reasoning";
    // Verification is more specific than the generic thinking flag it also sets.
    if (this.isActive("analyzing")) return "analyzing";
    if (this.thinking) return "thinking";
    if (this.observing) return "observing";
    if (this.isActive("remembering")) return "remembering";
    if (this.learning) return "learning";

    const snap = this.emotion.snapshot();
    if (snap.serious > 0.4 || snap.dominant === "concern" || snap.dominant === "sympathy") {
      return "concerned";
    }
    if (snap.dominant === "excitement" || snap.dominant === "amusement") return "excited";
    if (snap.dominant === "confusion") return "confused";
    if (snap.dominant === "curiosity" && this.present) return "curious";

    const quiet = this.clock - this.lastActivityAt;
    if (!this.present && quiet > 240_000) return "sleeping";
    if (!this.present && quiet > 90_000) return "standby";
    return "idle";
  }

  private collectLayers(primary: BehaviourState): BehaviourState[] {
    const layers: BehaviourState[] = [primary];
    const candidates: BehaviourState[] = [];
    if (this.observing) candidates.push("observing");
    if (this.listening) candidates.push("listening");
    if (this.thinking) candidates.push("thinking");
    if (this.learning) candidates.push("learning");
    if (this.speaking) candidates.push("speaking");
    for (const activity of ["reasoning", "searching", "analyzing", "remembering", "executing"] as ActivityState[]) {
      if (this.isActive(activity)) candidates.push(activity);
    }
    if (this.emotion.snapshot().dominant === "curiosity") candidates.push("curious");
    for (const candidate of candidates) {
      if (layers.includes(candidate)) continue;
      if (COMPATIBLE[primary].includes(candidate)) layers.push(candidate);
    }
    return layers;
  }

  /**
   * Advance one frame. `dtMs` is wall time since the previous sample; the
   * engine clamps it so a stalled tab cannot skip a whole expression.
   */
  sample(dtMs: number, env: { audio?: number; visible?: VisibleCues } = {}): InteractionFrame {
    const dt = Math.max(0, Math.min(120, dtMs));
    this.clock += dt;
    if (env.visible) this.visible = env.visible;

    this.emotion.update(dt);
    const idle = this.idle.update(dt);

    const next = this.resolvePrimary();
    if (next !== this.state) {
      const held = this.clock - this.since;
      const upgrade = PRIORITY[next] > PRIORITY[this.state];
      // A flash is an explicit reaction (an error, an interruption). It is
      // allowed to override immediately instead of waiting out the hold time.
      const flashing = Boolean(this.flash && this.clock < this.flash.until);
      if (upgrade || flashing || held > 420) {
        this.state = next;
        this.since = this.clock;
      }
    }
    // A state can become stale after a flash ends; re-resolve next frame.
    if (this.flash && this.clock >= this.flash.until) this.flash = null;
    this.active = this.collectLayers(this.state);

    const gain = this.settings.expressiveness;
    const face = this.emotion.face();

    // Visible cues are mirrored weakly: a smile is met with a small smile.
    // This is a reaction to visible movement, not a claim about feelings.
    if (this.settings.mirror && this.cameraLive) {
      const smile = Math.max(0, Math.min(1, this.visible.smile ?? 0));
      const brow = Math.max(0, Math.min(1, this.visible.brow ?? 0));
      const squint = Math.max(0, Math.min(1, this.visible.squint ?? 0));
      addFace(face, {
        smile: smile * 0.24,
        cheek: smile * 0.12,
        browRaise: brow * 0.16,
        squint: squint * 0.12,
      });
    }

    for (const layer of this.active) {
      addFace(face, STATE_BIAS[layer], layer === this.state ? 1 : 0.6);
    }

    // micro-expressions are small and deliberately asymmetric in time
    face.browRaise += idle.micro * 0.1;
    face.smile += idle.micro * (idle.microSign > 0 ? 0.08 : 0.02);
    face.squint += idle.micro * 0.05;

    for (const channel of Object.keys(face) as Array<keyof FaceBlendshapes>) {
      face[channel] *= gain;
    }
    clampFace(face);

    const audio = Math.max(0, Math.min(1, env.audio ?? 0));
    let mouth: MouthShape = { ...REST_MOUTH };
    if (this.speaking && this.timeline.length) {
      const shaped = mouthAt(this.timeline, this.clock - this.speechStart);
      mouth = {
        ...shaped,
        // the jaw follows the measured amplitude, so a silent gap closes it
        jaw: Math.max(shaped.jaw * 0.72, audio * 0.95),
        press: shaped.jaw > 0.12 ? shaped.press * 0.4 : shaped.press,
      };
    } else {
      mouth.jaw = Math.max(0, Math.min(1, (this.visible.jaw ?? 0) * 0.12));
    }

    const intensity = 0.55 + 0.45 * gain;
    const nod = idle.nod * 0.5 + (this.speaking ? Math.sin(this.clock / 210) * 0.12 : 0);
    const posture = {
      pitch: nod * intensity,
      roll: idle.tilt * 0.6 * intensity,
      sway: idle.sway * 0.7 * intensity,
      breath: idle.breath,
    };

    return {
      state: this.state,
      active: this.active,
      face,
      mouth,
      blink: idle.blink,
      posture,
      audio,
    };
  }
}
