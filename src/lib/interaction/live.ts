/**
 * HYDRO AI — live interaction policy.
 *
 * The rules that decide whether a live signal becomes a command. Nothing here
 * touches a camera, a microphone, the network or React, so every threshold can
 * be tested without hardware, and a wrong guess is caught by `live-selftest`.
 *
 * Two principles run through the whole file:
 *  - a gesture or sentence is a *measurement*, never an intention; ambiguous
 *    input returns "do nothing" instead of a best guess,
 *  - only the user's own, current, explicit signal may act. HYDRO's own voice
 *    is never transcribed back into a command, and a duplicate utterance is
 *    dropped rather than answered twice.
 */

export type LiveMode =
  | "manual"
  | "voice"
  | "vision"
  | "gesture"
  | "live"
  | "hands-free"
  | "observation"
  | "privacy";

export interface ModeSpec {
  id: LiveMode;
  label: string;
  hint: string;
  /** may capture speech and submit it without the send button */
  mic: boolean;
  /** may use the camera at all */
  camera: boolean;
  /** gesture events may reach the interface */
  gestures: boolean;
  /** a finished transcript is submitted automatically */
  autoSubmit: boolean;
  /** HYDRO may start a conversational turn on its own */
  proactive: boolean;
  /** low-risk commands may run from a gesture without a typed confirmation */
  autoAct: boolean;
  /** frames may be sent to the vision model (a paid look) */
  looks: boolean;
}

export const LIVE_MODES: ModeSpec[] = [
  {
    id: "manual",
    label: "Manual",
    hint: "Typed commands only. Camera and microphone stay off.",
    mic: false,
    camera: false,
    gestures: false,
    autoSubmit: false,
    proactive: false,
    autoAct: false,
    looks: false,
  },
  {
    id: "voice",
    label: "Voice",
    hint: "Speak naturally; HYDRO submits each finished sentence.",
    mic: true,
    camera: false,
    gestures: false,
    autoSubmit: true,
    proactive: false,
    autoAct: false,
    looks: false,
  },
  {
    id: "vision",
    label: "Vision",
    hint: "Camera looks at what you show it. Nothing is executed from a frame.",
    mic: false,
    camera: true,
    gestures: false,
    autoSubmit: false,
    proactive: true,
    autoAct: false,
    looks: true,
  },
  {
    id: "gesture",
    label: "Gesture",
    hint: "Hand and head gestures control the interface. Microphone stays off.",
    mic: false,
    camera: true,
    gestures: true,
    autoSubmit: false,
    proactive: false,
    autoAct: true,
    looks: true,
  },
  {
    id: "live",
    label: "Live interaction",
    hint: "Camera, microphone, speech and gestures together.",
    mic: true,
    camera: true,
    gestures: true,
    autoSubmit: true,
    proactive: true,
    autoAct: true,
    looks: true,
  },
  {
    id: "hands-free",
    label: "Hands-free",
    hint: "Speak and gesture; the camera only looks when asked or pointed at.",
    mic: true,
    camera: true,
    gestures: true,
    autoSubmit: true,
    proactive: false,
    autoAct: true,
    looks: true,
  },
  {
    id: "observation",
    label: "Observation",
    hint: "Look and describe, never execute and never speak on its own.",
    mic: false,
    camera: true,
    gestures: false,
    autoSubmit: false,
    proactive: false,
    autoAct: false,
    looks: true,
  },
  {
    id: "privacy",
    label: "Privacy",
    hint: "Camera and microphone are switched off and stay off.",
    mic: false,
    camera: false,
    gestures: false,
    autoSubmit: false,
    proactive: false,
    autoAct: false,
    looks: false,
  },
];

export const PRIVACY_MODE: LiveMode = "privacy";

export function modeSpec(id: LiveMode | string | null | undefined): ModeSpec {
  return LIVE_MODES.find((m) => m.id === id) ?? LIVE_MODES[0];
}

export function isLiveMode(id: LiveMode | string | null | undefined): boolean {
  // Which modes actually run a hands-free session (mic or gesture).
  const spec = modeSpec(id);
  return spec.autoSubmit || spec.gestures;
}

// ── gesture → command ──────────────────────────────────────────────────────

export type LiveCommand =
  | "greet"
  | "attention"
  | "pause-speech"
  | "approve"
  | "reject"
  | "previous"
  | "next"
  | "scroll-up"
  | "scroll-down"
  | "analyze-object"
  | "acknowledge"
  | "disagree"
  | "stop"
  | "custom";

export const COMMAND_LABELS: Record<LiveCommand, string> = {
  greet: "Greet",
  attention: "Attention",
  "pause-speech": "Pause speech",
  approve: "Approve pending action",
  reject: "Reject pending action",
  previous: "Previous",
  next: "Next",
  "scroll-up": "Scroll up",
  "scroll-down": "Scroll down",
  "analyze-object": "Analyse what is shown",
  acknowledge: "Acknowledge",
  disagree: "Disagree",
  stop: "Stop interaction",
  custom: "Taught gesture",
};

/** Static gesture → command. `null` means "reported in the panel only". */
const GESTURE_COMMANDS: Record<string, LiveCommand | null> = {
  wave: "greet",
  raised_hand: "attention",
  open_palm: "pause-speech",
  thumbs_up: "approve",
  thumbs_down: "reject",
  point: "analyze-object",
  swipe_left: "previous",
  swipe_right: "next",
  swipe_up: "scroll-up",
  swipe_down: "scroll-down",
  two_hand_contract: "stop",
  head_nod: "acknowledge",
  head_shake: "disagree",
  pinch: null,
  two_hand_expand: null,
};

/** A command that would change something needs a pending, non-critical target. */
const ACTING_COMMANDS: LiveCommand[] = ["approve", "reject", "custom"];

export const MIN_GESTURE_CONFIDENCE = 0.66;
/** Two identical commands inside this window are one command. */
export const COMMAND_COOLDOWN_MS = 1200;
/** HYDRO may start a turn on its own at most this often. */
export const PROACTIVE_TURN_INTERVAL_MS = 90_000;

export interface GestureDecisionInput {
  gesture: string;
  confidence: number;
  mode: LiveMode | string;
  /** HYDRO is currently speaking out loud */
  speaking: boolean;
  /** an action is waiting for the user's confirmation */
  pendingApproval: boolean;
  /** risk of the pending action, when there is one */
  pendingRisk?: string | null;
  /** true while the user is waiting on a reply */
  busy?: boolean;
  now: number;
  /** when this same command last ran */
  lastAt?: number | null;
}

export type GestureDecision =
  | { run: false; reason: GestureDenyReason }
  | { run: true; command: LiveCommand; label: string };

export type GestureDenyReason =
  | "unmapped"
  | "mode"
  | "confidence"
  | "cooldown"
  | "nothing-pending"
  | "needs-explicit-approval"
  | "nothing-to-pause"
  | "busy";

/**
 * Decide whether a recognised gesture should do anything.
 *
 * A gesture that is unmapped, too weak, disabled by the mode, or points at
 * nothing to act on is dropped. Silence is the safe answer.
 */
export function decideGesture(input: GestureDecisionInput): GestureDecision {
  const command = GESTURE_COMMANDS[input.gesture] ?? null;
  if (!command) return { run: false, reason: "unmapped" };

  const spec = modeSpec(input.mode);
  const allowed = command === "custom" ? spec.gestures && spec.camera : spec.gestures;
  if (!allowed) return { run: false, reason: "mode" };

  // HYDRO talking over its own command output feels broken; a stop request is
  // the one command that must get through while it is speaking.
  if (input.busy && command !== "pause-speech" && command !== "stop") {
    return { run: false, reason: "busy" };
  }

  if (Number.isFinite(input.confidence) && input.confidence < MIN_GESTURE_CONFIDENCE) {
    return { run: false, reason: "confidence" };
  }

  if (input.lastAt != null && input.now - input.lastAt < COMMAND_COOLDOWN_MS) {
    return { run: false, reason: "cooldown" };
  }

  if (command === "pause-speech" && !input.speaking) {
    return { run: false, reason: "nothing-to-pause" };
  }

  if (ACTING_COMMANDS.includes(command)) {
    if (!input.pendingApproval) return { run: false, reason: "nothing-pending" };
    // A high-risk plan is never approved by a gesture, however confident.
    if (command === "approve" && input.pendingRisk === "high") {
      return { run: false, reason: "needs-explicit-approval" };
    }
  }

  return { run: true, command, label: COMMAND_LABELS[command] };
}

/** Gestures the current mode accepts, for the dashboard and the docs. */
export function availableCommands(mode: LiveMode | string): Array<{ command: LiveCommand; label: string }> {
  const spec = modeSpec(mode);
  if (!spec.gestures) return [];
  const seen = new Set<LiveCommand>();
  const out: Array<{ command: LiveCommand; label: string }> = [];
  for (const command of Object.values(GESTURE_COMMANDS)) {
    if (!command || seen.has(command)) continue;
    if (ACTING_COMMANDS.includes(command) && !spec.autoAct) continue;
    seen.add(command);
    out.push({ command, label: COMMAND_LABELS[command] });
  }
  return out;
}

// ── speech segmentation ────────────────────────────────────────────────────

export const SPEECH = {
  /** measured RMS above which a frame counts as voice (0…1) */
  startLevel: 0.018,
  /** consecutive voiced frames needed before a recording starts */
  startFrames: 2,
  /** silence after speech that ends an utterance */
  endSilenceMs: 1100,
  /** a shorter burst is a cough, a door or a click — not a command */
  minSpeechMs: 420,
  /** an utterance longer than this is cut and transcribed as it stands */
  maxUtteranceMs: 16_000,
  /** pause after a reply before the microphone listens again */
  resumeDelayMs: 500,
} as const;

export type SegmentEvent = "start" | "end" | "too-short" | "discard" | null;

/**
 * Turn a stream of loudness samples into utterance boundaries.
 *
 * The caller records only between `start` and `end`, so silence is never sent
 * for transcription, and a burst of noise never becomes a command.
 */
export class SpeechSegmenter {
  private state: "idle" | "speech" = "idle";
  private voicedFrames = 0;
  private startedAt = 0;
  private lastVoiceAt = 0;

  get recording(): boolean {
    return this.state === "speech";
  }

  reset(): void {
    this.state = "idle";
    this.voicedFrames = 0;
    this.startedAt = 0;
    this.lastVoiceAt = 0;
  }

  /** Feed one loudness measurement. */
  push(level: number, now: number): SegmentEvent {
    const loud = Number.isFinite(level) && level >= SPEECH.startLevel;

    if (this.state === "idle") {
      this.voicedFrames = loud ? this.voicedFrames + 1 : 0;
      if (this.voicedFrames >= SPEECH.startFrames) {
        this.state = "speech";
        this.startedAt = now;
        this.lastVoiceAt = now;
        this.voicedFrames = 0;
        return "start";
      }
      return null;
    }

    if (loud) this.lastVoiceAt = now;

    const elapsed = now - this.startedAt;
    const quiet = now - this.lastVoiceAt;
    // How long the user was actually speaking, not how long the segment ran.
    const voicedFor = this.lastVoiceAt - this.startedAt;

    if (elapsed > SPEECH.maxUtteranceMs) {
      this.reset();
      return "end";
    }
    if (quiet < SPEECH.endSilenceMs) return null;

    this.reset();
    return voicedFor >= SPEECH.minSpeechMs ? "end" : "too-short";
  }
}

// ── transcript acceptance ──────────────────────────────────────────────────

function words(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Share of the transcript's words that also appear in `reference`. */
export function echoOverlap(transcript: string, reference: string): number {
  const a = words(transcript);
  if (!a.length) return 0;
  const b = new Set(words(reference));
  if (!b.size) return 0;
  const hits = a.filter((w) => b.has(w)).length;
  return hits / a.length;
}

/**
 * HYDRO's own voice comes out of the speakers and can be picked up again.
 * More than half of the words being a repeat of what was just said is an echo.
 */
export function isLikelyEcho(transcript: string, spoken: string): boolean {
  if (!spoken.trim()) return false;
  // One shared word in a two-word utterance is not evidence of anything.
  if (words(transcript).length < 4) return false;
  return echoOverlap(transcript, spoken) > 0.55;
}

/** Remove the fillers a speech model adds, without changing the meaning. */
export function cleanTranscript(text: string): string {
  let clean = (text ?? "").trim();
  // Fillers chain: "um, so what..." has two of them.
  for (let i = 0; i < 3; i++) {
    const next = clean.replace(/^(um+|uh+|erm+|hmm+|okay so|so|yeah so)\b[,.]?\s+/i, "");
    if (next === clean) break;
    clean = next;
  }
  return clean.replace(/\s+/g, " ").trim();
}

const CANCEL_PHRASES = [
  /^(cancel|never ?mind|forget it|stop listening|stop that)\b/i,
  /^(cancel|stop) (the )?(message|command|that)\b/i,
];

export function isCancelPhrase(text: string): boolean {
  const clean = (text ?? "").trim();
  if (!clean) return false;
  // "cancel my subscription tomorrow" is a request, not a cancel command, so
  // only a short, clearly addressed phrase counts.
  if (clean.split(/\s+/).filter(Boolean).length > 3) return false;
  return CANCEL_PHRASES.some((re) => re.test(clean));
}

export interface SubmitInput {
  text: string;
  mode: LiveMode | string;
  /** HYDRO is speaking right now */
  speaking: boolean;
  /** the last thing HYDRO said out loud, for echo rejection */
  echoText?: string;
  /** last transcript that was submitted, and when */
  lastSubmitted?: { text: string; at: number } | null;
  now: number;
  /** true while the user is waiting on a reply */
  busy?: boolean;
}

export type SubmitDecision =
  | { submit: false; reason: "mode" | "empty" | "short" | "echo" | "duplicate" | "busy" | "cancel" }
  | { submit: true; text: string };

const DUPLICATE_WINDOW_MS = 8000;

/**
 * Decide whether a finished transcript should become a message.
 *
 * Everything here is a reason *not* to send, so a noisy room cannot fill the
 * conversation with commands the user never meant.
 */
export function decideSubmit(input: SubmitInput): SubmitDecision {
  if (!modeSpec(input.mode).autoSubmit) return { submit: false, reason: "mode" };
  const text = cleanTranscript(input.text);
  if (!text) return { submit: false, reason: "empty" };
  if (isCancelPhrase(text)) return { submit: false, reason: "cancel" };
  if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return { submit: false, reason: "short" };
  if (input.speaking) return { submit: false, reason: "echo" };
  if (isLikelyEcho(text, input.echoText ?? "")) return { submit: false, reason: "echo" };
  if (input.busy) return { submit: false, reason: "busy" };
  const last = input.lastSubmitted;
  if (last && input.now - last.at < DUPLICATE_WINDOW_MS && words(last.text).join(" ") === words(text).join(" ")) {
    return { submit: false, reason: "duplicate" };
  }
  return { submit: true, text };
}

// ── spoken mode changes ────────────────────────────────────────────────────

const MODE_WORDS: Array<{ mode: LiveMode; re: RegExp }> = [
  { mode: "hands-free", re: /\b(hands?[- ]free)\b/ },
  { mode: "live", re: /\b(live( interaction)? mode|live mode)\b/ },
  { mode: "observation", re: /\b(observation|observe) mode\b/ },
  { mode: "gesture", re: /\bgesture(s)? mode\b/ },
  { mode: "vision", re: /\b(vision|camera) mode\b/ },
  { mode: "voice", re: /\bvoice mode\b/ },
  { mode: "privacy", re: /\b(privacy|private) mode\b/ },
  { mode: "manual", re: /\b(manual|typing) mode\b/ },
];

export type SpokenControl =
  | { kind: "mode"; mode: LiveMode }
  | { kind: "stop-microphone" }
  | { kind: "stop-camera" }
  | { kind: "stop-all" };

/**
 * Only a short, explicitly addressed phrase changes a mode. A long sentence
 * that happens to contain "privacy mode" is a question, not a command.
 */
export function detectSpokenControl(text: string): SpokenControl | null {
  const clean = (text ?? "").trim().toLowerCase();
  if (!clean) return null;
  const count = clean.split(/\s+/).filter(Boolean).length;

  if (count <= 5) {
    if (/^(stop listening|microphone off|mute( the)? mic(rophone)?)$/.test(clean)) {
      return { kind: "stop-microphone" };
    }
    if (/^(stop (the )?camera|camera off|turn off (the )?camera)$/.test(clean)) {
      return { kind: "stop-camera" };
    }
    if (/^(stop everything|emergency stop|stop interaction)$/.test(clean)) {
      return { kind: "stop-all" };
    }
  }

  if (count <= 6) {
    for (const entry of MODE_WORDS) {
      if (entry.re.test(clean)) return { kind: "mode", mode: entry.mode };
    }
  }
  return null;
}

// ── observation questions ──────────────────────────────────────────────────

/** A deliberate presentation of an object: the frame plus the pointing. */
export const PRESENT_QUESTION =
  "The user is deliberately pointing at or holding up something for you. Describe only that object or text, and say plainly if it is unclear. Do not identify people.";

/** Asked when HYDRO decides to speak first after noticing someone arrive. */
export function presencePrompt(): string {
  return "I just appeared on camera. Greet me in one short sentence and offer one concrete thing you can help with right now.";
}

/** Asked when a gesture should become a conversational turn. */
export function gesturePrompt(label: string): string {
  return `I just used the camera gesture "${label}". Respond briefly and naturally, in one or two sentences.`;
}
