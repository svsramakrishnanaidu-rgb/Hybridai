/**
 * HYDRO AI — speech preferences.
 *
 * One validated shape for everything the voice pipeline needs. Defaults are
 * chosen for the measured case (multilingual, natural pace, sentence streaming)
 * rather than for the cheapest request, and every field is clamped here so a
 * hand-edited store or a crafted PATCH cannot push the provider out of range.
 *
 * A setting is only exposed in the UI when the selected engine can actually
 * honour it. `pitch`, for example, is a browser-engine control: the configured
 * neural provider has no pitch parameter, so the UI disables it there and says
 * why instead of pretending a slider does something.
 */

import type { PronunciationRule } from "./pronounce.ts";

export type SpeechMode =
  | "natural"
  | "study"
  | "coding"
  | "story"
  | "multilingual"
  | "low-latency"
  | "high-quality"
  | "accessibility";

export type SpeechQuality = "standard" | "high" | "best";
export type Expressiveness = "low" | "medium" | "high";
export type SpeakingStyle = "natural" | "professional" | "story" | "energetic";
export type PauseLength = "short" | "natural" | "extended";

export interface SpeechSettings {
  /** master switch for spoken answers */
  enabled: boolean;
  /** speak every completed answer without pressing the speaker button */
  autoRead: boolean;
  /** "auto" detects per answer; otherwise an ISO 639-1 code */
  language: string;
  /** provider voice id; null means "choose for the language" */
  voiceId: string | null;
  mode: SpeechMode;
  /** 0.5…2.0 */
  speed: number;
  /** 0…1, applied on the client gain node (the provider has no volume) */
  volume: number;
  expressiveness: Expressiveness;
  style: SpeakingStyle;
  pauses: PauseLength;
  quality: SpeechQuality;
  /** request the next sentence before the current one finishes */
  streaming: boolean;
  /** show the sentence being spoken */
  subtitles: boolean;
  /** let a new turn or the microphone cut speech off */
  interruptions: boolean;
  pronunciation: PronunciationRule[];
}

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  enabled: true,
  autoRead: true,
  language: "auto",
  voiceId: null,
  mode: "natural",
  speed: 1,
  volume: 0.9,
  expressiveness: "medium",
  style: "natural",
  pauses: "natural",
  quality: "high",
  streaming: true,
  subtitles: true,
  interruptions: true,
  pronunciation: [],
};

export interface SpeechModeSpec {
  id: SpeechMode;
  label: string;
  description: string;
  /** model preference ranked by quality, best first */
  quality: SpeechQuality;
  speed: number;
  stability: number;
  styleExaggeration: number;
  pauseScale: number;
  /** segment length; shorter segments start sooner */
  maxSegmentChars: number;
  minSegmentChars: number;
}

export const SPEECH_MODES: SpeechModeSpec[] = [
  {
    id: "natural",
    label: "Natural conversation",
    description: "Balanced pace and intonation for everyday replies.",
    quality: "high",
    speed: 1,
    stability: 0.5,
    styleExaggeration: 0.15,
    pauseScale: 1,
    maxSegmentChars: 240,
    minSegmentChars: 24,
  },
  {
    id: "study",
    label: "Study",
    description: "Slower, clearer, with longer pauses after each idea.",
    quality: "best",
    speed: 0.92,
    stability: 0.62,
    styleExaggeration: 0.08,
    pauseScale: 1.45,
    maxSegmentChars: 180,
    minSegmentChars: 20,
  },
  {
    id: "coding",
    label: "Coding",
    description: "Code terms, symbols and identifiers spoken as words.",
    quality: "high",
    speed: 0.98,
    stability: 0.6,
    styleExaggeration: 0.05,
    pauseScale: 1.2,
    maxSegmentChars: 180,
    minSegmentChars: 20,
  },
  {
    id: "story",
    label: "Storytelling",
    description: "Wider intonation and meaningful pauses between beats.",
    quality: "best",
    speed: 0.95,
    stability: 0.38,
    styleExaggeration: 0.45,
    pauseScale: 1.3,
    maxSegmentChars: 200,
    minSegmentChars: 18,
  },
  {
    id: "multilingual",
    label: "Multilingual",
    description: "Best language coverage; switches model per language.",
    quality: "best",
    speed: 1,
    stability: 0.5,
    styleExaggeration: 0.15,
    pauseScale: 1,
    maxSegmentChars: 220,
    minSegmentChars: 18,
  },
  {
    id: "low-latency",
    label: "Low latency",
    description: "Fastest model that supports the language; short segments.",
    quality: "standard",
    speed: 1.04,
    stability: 0.55,
    styleExaggeration: 0.1,
    pauseScale: 0.9,
    maxSegmentChars: 150,
    minSegmentChars: 16,
  },
  {
    id: "high-quality",
    label: "High quality",
    description: "Best model available, accepting extra generation time.",
    quality: "best",
    speed: 1,
    stability: 0.55,
    styleExaggeration: 0.2,
    pauseScale: 1,
    maxSegmentChars: 280,
    minSegmentChars: 28,
  },
  {
    id: "accessibility",
    label: "Accessibility",
    description: "Slower, steadier, subtitles on, stops on any interruption.",
    quality: "high",
    speed: 0.9,
    stability: 0.68,
    styleExaggeration: 0.05,
    pauseScale: 1.5,
    maxSegmentChars: 150,
    minSegmentChars: 16,
  },
];

const MODE_IDS = new Set(SPEECH_MODES.map((mode) => mode.id));

export function modeSpec(mode: SpeechMode): SpeechModeSpec {
  return SPEECH_MODES.find((m) => m.id === mode) ?? SPEECH_MODES[0]!;
}

const EXPRESSIVENESS: Record<Expressiveness, { stability: number; style: number }> = {
  low: { stability: 0.72, style: 0.05 },
  medium: { stability: 0.5, style: 0.2 },
  high: { stability: 0.34, style: 0.45 },
};

const STYLES: Record<SpeakingStyle, { speed: number; stability: number; style: number }> = {
  natural: { speed: 1, stability: 0.5, style: 0.18 },
  professional: { speed: 0.99, stability: 0.66, style: 0.05 },
  story: { speed: 0.96, stability: 0.38, style: 0.42 },
  energetic: { speed: 1.06, stability: 0.36, style: 0.5 },
};

const PAUSES: Record<PauseLength, { scale: number; minChars: number }> = {
  short: { scale: 0.75, minChars: 34 },
  natural: { scale: 1, minChars: 24 },
  extended: { scale: 1.5, minChars: 16 },
};

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

function number(value: unknown, fallback: number, lo: number, hi: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Validate anything that claims to be speech settings. */
export function normalizeSpeechSettings(input: unknown): SpeechSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SPEECH_SETTINGS;
  const mode = typeof raw.mode === "string" && MODE_IDS.has(raw.mode as SpeechMode)
    ? (raw.mode as SpeechMode)
    : d.mode;
  const language =
    typeof raw.language === "string" && raw.language.trim()
      ? raw.language.trim().slice(0, 12).toLowerCase()
      : d.language;
  const quality =
    raw.quality === "standard" || raw.quality === "high" || raw.quality === "best"
      ? raw.quality
      : d.quality;
  const expressiveness =
    raw.expressiveness === "low" || raw.expressiveness === "medium" || raw.expressiveness === "high"
      ? raw.expressiveness
      : d.expressiveness;
  const style =
    raw.style === "natural" || raw.style === "professional" || raw.style === "story" || raw.style === "energetic"
      ? raw.style
      : d.style;
  const pauses =
    raw.pauses === "short" || raw.pauses === "natural" || raw.pauses === "extended"
      ? raw.pauses
      : d.pauses;

  return {
    enabled: boolean(raw.enabled, d.enabled),
    autoRead: boolean(raw.autoRead, d.autoRead),
    language: language === "auto" || /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(language) ? language : d.language,
    voiceId: typeof raw.voiceId === "string" && raw.voiceId.trim() ? raw.voiceId.trim().slice(0, 40) : null,
    mode,
    speed: number(raw.speed, d.speed, 0.5, 2),
    volume: number(raw.volume, d.volume, 0, 1),
    expressiveness,
    style,
    pauses,
    quality,
    streaming: boolean(raw.streaming, d.streaming),
    subtitles: boolean(raw.subtitles, d.subtitles),
    interruptions: boolean(raw.interruptions, d.interruptions),
    pronunciation: Array.isArray(raw.pronunciation) ? (raw.pronunciation as PronunciationRule[]).slice(0, 60) : [],
  };
}

export interface SynthesisParams {
  modelPreference: SpeechQuality;
  stability: number;
  similarityBoost: number;
  styleExaggeration: number;
  speed: number;
  maxSegmentChars: number;
  minSegmentChars: number;
  /** ms of extra silence the client inserts between segments */
  pauseMs: number;
}

/**
 * Turn preference + the simulated emotional state into provider parameters.
 *
 * The emotional prosody is clamped harder than a manual setting: it is a
 * response to a sentence, not a user decision, so it may nudge but never
 * override "professional, steady".
 */
export function synthesisParams(
  settings: SpeechSettings,
  prosody?: { style?: number; stability?: number; speed?: number; pauseMs?: number },
): SynthesisParams {
  const mode = modeSpec(settings.mode);
  const expression = EXPRESSIVENESS[settings.expressiveness];
  const style = STYLES[settings.style];
  const pauses = PAUSES[settings.pauses];

  const stability = clamp(
    (mode.stability * 0.5 + expression.stability * 0.25 + style.stability * 0.25) +
      (typeof prosody?.stability === "number" ? (prosody.stability - 0.5) * 0.25 : 0),
    0.2,
    0.85,
  );
  const styleExaggeration = clamp(
    mode.styleExaggeration + expression.style * 0.5 + style.style * 0.35 +
      (typeof prosody?.style === "number" ? prosody.style * 0.35 : 0),
    0,
    0.75,
  );
  const speed = clamp(
    settings.speed * mode.speed * style.speed +
      (typeof prosody?.speed === "number" ? (prosody.speed - 1) * 0.5 : 0),
    0.6,
    1.6,
  );

  // Pause is inserted on the client between segments, so it is a real silence
  // rather than a request for the provider to guess.
  const pauseMs = Math.round(
    clamp(
      (settings.pauses === "short" ? 90 : settings.pauses === "extended" ? 320 : 180) *
        pauses.scale *
        mode.pauseScale +
        (typeof prosody?.pauseMs === "number" ? prosody.pauseMs * 0.25 : 0),
      40,
      900,
    ),
  );

  return {
    modelPreference: settings.quality === "standard" ? "standard" : qualityFromMode(settings.mode, settings.quality),
    stability: Math.round(stability * 100) / 100,
    similarityBoost: settings.mode === "story" ? 0.7 : 0.8,
    styleExaggeration: Math.round(styleExaggeration * 100) / 100,
    speed: Math.round(speed * 100) / 100,
    maxSegmentChars: Math.round(mode.maxSegmentChars * (pauses.minChars / 24) ** 0.35),
    minSegmentChars: Math.min(pauses.minChars, mode.minSegmentChars + 12),
    pauseMs,
  };
}

function qualityFromMode(mode: SpeechMode, quality: SpeechQuality): SpeechQuality {
  if (mode === "low-latency") return "standard";
  if (mode === "high-quality" || mode === "multilingual" || mode === "study" || mode === "story") {
    return "best";
  }
  return quality;
}

/**
 * Output format by quality setting. MP3 is the only format every browser can
 * decode without a library, and these three are the only MP3 rates the provider
 * accepts (measured: `mp3_22050_64` is rejected as invalid). 192 kbps is gated
 * to the Creator tier, so the adapter downgrades it when the account cannot use
 * it rather than failing the answer.
 */
export function outputFormat(quality: SpeechQuality): string {
  if (quality === "standard") return "mp3_44100_64";
  if (quality === "best") return "mp3_44100_192";
  return "mp3_44100_128";
}
