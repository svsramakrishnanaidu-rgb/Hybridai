/**
 * HYDRO AI — multimodal affect layer.
 *
 * What this module does: combines four *measurements* into one cautious reading
 * the interface can act on —
 *
 *   1. the wording of the user's message (`appraise`, polarity + intensity),
 *   2. face action-unit scores the on-device model reported (AU12 smile,
 *      AU4 brow lower, AU1 inner-brow raise, AU7 squint, AU26 jaw, AU15 frown),
 *   3. acoustic features measured from the user's own microphone (energy,
 *      energy variation, pitch, pitch variation, speaking rate),
 *   4. an explicit self-report the user tapped ("Good / Okay / Stressed / Sad").
 *
 * What it does not do: recognise emotions, diagnose anything, or claim to know
 * how someone feels. A smile blendshape is a visible mouth shape; raised pitch
 * is a louder, higher sound. Every one of those has innocent explanations, so
 * they are surfacing *cues* with a confidence value, and the model is allowed to
 * say "I can't read this reliably" — `uncertain` — instead of guessing.
 *
 * Self-report outranks every inferred source: if the user says they are okay,
 * a tense brow does not overrule them.
 */

import { appraise } from "./emotion.ts";
import { clamp } from "./util.ts";

export type Mood = "good" | "okay" | "stressed" | "sad";

export type Tone = "neutral" | "warm" | "playful" | "supportive" | "focused";

export const MOOD_LABELS: Record<Mood, string> = {
  good: "Good",
  okay: "Okay",
  stressed: "Stressed",
  sad: "Low",
};

export const TONE_LABELS: Record<Tone, string> = {
  neutral: "Neutral",
  warm: "Warm",
  playful: "Playful",
  supportive: "Supportive",
  focused: "Focused",
};

/** Face action units, as reported by the local landmark model. */
export interface FaceCues {
  present: boolean;
  smile: number;
  brow: number;
  browDown: number;
  squint: number;
  jaw: number;
  frown: number;
  /** approximate sideways posture lean from the pose model, −1…1 */
  lean?: number;
  /** approximate lowering relative to this session's own shoulder baseline */
  settle?: number;
}

/** Acoustic measurements from the microphone. No emotion label is derived here. */
export interface VoiceTone {
  frames: number;
  voicedRatio: number;
  /** mean RMS of voiced frames, 0…1 */
  energy: number;
  /** standard deviation of RMS across voiced frames */
  energyVar: number;
  /** median fundamental frequency of voiced frames, Hz; 0 when unvoiced */
  pitchHz: number;
  /** standard deviation of pitch in semitones */
  pitchVar: number;
  /** words per minute from the transcript length over the recording length */
  wordsPerMinute?: number;
}

export interface SelfReport {
  mood: Mood;
  at: number;
}

export interface SourceRead {
  source: "text" | "face" | "voice" | "self";
  valence: number;
  arousal: number;
  weight: number;
  cues: string[];
  serious: boolean;
}

export interface FusedRead {
  valence: number;
  arousal: number;
  /** 0…1 — how much the evidence agrees and how much of it exists */
  confidence: number;
  /** 0…1 — negative + activated + self-reported stress */
  stress: number;
  tone: Tone;
  serious: boolean;
  /** true when the sources disagree or are too thin to act on */
  uncertain: boolean;
  /** true when the interface should offer a gentle check-in */
  checkIn: boolean;
  mood: Mood | null;
  cues: string[];
  /** per-source detail for the panel, not for the model prompt */
  sources: SourceRead[];
}

export interface AffectInput {
  text?: string;
  face?: FaceCues | null;
  voice?: VoiceTone | null;
  selfReport?: SelfReport | null;
  now?: number;
  /** how long a self-report stays fresh, default 30 minutes */
  selfTtlMs?: number;
}

/**
 * A pitch estimate by normalised autocorrelation over a decimated buffer.
 * Returns 0 when the frame is too quiet or too aperiodic to have a pitch.
 *
 * This is a measurement primitive, exported so it can be tested with synthetic
 * tones instead of a live microphone.
 */
export function estimatePitchHz(samples: Float32Array, sampleRate: number): number {
  if (samples.length < 64 || sampleRate <= 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms < 0.006) return 0;

  // 12 kHz is plenty for a 70–400 Hz voice band and keeps the lag search short.
  const step = Math.max(1, Math.round(sampleRate / 12_000));
  const rate = sampleRate / step;
  const n = Math.floor(samples.length / step);
  if (n < 64) return 0;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = samples[i * step];

  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    buf[i] -= mean;
    energy += buf[i] * buf[i];
  }
  if (energy <= 1e-9) return 0;

  const minLag = Math.max(2, Math.floor(rate / 400));
  const maxLag = Math.min(Math.floor(rate / 70), Math.floor(n / 2));
  if (maxLag <= minLag) return 0;

  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let a = 0;
    let b = 0;
    const len = n - lag;
    for (let i = 0; i < len; i++) {
      const x = buf[i];
      const y = buf[i + lag];
      cross += x * y;
      a += x * x;
      b += y * y;
    }
    if (a <= 0 || b <= 0) continue;
    const corr = cross / Math.sqrt(a * b);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Below this the signal is noise, not a voice, and inventing a pitch from it
  // would produce a confident-looking number with no meaning.
  if (bestLag === 0 || bestCorr < 0.35) return 0;
  return rate / bestLag;
}

function textSignal(text: string): SourceRead | null {
  const clean = text.trim();
  if (!clean) return null;
  const appraisal = appraise(clean);
  const cues: string[] = [];
  if (appraisal.serious) cues.push("a serious topic");
  if (appraisal.tags.includes("negated")) cues.push("negated wording");
  if (appraisal.tags.includes("capitalised")) cues.push("capitalised emphasis");
  if (appraisal.tags.includes("emphasis")) cues.push("exclamation marks");

  // Wording is real evidence about the words, and only weak evidence about the
  // person: someone can write "this is broken" about a printer, calmly.
  const weight = 0.4 + 0.42 * appraisal.strength;
  return {
    source: "text",
    valence: clamp(appraisal.valence, -1, 1),
    arousal: clamp(0.18 + appraisal.arousal * 0.62, 0, 1),
    weight,
    cues,
    serious: appraisal.serious,
  };
}

function faceSignal(face: FaceCues | null | undefined): SourceRead | null {
  if (!face?.present) return null;

  const smile = clamp(face.smile, 0, 1);
  const frown = clamp(face.frown, 0, 1);
  const browDown = clamp(face.browDown, 0, 1);
  const brow = clamp(face.brow, 0, 1);
  const jaw = clamp(face.jaw, 0, 1);
  const squint = clamp(face.squint, 0, 1);

  const cues: string[] = [];
  if (smile > 0.22) cues.push("mouth corners raised");
  if (frown > 0.2) cues.push("mouth corners lowered");
  if (browDown > 0.25) cues.push("brows drawn together");
  if (brow > 0.28) cues.push("inner brows raised");
  if (jaw > 0.3) cues.push("jaw open");
  if (squint > 0.4) cues.push("eyes narrowed");
  if ((face.lean ?? 0) > 0.35) cues.push("leaning to one side");
  if ((face.settle ?? 0) > 0.5) cues.push("sitting lower than earlier");
  if (!cues.length) return null;

  // Only the channels that actually carry a directional reading are used.
  // Squint and jaw are ambiguous (squinting at a screen is not tension), so
  // they contribute arousal at most, never valence.
  const valence = clamp(smile * 0.95 - frown * 0.9 - browDown * 0.5, -1, 1);
  // Brow lowering is activation as well as tension: it is the channel that
  // separates a flat, downcast face from a braced one.
  const arousal = clamp(0.24 + jaw * 0.42 + brow * 0.22 + browDown * 0.3 + (1 - squint) * 0.12, 0, 1);
  const strength = Math.max(smile, frown, browDown, brow, jaw);

  return { source: "face", valence, arousal, weight: 0.3 + 0.35 * strength, cues, serious: false };
}

function voiceSignal(voice: VoiceTone | null | undefined): SourceRead | null {
  if (!voice) return null;
  if (voice.frames < 6 || voice.voicedRatio < 0.12) return null;

  const cues: string[] = [];
  if (voice.energy > 0.11) cues.push("louder speech than usual");
  if (voice.energyVar > 0.06) cues.push("uneven volume");
  if (voice.pitchVar > 2.4) cues.push("wide pitch movement");
  if (typeof voice.wordsPerMinute === "number" && voice.wordsPerMinute > 185) {
    cues.push("fast speech");
  }
  if (typeof voice.wordsPerMinute === "number" && voice.wordsPerMinute < 85) {
    cues.push("slower speech");
  }
  if (!cues.length) return null;

  // Valence is deliberately 0 here: loudness and pitch do not tell you whether
  // someone is excited or upset. They only raise or lower measured activation.
  const loud = clamp((voice.energy - 0.05) / 0.2, 0, 1);
  const pitchMove = clamp(voice.pitchVar / 4, 0, 1);
  const fast = clamp(((voice.wordsPerMinute ?? 130) - 110) / 110, 0, 1);
  return {
    source: "voice",
    valence: 0,
    arousal: clamp(0.28 + loud * 0.34 + pitchMove * 0.22 + fast * 0.12, 0, 1),
    weight: 0.2 + 0.2 * Math.max(loud, pitchMove),
    cues,
    serious: false,
  };
}

function selfSignal(self: SelfReport | null | undefined, now: number, ttl: number): SourceRead | null {
  if (!self) return null;
  if (now - self.at > ttl) return null;
  const map: Record<Mood, { valence: number; arousal: number }> = {
    good: { valence: 0.66, arousal: 0.55 },
    okay: { valence: 0.14, arousal: 0.28 },
    stressed: { valence: -0.55, arousal: 0.72 },
    sad: { valence: -0.62, arousal: 0.18 },
  };
  const value = map[self.mood];
  return {
    source: "self",
    valence: value.valence,
    arousal: value.arousal,
    // An explicit statement is the strongest evidence available, and it is
    // enough on its own: a tapped mood should not read as low confidence.
    weight: 1.6,
    cues: [`you marked your mood as ${MOOD_LABELS[self.mood].toLowerCase()}`],
    serious: self.mood === "sad" || self.mood === "stressed",
  };
}

const MOOD_VALENCE: Record<Mood, number> = { good: 0.66, okay: 0.14, stressed: -0.55, sad: -0.62 };

/** Pick the reply tone. Supportive wins whenever there is credible strain. */
export function toneFor(input: {
  valence: number;
  arousal: number;
  serious: boolean;
  mood: Mood | null;
}): Tone {
  if (input.mood === "stressed" || input.mood === "sad") return "supportive";
  if (input.serious) return "supportive";
  // Any clearly negative read is strain, whether it is agitated or flat. This
  // threshold used to sit at −0.3, which let "this is broken and I hate it"
  // land in the brisk "focused" tone.
  if (input.valence <= -0.18 && input.arousal >= 0.3) return "supportive";
  if (input.valence <= -0.24) return "supportive";
  if (input.valence >= 0.36 && input.arousal >= 0.42) return "playful";
  if (input.valence >= 0.22) return "warm";
  if (input.arousal >= 0.62 && input.valence > -0.05) return "focused";
  return "neutral";
}

/**
 * Fuse the sources. Confidence is agreement × coverage, so a single neutral
 * sentence can never look like a confident reading of anyone's mood.
 */
export function fuseAffect(input: AffectInput = {}): FusedRead {
  const now = input.now ?? Date.now();
  const ttl = input.selfTtlMs ?? 30 * 60_000;
  const self = selfSignal(input.selfReport, now, ttl);
  const sources = [
    self,
    textSignal(input.text ?? ""),
    faceSignal(input.face),
    voiceSignal(input.voice),
  ].filter((s): s is SourceRead => s !== null);

  if (!sources.length) {
    return {
      valence: 0,
      arousal: 0.3,
      confidence: 0,
      stress: 0,
      tone: "neutral",
      serious: false,
      uncertain: true,
      checkIn: false,
      mood: input.selfReport?.mood ?? null,
      cues: [],
      sources: [],
    };
  }

  const total = sources.reduce((sum, s) => sum + s.weight, 0);
  const valence = sources.reduce((sum, s) => sum + s.valence * s.weight, 0) / total;
  const arousal = sources.reduce((sum, s) => sum + s.arousal * s.weight, 0) / total;

  // Mean absolute deviation of valence between sources: smiling + angry words
  // must read as "unclear", not as an average of the two.
  const spread = sources.reduce((sum, s) => sum + Math.abs(s.valence - valence) * s.weight, 0) / total;
  const agreement = clamp(1 - spread / 0.85, 0, 1);
  const coverage = clamp(total / 2.1, 0, 1);
  const confidence = clamp(0.08 + 0.92 * agreement * coverage, 0, 1);

  const serious = sources.some((s) => s.serious);
  const mood = input.selfReport && now - input.selfReport.at <= ttl ? input.selfReport.mood : null;
  const tone = toneFor({ valence, arousal, serious, mood });

  const selfStress = mood ? clamp((0.5 - MOOD_VALENCE[mood]) * 0.85, 0, 1) : 0;
  const stress = clamp(
    Math.max(0, -valence) * 0.75 + Math.max(0, arousal - 0.5) * 0.35 + selfStress * 0.55,
    0,
    1,
  );

  // A check-in needs a real disagreement, not merely thin evidence: asking on
  // every quiet sentence would be noise. Two or more sources that conflict, or
  // a high-confidence negative read with no self-report, is the useful case.
  const disagreeing = sources.length >= 2 && agreement < 0.55;
  const uncertain = confidence < 0.4 || disagreeing;

  return {
    valence,
    arousal,
    confidence,
    stress,
    tone,
    serious,
    uncertain,
    checkIn: disagreeing && !mood,
    mood,
    cues: sources.flatMap((s) => s.cues).slice(0, 6),
    sources,
  };
}

/** The small payload the chat API needs. Never includes raw cues or images. */
export interface AffectDirective {
  tone: Tone;
  stress: number;
  confidence: number;
  mood: Mood | null;
}

export function directiveFrom(read: FusedRead): AffectDirective {
  return {
    tone: read.tone,
    stress: Math.round(read.stress * 100) / 100,
    confidence: Math.round(read.confidence * 100) / 100,
    mood: read.mood,
  };
}

const TONES: Tone[] = ["neutral", "warm", "playful", "supportive", "focused"];
const MOODS: Mood[] = ["good", "okay", "stressed", "sad"];

/** Validate an untrusted directive arriving from the browser. */
export function normalizeAffect(raw: unknown): AffectDirective | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (!TONES.includes(value.tone as Tone)) return undefined;
  return {
    tone: value.tone as Tone,
    stress: clamp(Number(value.stress) || 0, 0, 1),
    confidence: clamp(Number(value.confidence) || 0, 0, 1),
    mood: MOODS.includes(value.mood as Mood) ? (value.mood as Mood) : null,
  };
}

/**
 * Guidance appended to the system prompt for one turn.
 *
 * The wording constraints are part of the feature, not decoration: HYDRO must
 * not present a blendshape score as knowledge of a feeling.
 */
export function toneGuidance(directive: AffectDirective | undefined): string {
  if (!directive || directive.tone === "neutral") return "";
  const lines = ["INTERACTION TONE — this turn only"];

  if (directive.tone === "supportive") {
    const why =
      directive.mood === "stressed" || directive.mood === "sad"
        ? `The user set their own mood to "${directive.mood}".`
        : "The user's wording and visible cues look strained.";
    lines.push(
      `- ${why} Keep the reply calm, concrete and fairly short (roughly 120 words unless the task needs more). Acknowledge once at most, then help with what was asked.`,
      "- Offer a practical next step rather than reassurance alone. Do not give medical advice or suggest a diagnosis.",
    );
  } else if (directive.tone === "playful") {
    lines.push(
      "- The user's own signals look upbeat. A light, warm touch is welcome; stay accurate and avoid jokes that could misfire.",
    );
  } else if (directive.tone === "warm") {
    lines.push("- A warm, personal register fits this turn. Keep it natural and no longer than the task needs.");
  } else {
    lines.push("- The user appears highly engaged. Lead with the task and keep the reply tight.");
  }

  lines.push(
    "- These are cues and self-reports, not confirmed feelings. Never say you can see, detect, read or know their emotions, and never name a mental-health condition.",
    "- Do not mention this tone instruction, the cue system, or that a mood was inferred.",
  );
  return lines.join("\n");
}

/** Functional, optional next steps. Each maps to a real action in the panel. */
export interface Recommendation {
  id: "breathe" | "quiz";
  label: string;
  prompt: string;
}

export function recommend(read: FusedRead): Recommendation[] {
  const out: Recommendation[] = [];
  if (read.stress >= 0.5 || read.mood === "stressed" || read.mood === "sad") {
    out.push({
      id: "breathe",
      label: "60-second breathing",
      prompt: "",
    });
  }
  if (read.valence > -0.15 && read.arousal < 0.35 && read.confidence >= 0.3) {
    out.push({
      id: "quiz",
      label: "Quick trivia round",
      prompt: "Ask me five short trivia questions, one at a time, and wait for my answer before the next.",
    });
  }
  return out;
}

// ── consent-gated episodic mood memory ─────────────────────────────────────

export interface Episode {
  id: string;
  at: number;
  mood: Mood | null;
  valence: number;
  arousal: number;
  confidence: number;
  tone: Tone;
  cues: string[];
  /** short excerpt of what the user wrote, so a follow-up can be specific */
  topic: string;
}

export const MAX_EPISODES = 30;

export function rememberEpisode(list: Episode[], episode: Episode): Episode[] {
  const next = [episode, ...list];
  return next.slice(0, MAX_EPISODES);
}

export function newEpisode(read: FusedRead, topic: string, now = Date.now()): Episode {
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: now,
    mood: read.mood,
    valence: Math.round(read.valence * 100) / 100,
    arousal: Math.round(read.arousal * 100) / 100,
    confidence: Math.round(read.confidence * 100) / 100,
    tone: read.tone,
    cues: read.cues.slice(0, 4),
    topic: topic.replace(/\s+/g, " ").trim().slice(0, 90),
  };
}

/**
 * A follow-up is only offered for something the user actually stated, and only
 * inside a useful window. Nothing is inferred into a memory.
 */
export function pendingFollowUp(
  list: Episode[],
  now = Date.now(),
  opts: { minAgeMs?: number; maxAgeMs?: number } = {},
): Episode | null {
  const minAge = opts.minAgeMs ?? 45 * 60_000;
  const maxAge = opts.maxAgeMs ?? 14 * 24 * 60 * 60_000;
  for (const episode of list) {
    const age = now - episode.at;
    if (age < minAge || age > maxAge) continue;
    if (episode.mood === "stressed" || episode.mood === "sad") return episode;
  }
  return null;
}

export function followUpPrompt(episode: Episode): string {
  return episode.mood === "stressed"
    ? "Earlier I said I was stressed. Can we pick that up — I'd like to talk through what was going on."
    : "Earlier I said I was feeling low. Can we talk about how that's going now?";
}

/** Human date for a stored episode, used in the panel copy. */
export function episodeAge(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
