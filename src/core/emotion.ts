/**
 * HYDRO AI — simulated emotional state engine.
 *
 * This is a *simulation*, not sentience. It keeps a small continuous affect
 * state (valence / arousal / dominance), a slow mood baseline, and a set of
 * discrete emotion intensities that are derived from that state. The output is
 * a FACS-inspired set of facial channels plus speech prosody — the same values
 * the shader rig and the speech request consume.
 *
 * Why FACS channel names: Facial Action Coding System action units are a
 * descriptive vocabulary for visible muscle movement (AU1 inner brow raise,
 * AU12 lip-corner pull, AU26 jaw drop…). Using them keeps the rig honest and
 * makes each channel traceable to one deformation in the shader, instead of
 * playing canned animation clips.
 *
 * Nothing here reads the user's real feelings. `appraise()` reads the *words* of
 * a message; `face()` describes what HYDRO is displaying.
 */

import { clamp } from "./util.ts";

export const EMOTION_NAMES = [
  "neutral",
  "happiness",
  "sadness",
  "anger",
  "fear",
  "surprise",
  "disgust",
  "confusion",
  "curiosity",
  "excitement",
  "disappointment",
  "confidence",
  "embarrassment",
  "nervousness",
  "frustration",
  "concentration",
  "realization",
  "concern",
  "sympathy",
  "amusement",
  // A second family of presets, added so the rig can express states the first
  // twenty could not name (pride, resolve, awe, weariness…). Each one is a real
  // prototype below, not a label with no gate.
  "pride",
  "gratitude",
  "awe",
  "boredom",
  "hope",
  "resolve",
  "skepticism",
  "relief",
  "longing",
  "defiance",
  "tenderness",
  "weariness",
] as const;

export type EmotionName = (typeof EMOTION_NAMES)[number];

/** Facial channels, each 0…1. These map 1:1 onto shader deformations. */
export interface FaceBlendshapes {
  /** AU1 + AU2 — inner and outer brow raise */
  browRaise: number;
  /** AU4 — brow lowerer (frown crease) */
  browLower: number;
  /** AU5 — upper lid raise (eyes wide) */
  lidWide: number;
  /** AU6 + AU7 — cheek raise / lid tighten (squint) */
  squint: number;
  /** AU12 — lip corner pull (smile) */
  smile: number;
  /** AU15 — lip corner depress */
  frown: number;
  /** AU9 — nose wrinkle */
  noseWrinkle: number;
  /** AU24 — lip press */
  mouthPress: number;
  /** AU20 — lip stretch */
  lipStretch: number;
  /** AU18 — lip pucker */
  pucker: number;
  /** AU26 — jaw drop */
  jaw: number;
  /** AU6 — cheek raise */
  cheek: number;
}

export const FACE_CHANNELS: Array<keyof FaceBlendshapes> = [
  "browRaise",
  "browLower",
  "lidWide",
  "squint",
  "smile",
  "frown",
  "noseWrinkle",
  "mouthPress",
  "lipStretch",
  "pucker",
  "jaw",
  "cheek",
];

export function zeroFace(): FaceBlendshapes {
  return {
    browRaise: 0,
    browLower: 0,
    lidWide: 0,
    squint: 0,
    smile: 0,
    frown: 0,
    noseWrinkle: 0,
    mouthPress: 0,
    lipStretch: 0,
    pucker: 0,
    jaw: 0,
    cheek: 0,
  };
}

/** Adds `source * k` into `target`, channel by channel. */
export function addFace(
  target: FaceBlendshapes,
  source: Partial<FaceBlendshapes>,
  k = 1,
): FaceBlendshapes {
  for (const channel of FACE_CHANNELS) {
    const value = source[channel];
    if (typeof value === "number") target[channel] += value * k;
  }
  return target;
}

export function clampFace(face: FaceBlendshapes): FaceBlendshapes {
  for (const channel of FACE_CHANNELS) face[channel] = clamp(face[channel], 0, 1);
  return face;
}

interface Prototype {
  /** valence, arousal, dominance at which this emotion is fully expressed */
  anchor: [number, number, number];
  face: Partial<FaceBlendshapes>;
}

/**
 * Emotion prototypes. The anchor is the affect-space position that maximises
 * the emotion; the face is its FACS signature. Blends come from several
 * anchors overlapping (e.g. happiness + amusement), which is what stops the
 * face from snapping between single expressions.
 */
export const PROTOTYPES: Record<EmotionName, Prototype> = {
  neutral: { anchor: [0, 0.16, 0], face: {} },
  happiness: {
    anchor: [0.72, 0.5, 0.3],
    face: { smile: 0.88, cheek: 0.52, squint: 0.2, browRaise: 0.16, jaw: 0.08 },
  },
  sadness: {
    anchor: [-0.72, 0.12, -0.4],
    face: { browRaise: 0.55, frown: 0.72, mouthPress: 0.26, jaw: 0.04, squint: 0.12 },
  },
  anger: {
    anchor: [-0.62, 0.78, 0.6],
    face: { browLower: 0.82, mouthPress: 0.5, noseWrinkle: 0.3, jaw: 0.16, frown: 0.35 },
  },
  fear: {
    anchor: [-0.55, 0.7, -0.5],
    face: { lidWide: 0.8, browRaise: 0.85, jaw: 0.35, lipStretch: 0.4, mouthPress: 0.1 },
  },
  surprise: {
    anchor: [0.22, 0.86, 0.0],
    face: { lidWide: 0.72, browRaise: 0.92, jaw: 0.55, mouthPress: 0 },
  },
  disgust: {
    anchor: [-0.62, 0.42, 0.2],
    face: { noseWrinkle: 0.88, browLower: 0.55, mouthPress: 0.42, frown: 0.28 },
  },
  confusion: {
    anchor: [-0.18, 0.36, -0.2],
    face: { browLower: 0.34, browRaise: 0.28, squint: 0.3, mouthPress: 0.2, frown: 0.12 },
  },
  curiosity: {
    anchor: [0.36, 0.5, 0.1],
    face: { browRaise: 0.46, lidWide: 0.26, smile: 0.18, cheek: 0.14 },
  },
  excitement: {
    anchor: [0.82, 0.86, 0.5],
    face: { smile: 0.95, browRaise: 0.6, jaw: 0.3, cheek: 0.62, lidWide: 0.25 },
  },
  disappointment: {
    anchor: [-0.46, 0.2, -0.25],
    face: { frown: 0.58, browRaise: 0.3, mouthPress: 0.22, squint: 0.1 },
  },
  confidence: {
    anchor: [0.46, 0.34, 0.66],
    face: { smile: 0.42, squint: 0.16, browLower: 0.1, jaw: 0.04 },
  },
  embarrassment: {
    anchor: [-0.22, 0.5, -0.5],
    face: { browRaise: 0.36, smile: 0.24, squint: 0.2, pucker: 0.12, mouthPress: 0.18 },
  },
  nervousness: {
    anchor: [-0.25, 0.62, -0.45],
    face: { lipStretch: 0.36, browRaise: 0.4, mouthPress: 0.22, squint: 0.14 },
  },
  frustration: {
    anchor: [-0.52, 0.66, 0.2],
    face: { browLower: 0.72, mouthPress: 0.55, jaw: 0.1, frown: 0.3 },
  },
  concentration: {
    anchor: [0.05, 0.46, 0.3],
    face: { browLower: 0.42, squint: 0.46, mouthPress: 0.2 },
  },
  realization: {
    anchor: [0.36, 0.62, 0.2],
    face: { browRaise: 0.72, lidWide: 0.5, jaw: 0.2, smile: 0.18 },
  },
  concern: {
    anchor: [-0.38, 0.36, -0.1],
    face: { browRaise: 0.5, frown: 0.36, squint: 0.12, mouthPress: 0.14 },
  },
  sympathy: {
    anchor: [-0.2, 0.22, 0.0],
    face: { browRaise: 0.46, frown: 0.3, smile: 0.1, squint: 0.1 },
  },
  amusement: {
    anchor: [0.76, 0.62, 0.2],
    face: { smile: 0.8, cheek: 0.58, squint: 0.38, jaw: 0.2, browRaise: 0.12 },
  },
  pride: {
    anchor: [0.58, 0.34, 0.68],
    face: { smile: 0.56, cheek: 0.34, squint: 0.16, browRaise: 0.16, jaw: 0.04 },
  },
  gratitude: {
    anchor: [0.66, 0.2, 0.34],
    face: { smile: 0.7, cheek: 0.42, browRaise: 0.24, squint: 0.14 },
  },
  awe: {
    anchor: [0.62, 0.84, -0.28],
    face: { lidWide: 0.7, browRaise: 0.82, jaw: 0.44, smile: 0.22 },
  },
  boredom: {
    anchor: [-0.12, 0.02, -0.22],
    face: { browLower: 0.16, mouthPress: 0.22, squint: 0.3, frown: 0.08 },
  },
  hope: {
    anchor: [0.5, 0.4, 0.24],
    face: { smile: 0.4, browRaise: 0.44, lidWide: 0.18, cheek: 0.18 },
  },
  resolve: {
    anchor: [0.22, 0.46, 0.6],
    face: { browLower: 0.3, mouthPress: 0.26, squint: 0.22, cheek: 0.08 },
  },
  skepticism: {
    anchor: [-0.26, 0.24, 0.3],
    face: { browLower: 0.3, browRaise: 0.26, mouthPress: 0.28, squint: 0.14 },
  },
  relief: {
    anchor: [0.52, 0.16, 0.14],
    face: { smile: 0.5, browRaise: 0.2, squint: 0.2, jaw: 0.08 },
  },
  longing: {
    anchor: [-0.24, 0.2, -0.32],
    face: { browRaise: 0.42, frown: 0.22, mouthPress: 0.16, squint: 0.1 },
  },
  defiance: {
    anchor: [-0.4, 0.56, 0.64],
    face: { browLower: 0.66, mouthPress: 0.4, lipStretch: 0.24, jaw: 0.08 },
  },
  tenderness: {
    anchor: [0.44, 0.14, 0.08],
    face: { smile: 0.48, browRaise: 0.32, squint: 0.2, cheek: 0.2 },
  },
  weariness: {
    anchor: [-0.34, 0.06, -0.26],
    face: { squint: 0.36, mouthPress: 0.24, browLower: 0.18, frown: 0.1 },
  },
};

/** Smooth 0…1 ramp, used for the gate conditions below. */
function band(x: number, lo: number, hi: number): number {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Gate conditions.
 *
 * Pure distance to an anchor is not enough: "calm and slightly warm" sits near
 * several low-intensity anchors (confusion, sympathy), so a resting HYDRO would
 * be labelled confused. A gate states the affect region in which an emotion is
 * even possible — confusion needs negative valence and real arousal, confidence
 * needs dominance — and outside it the target is zero. Neutral is not here: it
 * is the residual, computed in `update()`.
 */
const GATES: Record<EmotionName, (v: number, a: number, d: number) => number> = {
  neutral: () => 0,
  happiness: (v, a) => band(v, 0.25, 0.55) * band(a, 0.05, 0.35),
  sadness: (v, a) => band(-v, 0.35, 0.75) * (1 - band(a, 0.45, 0.75)),
  anger: (v, a, d) => band(-v, 0.3, 0.7) * band(a, 0.5, 0.8) * band(d, -0.1, 0.4),
  fear: (v, a, d) => band(-v, 0.25, 0.65) * band(a, 0.45, 0.8) * (1 - band(d, -0.4, 0.2)),
  surprise: (v, a) => band(a, 0.55, 0.9) * (1 - band(-v, 0.2, 0.7)),
  disgust: (v, a) => band(-v, 0.35, 0.75) * band(a, 0.2, 0.6),
  confusion: (v, a, d) => band(-v, 0, 0.45) * band(a, 0.15, 0.45) * (1 - band(d, 0.2, 0.6)),
  curiosity: (v, a) => band(v, 0.15, 0.6) * band(a, 0.25, 0.6) * (1 - band(a, 0.8, 1)),
  excitement: (v, a) => band(v, 0.5, 0.85) * band(a, 0.55, 0.9),
  disappointment: (v, a) => band(-v, 0.2, 0.6) * (1 - band(a, 0.35, 0.7)),
  confidence: (v, _a, d) => band(v, 0.2, 0.6) * band(d, 0.2, 0.7),
  embarrassment: (v, a, d) => band(-v, 0, 0.4) * band(a, 0.3, 0.65) * (1 - band(d, 0.1, 0.5)),
  nervousness: (v, a, d) => band(-v, 0.05, 0.5) * band(a, 0.35, 0.75) * (1 - band(d, -0.6, 0.1)),
  frustration: (v, a) => band(-v, 0.25, 0.65) * band(a, 0.4, 0.75),
  concentration: (v, a) => band(a, 0.3, 0.65) * (1 - band(Math.abs(v), 0.4, 0.9)),
  realization: (v, a) => band(a, 0.4, 0.75) * band(v, 0.05, 0.6),
  // Concern needs a genuinely non-positive reading. Resting warmth is positive
  // valence, and labeling that "concerned" was the bug this gate prevents.
  concern: (v, a, d) =>
    (1 - band(v, -0.05, 0.25)) * band(a, 0.15, 0.45) * (1 - band(d, 0.3, 0.7)),
  sympathy: (v, a) => band(-v, 0.05, 0.5) * (1 - band(a, 0.4, 0.8)),
  amusement: (v, a) => band(v, 0.45, 0.8) * band(a, 0.35, 0.7),
  pride: (v, _a, d) => band(v, 0.3, 0.75) * band(d, 0.3, 0.8),
  gratitude: (v, a, d) =>
    band(v, 0.35, 0.8) * (1 - band(a, 0.35, 0.7)) * band(d, 0.05, 0.55),
  awe: (v, a, d) => band(v, 0.4, 0.85) * band(a, 0.6, 0.95) * (1 - band(d, -0.2, 0.4)),
  boredom: (v, a, d) =>
    (1 - band(v, -0.3, 0.3)) * (1 - band(a, 0.12, 0.42)) * (1 - band(d, -0.1, 0.45)),
  hope: (v, a, d) => band(v, 0.2, 0.55) * band(a, 0.15, 0.5) * band(d, -0.05, 0.4),
  resolve: (v, a, d) => band(v, 0.0, 0.4) * band(a, 0.2, 0.6) * band(d, 0.25, 0.8),
  skepticism: (v, a, d) =>
    band(-v, 0.08, 0.5) * (1 - band(a, 0.4, 0.8)) * band(d, 0.05, 0.55),
  relief: (v, a, d) => band(v, 0.32, 0.75) * (1 - band(a, 0.3, 0.65)) * band(d, -0.1, 0.45),
  longing: (v, a, d) =>
    band(-v, 0.05, 0.45) * (1 - band(a, 0.35, 0.75)) * (1 - band(d, -0.15, 0.45)),
  defiance: (v, a, d) => band(-v, 0.2, 0.65) * band(a, 0.35, 0.75) * band(d, 0.3, 0.85),
  tenderness: (v, a, d) =>
    band(v, 0.2, 0.6) * (1 - band(a, 0.3, 0.65)) * band(d, -0.2, 0.4),
  weariness: (v, a, d) =>
    band(-v, 0.1, 0.5) * (1 - band(a, 0.15, 0.5)) * (1 - band(d, 0.0, 0.45)),
};

export const EMOTION_LABELS: Record<EmotionName, string> = {
  neutral: "Neutral",
  happiness: "Happy",
  sadness: "Sad",
  anger: "Angry",
  fear: "Wary",
  surprise: "Surprised",
  disgust: "Displeased",
  confusion: "Confused",
  curiosity: "Curious",
  excitement: "Excited",
  disappointment: "Disappointed",
  confidence: "Confident",
  embarrassment: "Sheepish",
  nervousness: "Nervous",
  frustration: "Frustrated",
  concentration: "Focused",
  realization: "Realising",
  concern: "Concerned",
  sympathy: "Sympathetic",
  amusement: "Amused",
  pride: "Proud",
  gratitude: "Grateful",
  awe: "In awe",
  boredom: "Bored",
  hope: "Hopeful",
  resolve: "Resolved",
  skepticism: "Sceptical",
  relief: "Relieved",
  longing: "Wistful",
  defiance: "Defiant",
  tenderness: "Tender",
  weariness: "Weary",
};

export interface Personality {
  /** 0…1 — how strongly emotions show on the face */
  expressiveness: number;
  /** 0…1 — how warm the resting baseline is */
  warmth: number;
  /** 0…1 — how quickly affect returns to baseline (higher = calmer) */
  composure: number;
}

export const DEFAULT_PERSONALITY: Personality = {
  expressiveness: 0.78,
  warmth: 0.55,
  composure: 0.55,
};

export interface AffectSnapshot {
  valence: number;
  arousal: number;
  dominance: number;
  intensity: number;
  dominant: EmotionName;
  serious: number;
  intensities: Record<EmotionName, number>;
}

export interface Prosody {
  /** speech rate multiplier, 0.86…1.14 */
  rate: number;
  /** pitch offset in semitones, −2…+3 */
  pitch: number;
  /** 0…1 relative loudness */
  volume: number;
  /** pause inserted after a sentence, in ms */
  pauseMs: number;
  /** ElevenLabs style exaggeration, 0…0.7 */
  style: number;
  /** ElevenLabs stability, 0.25…0.75 */
  stability: number;
  /** ElevenLabs speed, 0.7…1.2 */
  speed: number;
}

const POSITIVE = new Set([
  "good","great","nice","love","loved","lovely","thanks","thank","thankyou","awesome",
  "amazing","perfect","happy","glad","excited","brilliant","excellent","wonderful",
  "helpful","please","yes","yeah","ok","okay","cool","beautiful","fun","funny","best",
  "works","worked","fixed","solved","clear","useful","kind","appreciate","congrats",
]);

const NEGATIVE = new Set([
  "bad","hate","wrong","broken","break","fail","failed","failure","error","errors",
  "sad","angry","scared","afraid","worried","worry","terrible","awful","useless",
  "stupid","ugly","problem","bug","bugs","crash","crashed","slow","confused","lost",
  "lonely","hurt","pain","annoying","annoyed","frustrated","annoy","hateful","no",
  "never","can't","cannot","won't","stop","useless","boring","tired","mess","disaster",
]);

const HIGH_AROUSAL = new Set([
  "urgent","now","asap","emergency","immediately","quick","quickly","hurry","help",
  "wow","amazing","terrible","angry","crash","crashed","broken","hate","love","fast",
  "loud","panic","alarm","critical","fire","run",
]);

const SERIOUS = new Set([
  "death","died","dying","funeral","cancer","diagnosis","diagnosed","hospital","sick",
  "illness","grief","grieving","suicide","abuse","divorce","fired","debt","depressed",
  "depression","anxiety","panic","emergency","accident","lost","passed","buried",
  "surgery","terminal","mourning","trauma","abused","emergency",
]);

const GREETINGS = new Set(["hi","hello","hey","namaste","namaskaram","hola","morning","evening","yo"]);
const GRATITUDE = new Set(["thanks","thank","thankyou","appreciate","grateful"]);

export interface Appraisal {
  /** −1…1 wording polarity */
  valence: number;
  /** 0…1 wording intensity */
  arousal: number;
  /** −1…1 how much control the writer appears to have */
  dominance: number;
  /** 0…1 how much weight to give this appraisal */
  strength: number;
  /** deterministic tags, useful for tests and for the inspector */
  tags: string[];
  /** true for a topic that deserves a calm, careful response */
  serious: boolean;
}

const TOKEN_SPLIT = /[^a-z0-9']+/g;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(TOKEN_SPLIT)
    .filter(Boolean);
}

const NEGATORS = new Set([
  "not","no","never","dont","don't","doesnt","doesn't","didnt","didn't","isnt","isn't",
  "arent","aren't","wasnt","wasn't","cannot","can't","cant","without","hardly","barely",
]);

/**
 * Reads the wording of a message. It does not infer the user's emotion — it is
 * a cue for HYDRO's *own* simulated reaction, and it is deterministic so it can
 * be tested.
 */
export function appraise(text: string): Appraisal {
  const words = tokens(text);
  const tags: string[] = [];
  let valence = 0;
  let arousal = 0;
  let dominance = 0;
  let hits = 0;
  let serious = false;

  const question = /\?/.test(text);
  const exclaims = (text.match(/!/g) ?? []).length;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (SERIOUS.has(word)) {
      serious = true;
      tags.push("serious-topic");
    }
    if (GREETINGS.has(word)) {
      valence += 0.28;
      arousal -= 0.08;
      hits += 1;
      tags.push("greeting");
    }
    if (GRATITUDE.has(word)) {
      valence += 0.34;
      hits += 1;
      tags.push("gratitude");
    }

    const positive = POSITIVE.has(word);
    const negative = NEGATIVE.has(word);
    if (!positive && !negative) continue;

    let sign = positive ? 1 : -1;
    // "not good" reads as negative; the negator must be adjacent to count
    for (let back = 1; back <= 2 && i - back >= 0; back++) {
      if (NEGATORS.has(words[i - back])) {
        sign *= -1;
        tags.push("negated");
        break;
      }
    }

    valence += sign * 0.26;
    arousal += sign > 0 ? 0.06 : 0.18;
    dominance += sign > 0 ? 0.05 : -0.12;
    hits += 1;
    if (HIGH_AROUSAL.has(word)) arousal += 0.2;
  }

  if (question) {
    arousal += 0.1;
    dominance -= 0.06;
    tags.push("question");
  }
  if (exclaims > 0) {
    arousal += Math.min(0.3, exclaims * 0.12);
    tags.push("emphasis");
  }

  // SHOUTING is a visible wording cue, and it raises simulated arousal.
  const shouted = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  if (shouted > 0) {
    arousal += Math.min(0.35, shouted * 0.1);
    tags.push("capitalised");
  }

  if (!hits && !question) tags.push("neutral-wording");
  if (serious) {
    // A serious topic lowers excitement and raises empathic concern; the
    // controller turns this into a calmer face and a slower voice.
    arousal = Math.min(arousal, 0.42);
    dominance -= 0.1;
    valence = Math.min(valence, 0.05);
  }

  return {
    valence: clamp(valence, -1, 1),
    arousal: clamp(arousal, 0, 1),
    dominance: clamp(dominance, -1, 1),
    strength: hits ? clamp(0.35 + hits * 0.12, 0.35, 0.9) : 0.2,
    tags,
    serious,
  };
}

/**
 * Continuous affect with a slow mood baseline and blended emotions.
 *
 * Time is passed in explicitly (`update(dtMs)`), so the same engine behaves
 * identically in a test and in the browser.
 */
export class EmotionEngine {
  personality: Personality = { ...DEFAULT_PERSONALITY };

  /** current affect */
  valence = 0;
  arousal = 0.16;
  dominance = 0;

  /** slow baselines; mood drifts, it does not jump */
  moodValence = 0.12;
  moodArousal = 0.24;
  moodDominance = 0;

  /** 0…1, decays after a serious turn */
  serious = 0;

  readonly intensities: Record<EmotionName, number> = Object.fromEntries(
    EMOTION_NAMES.map((name) => [name, 0]),
  ) as Record<EmotionName, number>;

  constructor(personality: Partial<Personality> = {}) {
    this.personality = { ...DEFAULT_PERSONALITY, ...personality };
    this.moodValence = -0.2 + 0.7 * this.personality.warmth;
    this.valence = this.moodValence;
  }

  setPersonality(patch: Partial<Personality>): void {
    this.personality = {
      ...this.personality,
      ...patch,
      expressiveness: clamp(patch.expressiveness ?? this.personality.expressiveness, 0, 1),
      warmth: clamp(patch.warmth ?? this.personality.warmth, 0, 1),
      composure: clamp(patch.composure ?? this.personality.composure, 0, 1),
    };
    this.moodValence = -0.2 + 0.7 * this.personality.warmth;
  }

  /** Nudge the mood baseline: the user-approved "learn my preferences" path. */
  shiftMood(patch: { valence?: number; arousal?: number; dominance?: number }): void {
    this.moodValence = clamp(this.moodValence + (patch.valence ?? 0) * 0.1, -0.8, 0.8);
    this.moodArousal = clamp(this.moodArousal + (patch.arousal ?? 0) * 0.1, 0.05, 0.7);
    this.moodDominance = clamp(this.moodDominance + (patch.dominance ?? 0) * 0.1, -0.6, 0.6);
  }

  /** Apply a momentary impulse (an event), not a permanent mood change. */
  stimulate(input: { valence?: number; arousal?: number; dominance?: number; strength?: number }): void {
    const k = clamp(input.strength ?? 1, 0, 1.5);
    this.valence = clamp(this.valence + (input.valence ?? 0) * 0.55 * k, -1, 1);
    this.arousal = clamp(this.arousal + (input.arousal ?? 0) * 0.5 * k, 0, 1);
    this.dominance = clamp(this.dominance + (input.dominance ?? 0) * 0.45 * k, -1, 1);
  }

  /** Feed a user message through the wording appraisal. */
  read(text: string, strengthScale = 1): Appraisal {
    const result = appraise(text);
    if (result.serious) this.serious = Math.max(this.serious, 0.85);
    this.stimulate({
      valence: result.valence,
      arousal: result.arousal,
      dominance: result.dominance,
      strength: result.strength * strengthScale,
    });
    return result;
  }

  /** Merge the affect state toward the prototypes. */
  update(dtMs: number): AffectSnapshot {
    const dt = clamp(dtMs, 0, 250);
    if (dt <= 0) return this.snapshot();

    const relax = (value: number, target: number, tau: number) =>
      value + (target - value) * (1 - Math.exp(-dt / tau));

    const calm = 1600 + this.personality.composure * 4200;
    this.valence = clamp(relax(this.valence, this.moodValence, calm), -1, 1);
    this.arousal = clamp(relax(this.arousal, this.moodArousal, 2400), 0, 1);
    this.dominance = clamp(relax(this.dominance, this.moodDominance, 3200), -1, 1);
    this.serious = Math.max(0, this.serious - dt / 26_000);

    let peak = 0;
    for (const name of EMOTION_NAMES) {
      if (name === "neutral") continue;
      const { anchor } = PROTOTYPES[name];
      const dv = (this.valence - anchor[0]) * 0.72;
      const da = (this.arousal - anchor[1]) * 1.0;
      const dd = (this.dominance - anchor[2]) * 0.55;
      const distance = Math.sqrt(dv * dv + da * da + dd * dd) / 1.25;
      const gate = GATES[name](this.valence, this.arousal, this.dominance);
      const target = Math.pow(clamp(1 - distance, 0, 1), 1.6) * gate;
      const current = this.intensities[name];
      const tau = target > current ? 420 : 1100;
      this.intensities[name] = current + (target - current) * (1 - Math.exp(-dt / tau));
      peak = Math.max(peak, this.intensities[name]);
    }
    // Neutral is the absence of a specific emotion, not a competing anchor.
    this.intensities.neutral = clamp(1 - 1.5 * peak, 0, 1);
    return this.snapshot();
  }

  snapshot(): AffectSnapshot {
    // A specific emotion must clear a small floor before it is named; below
    // that the face is simply neutral.
    let dominant: EmotionName = "neutral";
    let best = 0.16;
    let intensity = 0;
    for (const name of EMOTION_NAMES) {
      if (name === "neutral") continue;
      const value = this.intensities[name];
      intensity = Math.max(intensity, value);
      if (value > best) {
        best = value;
        dominant = name;
      }
    }
    return {
      valence: this.valence,
      arousal: this.arousal,
      dominance: this.dominance,
      intensity: dominant === "neutral" ? 0 : intensity,
      dominant,
      serious: this.serious,
      intensities: { ...this.intensities },
    };
  }

  /**
   * The displayed face: every emotion contributes its FACS signature, blended
   * and soft-clamped so channels stay in 0…1 instead of saturating to a mask.
   */
  face(): FaceBlendshapes {
    const out = zeroFace();
    for (const name of EMOTION_NAMES) {
      const weight = this.intensities[name];
      if (weight <= 0.001) continue;
      addFace(out, PROTOTYPES[name].face, weight);
    }

    const gain = 0.35 + 0.9 * this.personality.expressiveness;
    for (const channel of FACE_CHANNELS) {
      out[channel] = 1 - Math.exp(-1.25 * out[channel] * gain);
    }

    // A serious turn suppresses smiling and broad excitement without touching
    // the calm, attentive channels.
    const serious = this.serious;
    if (serious > 0.01) {
      out.smile *= 1 - 0.8 * serious;
      out.cheek *= 1 - 0.5 * serious;
      out.jaw *= 1 - 0.5 * serious;
      out.browRaise = Math.min(1, out.browRaise + 0.22 * serious);
      out.frown = Math.min(1, out.frown + 0.18 * serious);
    }
    return clampFace(out);
  }

  /** Voice parameters derived from the same state, for the TTS request. */
  prosody(): Prosody {
    const v = this.valence;
    const a = this.arousal;
    const d = this.dominance;
    const serious = this.serious;
    const rate = clamp(0.95 + a * 0.14 - Math.max(0, -v) * 0.05 - serious * 0.06, 0.86, 1.14);
    return {
      rate,
      pitch: clamp(-0.6 + a * 2.6 + v * 1.1 - serious * 0.8, -2, 3),
      volume: clamp(0.78 + a * 0.18 + Math.max(0, d) * 0.06, 0.7, 1),
      pauseMs: Math.round(clamp(230 - a * 90 + serious * 160, 90, 420)),
      style: clamp(0.1 + a * 0.38 + Math.max(0, v) * 0.14 - serious * 0.2, 0, 0.7),
      stability: clamp(0.62 - a * 0.28 + serious * 0.12, 0.25, 0.75),
      speed: rate,
    };
  }

  reset(): void {
    this.valence = this.moodValence;
    this.arousal = this.moodArousal;
    this.dominance = this.moodDominance;
    this.serious = 0;
    for (const name of EMOTION_NAMES) this.intensities[name] = 0;
  }
}
