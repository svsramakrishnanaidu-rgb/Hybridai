/**
 * HYDRO AI — the speech pipeline.
 *
 * One deterministic function turns a written answer into what should be
 * spoken, in what language, with which model and voice, split into units that
 * can be synthesised and played as they arrive:
 *
 *   answer → strip markup → normalise numbers/dates/units → pronunciation rules
 *          → language detection → model routing → sentence plan
 *
 * It is pure: the caller supplies the model table and the settings, so every
 * decision can be asserted in a test without a network call.
 */

import { detectLanguage, splitRuns, type LanguageDetection } from "./languages.ts";
import { normalizeForSpeech } from "./normalize.ts";
import { applyPronunciation } from "./pronounce.ts";
import { routeModels, type TtsModel } from "./router.ts";
import { clampForSpeech, planSegments, prosodyContext } from "./segment.ts";
import {
  outputFormat,
  synthesisParams,
  type SpeechSettings,
  type SynthesisParams,
} from "./settings.ts";

export interface PlanSegment {
  index: number;
  /** language of this sentence, so a mixed answer switches per sentence */
  language: string;
  /** what the synthesizer reads */
  text: string;
  /** what the user sees in subtitles, when it can be aligned */
  displayText: string;
  previousText: string;
  nextText: string;
}

export interface SpeakPlan {
  language: string;
  detected: string;
  mixed: boolean;
  romanTelugu: boolean;
  voiceId: string;
  voiceNotice: string | null;
  model: string;
  fallbackChain: string[];
  notice: string | null;
  unsupportedLanguage: boolean;
  segments: PlanSegment[];
  notes: string[];
  originalChars: number;
  spokenChars: number;
  params: SynthesisParams;
  outputFormat: string;
  /** languages the account can actually synthesize, from the live model table */
  verifiedLanguages: string[];
}

export interface PlanInput {
  text: string;
  settings: SpeechSettings;
  models: TtsModel[];
  prosody?: { style?: number; stability?: number; speed?: number; pauseMs?: number };
  /** hard character ceiling for one answer */
  limit?: number;
  /** the account's default voice, used when no preference is saved */
  defaultVoiceId: string;
}

/**
 * Voices on this account are native English speakers. A multilingual model
 * renders Telugu or Hindi with them, which is usable and clearly accented — the
 * plan says so rather than letting the user wonder why it sounds foreign.
 */
function voiceNoticeFor(language: string, voiceNative: string): string | null {
  const code = language.split("-")[0]!;
  if (code === "en" || voiceNative === code) return null;
  return `This account has no native ${code.toUpperCase()} voice. The selected multilingual voice reads it with an accent.`;
}

export function planSpeech(input: PlanInput, voiceNative = "en"): SpeakPlan {
  const settings = input.settings;
  const clamped = clampForSpeech(input.text, input.limit ?? 4000);

  const detection: LanguageDetection = detectLanguage(
    clamped,
    settings.language === "auto" ? "auto" : settings.language,
  );

  // Mixed answers are normalised per language run. A Telugu question followed by
  // an English sentence must not read "₹1,250" as Telugu number words — the
  // English stretch is spoken by an English voice with English numbers, and the
  // Telugu stretch keeps its own. This is the sentence-level language switch.
  const stripped = normalizeForSpeech(clamped, detection.language, { numbers: false });
  const runs = splitRuns(stripped.text);
  const normalizedRuns = (runs.length ? runs : [{ text: stripped.text, language: detection.language }]).map(
    (run) => normalizeForSpeech(run.text, run.language),
  );
  const finalNormalization = {
    text: normalizedRuns
      .map((run) => run.text)
      .filter(Boolean)
      .join(" "),
    notes: [...new Set([...stripped.notes, ...normalizedRuns.flatMap((run) => run.notes)])],
    originalChars: clamped.length,
  };

  const pronounced = applyPronunciation(
    finalNormalization.text,
    detection.mixed ? "mixed" : detection.language,
    settings.pronunciation,
  );

  const params = synthesisParams(settings, input.prosody);
  const route = routeModels({
    language: detection.language,
    quality: params.modelPreference,
    models: input.models,
  });

  const spokenSegments = planSegments(pronounced.text, {
    maxChars: params.maxSegmentChars,
    minChars: params.minSegmentChars,
  });

  // Display text is planned from the original answer so subtitles show
  // "₹1,250" and not "one thousand two hundred fifty rupees". Alignment is by
  // index and only used when both plans have the same number of units.
  const displayPlan = planSegments(clamped, {
    maxChars: params.maxSegmentChars,
    minChars: params.minSegmentChars,
  });
  const aligned = displayPlan.length === spokenSegments.length;

  const voiceId = settings.voiceId || input.defaultVoiceId;

  return {
    language: detection.language,
    detected: detection.language,
    mixed: detection.mixed,
    romanTelugu: detection.romanTelugu,
    voiceId,
    voiceNotice: voiceNoticeFor(detection.language, voiceNative),
    model: route.chain[0] ?? "eleven_v4_turbo",
    fallbackChain: route.chain,
    notice: route.notice,
    unsupportedLanguage: route.unsupported,
    segments: spokenSegments.map((segment) => {
      const context = prosodyContext(spokenSegments, segment.index);
      return {
        index: segment.index,
        language: detectLanguage(segment.text).language,
        text: segment.text,
        displayText: aligned ? displayPlan[segment.index]!.text : segment.text,
        previousText: context.previousText,
        nextText: context.nextText,
      };
    }),
    notes: [...finalNormalization.notes, ...pronounced.notes],
    originalChars: clamped.length,
    spokenChars: pronounced.text.length,
    params,
    outputFormat: outputFormat(settings.quality),
    verifiedLanguages: [...new Set(input.models.flatMap((model) => model.languages))].sort(),
  };
}

/** Split an already-planned answer into the client's serialisable shape. */
export function publicPlan(plan: SpeakPlan) {
  return {
    language: plan.language,
    mixed: plan.mixed,
    romanTelugu: plan.romanTelugu,
    voiceId: plan.voiceId,
    voiceNotice: plan.voiceNotice,
    model: plan.model,
    fallbackChain: plan.fallbackChain,
    notice: plan.notice,
    unsupportedLanguage: plan.unsupportedLanguage,
    notes: plan.notes,
    originalChars: plan.originalChars,
    spokenChars: plan.spokenChars,
    outputFormat: plan.outputFormat,
    verifiedLanguages: plan.verifiedLanguages,
    pauseMs: plan.params.pauseMs,
    speed: plan.params.speed,
    segments: plan.segments.map((segment) => ({
      index: segment.index,
      language: segment.language,
      text: segment.text,
      displayText: segment.displayText,
    })),
  };
}
