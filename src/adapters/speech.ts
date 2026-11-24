/**
 * HYDRO AI — speech provider adapter.
 *
 * Two providers, both remote and both optional:
 *   · ElevenLabs for synthesis (multilingual neural voices)
 *   · Deepgram for recognition (multilingual streaming model)
 *
 * Everything a caller needs to be honest about is returned, not assumed: the
 * model actually used, the language, the voice, whether a fallback fired, and
 * how long the request took. Credentials never leave this module.
 *
 * The previous implementation hard-coded `eleven_turbo_v2_5`, a model whose
 * language list does not include Telugu. This one asks the provider what each
 * model and voice supports, caches that answer for ten minutes, and routes per
 * request.
 */

import { createHash } from "node:crypto";
import { fallbackModels, hydrateModels, type TtsModel } from "@/core/speech/router.ts";
import { toVoiceOption, VOICE_SNAPSHOT, type RawVoice, type VoiceOption } from "@/core/speech/voices.ts";

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";
const DEEPGRAM_LISTEN = "https://api.deepgram.com/v1/listen";

/** Default when no voice is configured; a real premade voice, not a guess. */
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

export class SpeechError extends Error {
  status: number;
  /** true when the failure is the user's configuration, not a provider outage */
  config: boolean;
  constructor(message: string, status = 502, config = false) {
    super(message);
    this.name = "SpeechError";
    this.status = status;
    this.config = config;
  }
}

export function speechCapabilities() {
  return {
    stt: Boolean(process.env.DEEPGRAM_API_KEY?.trim()),
    tts: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
  };
}

function elevenKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new SpeechError("Speech synthesis is not configured", 503, true);
  return key;
}

export function defaultVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE;
}

/* ───────────────────────────── capability cache ────────────────────────── */

interface Cached<T> {
  value: T;
  at: number;
}

const CACHE_TTL = 10 * 60_000;
let modelCache: Cached<TtsModel[]> | null = null;
let voiceCache: Cached<VoiceOption[]> | null = null;

/** Ask the provider which models exist and which languages each one lists. */
export async function listModels(force = false): Promise<TtsModel[]> {
  if (!force && modelCache && Date.now() - modelCache.at < CACHE_TTL) return modelCache.value;
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) return fallbackModels();
  try {
    const res = await fetch(`${ELEVEN_BASE}/models`, {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return fallbackModels();
    const data = (await res.json()) as Array<{
      model_id: string;
      name?: string;
      can_do_text_to_speech?: boolean;
      languages?: Array<{ language_id?: string }>;
    }>;
    const tts = data.filter((model) => model.can_do_text_to_speech !== false);
    const models = hydrateModels(tts);
    modelCache = { value: models, at: Date.now() };
    return models;
  } catch {
    return fallbackModels();
  }
}

/**
 * The account's real voices. On failure the labelled snapshot is returned with
 * `live: false`, so the UI can say the list is cached rather than imply it was
 * just verified.
 */
export async function listVoices(force = false): Promise<{ voices: VoiceOption[]; live: boolean; takenAt: string }> {
  if (!force && voiceCache && Date.now() - voiceCache.at < CACHE_TTL) {
    return { voices: voiceCache.value, live: true, takenAt: new Date(voiceCache.at).toISOString() };
  }
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) return { voices: VOICE_SNAPSHOT, live: false, takenAt: "snapshot" };
  try {
    const res = await fetch(`${ELEVEN_BASE}/voices`, {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { voices: VOICE_SNAPSHOT, live: false, takenAt: "snapshot" };
    const data = (await res.json()) as { voices?: RawVoice[] };
    const voices = (data.voices ?? [])
      .map(toVoiceOption)
      .filter((voice): voice is VoiceOption => Boolean(voice));
    if (!voices.length) return { voices: VOICE_SNAPSHOT, live: false, takenAt: "snapshot" };
    voiceCache = { value: voices, at: Date.now() };
    return { voices, live: true, takenAt: new Date().toISOString() };
  } catch {
    return { voices: VOICE_SNAPSHOT, live: false, takenAt: "snapshot" };
  }
}

/* ─────────────────────────────── synthesis ─────────────────────────────── */

export interface SynthesisRequest {
  text: string;
  modelId: string;
  language: string;
  voiceId: string;
  outputFormat: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  /** previous / next segment text, for intonation continuity across chunks */
  previousText?: string;
  nextText?: string;
  signal?: AbortSignal;
}

export interface SynthesisResult {
  audio: ArrayBuffer;
  mime: string;
  modelId: string;
  voiceId: string;
  language: string;
  elapsedMs: number;
  /** fields the provider rejected and we dropped to succeed */
  dropped: string[];
}

/** Bounded in-memory cache: audio only, never written to disk. */
const audioCache = new Map<string, { audio: ArrayBuffer; mime: string; modelId: string }>();
const AUDIO_CACHE_MAX = 64;
let audioCacheBytes = 0;
const AUDIO_CACHE_BYTES_MAX = 12 * 1024 * 1024;

function cacheKey(request: SynthesisRequest): string {
  return createHash("sha256")
    .update(
      [
        request.modelId,
        request.voiceId,
        request.language,
        request.outputFormat,
        request.stability,
        request.similarityBoost,
        request.style,
        request.speed,
        request.previousText ?? "",
        request.text,
      ].join("\u0001"),
    )
    .digest("hex");
}

function readCache(key: string) {
  const hit = audioCache.get(key);
  if (!hit) return null;
  // Refresh recency.
  audioCache.delete(key);
  audioCache.set(key, hit);
  return hit;
}

function writeCache(key: string, value: { audio: ArrayBuffer; mime: string; modelId: string }) {
  if (audioCache.has(key)) return;
  audioCache.set(key, value);
  audioCacheBytes += value.audio.byteLength;
  while (audioCache.size > AUDIO_CACHE_MAX || audioCacheBytes > AUDIO_CACHE_BYTES_MAX) {
    const oldest = audioCache.keys().next();
    if (oldest.done) break;
    const entry = audioCache.get(oldest.value);
    audioCache.delete(oldest.value);
    audioCacheBytes -= entry?.audio.byteLength ?? 0;
  }
}

const MIME_BY_FORMAT: Record<string, string> = {
  mp3: "audio/mpeg",
  pcm: "audio/wav",
  opus: "audio/ogg",
};

function mimeFor(format: string): string {
  return MIME_BY_FORMAT[format.split("_")[0]!] ?? "audio/mpeg";
}

/**
 * Synthesize one segment.
 *
 * A `400 invalid_parameters` from the provider is a field problem, not an
 * outage: unsupported fields (`language_code`, `speed`, `previous_text`) are
 * dropped one at a time and the request retried, so an older model still
 * speaks instead of failing the whole answer.
 */
export async function synthesizeSegment(request: SynthesisRequest): Promise<SynthesisResult> {
  const key = elevenKey();
  const text = request.text.trim();
  if (!text) throw new SpeechError("text is required", 400);

  const hash = cacheKey(request);
  const cached = readCache(hash);
  if (cached) {
    return {
      audio: cached.audio,
      mime: cached.mime,
      modelId: cached.modelId,
      voiceId: request.voiceId,
      language: request.language,
      elapsedMs: 0,
      dropped: ["cache"],
    };
  }

  const dropped: string[] = [];
  let includeLanguage = true;
  let includeSpeed = true;
  let includeContext = Boolean(request.previousText || request.nextText);
  let includeStyle = true;

  const started = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const body: Record<string, unknown> = {
      text,
      model_id: request.modelId,
      voice_settings: {
        stability: request.stability,
        similarity_boost: request.similarityBoost,
        ...(includeStyle ? { style: request.style, use_speaker_boost: true } : {}),
        ...(includeSpeed ? { speed: request.speed } : {}),
      },
      ...(includeLanguage ? { language_code: request.language } : {}),
      ...(includeContext
        ? {
            previous_text: request.previousText ?? "",
            next_text: request.nextText ?? "",
          }
        : {}),
    };

    const url = `${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(request.voiceId)}?output_format=${encodeURIComponent(request.outputFormat)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });

    if (res.ok) {
      const audio = await res.arrayBuffer();
      if (!audio.byteLength) throw new SpeechError("The voice service returned no audio", 502);
      writeCache(hash, { audio, mime: mimeFor(request.outputFormat), modelId: request.modelId });
      return {
        audio,
        mime: mimeFor(request.outputFormat),
        modelId: request.modelId,
        voiceId: request.voiceId,
        language: request.language,
        elapsedMs: Date.now() - started,
        dropped,
      };
    }

    const bodyText = await res.text().catch(() => "");
    const detail = bodyText.slice(0, 240);

    // Field-level rejections: drop the field and retry once each.
    if (res.status === 400 && /language_code/i.test(detail) && includeLanguage) {
      includeLanguage = false;
      dropped.push("language_code");
      continue;
    }
    if (res.status === 400 && /speed/i.test(detail) && includeSpeed) {
      includeSpeed = false;
      dropped.push("speed");
      continue;
    }
    if (res.status === 400 && /(style|use_speaker_boost)/i.test(detail) && includeStyle) {
      includeStyle = false;
      dropped.push("style");
      continue;
    }
    if (res.status === 400 && /(previous_text|next_text)/i.test(detail) && includeContext) {
      includeContext = false;
      dropped.push("context");
      continue;
    }
    // An unavailable output format is not a credential problem: 192 kbps needs
    // the Creator tier and returns 403 `subscription_required`, while an unknown
    // rate returns 400 `invalid_output_format`. Both downgrade to the universal
    // 128 kbps stream instead of failing the answer.
    const formatProblem =
      (res.status === 400 || res.status === 403) &&
      /invalid_output_format|subscription_required|output_format/i.test(detail);
    if (formatProblem && request.outputFormat !== "mp3_44100_128") {
      request = { ...request, outputFormat: "mp3_44100_128" };
      dropped.push(`output_format(${res.status})`);
      continue;
    }

    // A 401 is not always a bad key: the provider uses it for an exhausted
    // character quota as well. Saying "key rejected" there hid the real cause.
    if (/quota_exceeded|insufficient.*credit|credits remaining/i.test(detail)) {
      throw new SpeechError(
        "The speech provider account has no credits left. Spoken answers fall back to this browser's voice; top up the provider key to restore the neural voice.",
        402,
        true,
      );
    }
    if (/concurrent|too many/i.test(detail) && (res.status === 403 || res.status === 429)) {
      throw new SpeechError("The voice service is busy — try again in a moment", 429);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SpeechError(
        `The speech provider rejected the request (${res.status}): ${detail.slice(0, 140)}`,
        502,
        true,
      );
    }
    if (res.status === 429) {
      throw new SpeechError("The voice service is rate-limiting requests — try again shortly", 429);
    }
    throw new SpeechError(`Synthesis failed (${res.status}): ${detail}`, 502);
  }
  throw new SpeechError("Synthesis failed after retrying without unsupported fields", 502);
}

/** Streaming variant: returns the provider's audio stream for one segment. */
export async function synthesizeStream(request: SynthesisRequest): Promise<{
  stream: ReadableStream<Uint8Array>;
  mime: string;
  modelId: string;
}> {
  const key = elevenKey();
  const body = {
    text: request.text.trim(),
    model_id: request.modelId,
    voice_settings: {
      stability: request.stability,
      similarity_boost: request.similarityBoost,
      style: request.style,
      use_speaker_boost: true,
      speed: request.speed,
    },
    language_code: request.language,
  };
  const res = await fetch(
    `${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(request.voiceId)}/stream?output_format=${encodeURIComponent(request.outputFormat)}`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: request.signal,
    },
  );
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new SpeechError(`Streaming synthesis failed (${res.status}): ${detail}`, 502);
  }
  return { stream: res.body, mime: mimeFor(request.outputFormat), modelId: request.modelId };
}

/* ────────────────────────────── recognition ────────────────────────────── */

export interface TranscriptionOptions {
  /** explicit language, or "multi" for detection */
  language?: string;
  /** words the recognizer should expect (names, product terms) */
  keyterms?: string[];
}

export interface TranscriptionResult {
  transcript: string;
  confidence: number | null;
  language: string | null;
  /** per-word alternatives, for confidence handling in the UI */
  words: Array<{ word: string; confidence: number; start: number; end: number }>;
  elapsedMs: number;
}

/**
 * Transcribe a recording.
 *
 * `language=multi` with `detect_language` is what makes Telugu-English mixed
 * speech work; a fixed `en` forces English phonetics onto Telugu words, which
 * was the recognition-side version of the same bug.
 */
export async function transcribe(
  audio: Buffer,
  mime: string,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) throw new SpeechError("Speech-to-text is not configured", 503, true);

  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    numerals: "true",
    diarize: "false",
    filler_words: "false",
  });
  const language = (options.language ?? "multi").trim() || "multi";
  params.set("language", language === "auto" ? "multi" : language);
  if (params.get("language") === "multi") params.set("detect_language", "true");
  const keyterms = (options.keyterms ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && term.length < 40)
    .slice(0, 20);
  for (const term of keyterms) params.append("keyterm", term);

  const started = Date.now();
  const res = await fetch(`${DEEPGRAM_LISTEN}?${params.toString()}`, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": mime || "audio/webm" },
    body: new Uint8Array(audio),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      throw new SpeechError("The speech-to-text provider rejected the configured key", 502, true);
    }
    throw new SpeechError(`Transcription failed (${res.status}): ${detail}`, 502);
  }

  const data = (await res.json()) as {
    results?: {
      channels?: Array<{
        detected_language?: string;
        alternatives?: Array<{
          transcript?: string;
          confidence?: number;
          words?: Array<{ word?: string; confidence?: number; start?: number; end?: number }>;
        }>;
      }>;
    };
  };
  const channel = data.results?.channels?.[0];
  const best = channel?.alternatives?.[0];
  return {
    transcript: (best?.transcript ?? "").trim(),
    confidence: typeof best?.confidence === "number" ? best.confidence : null,
    language: channel?.detected_language ?? null,
    words: (best?.words ?? [])
      .filter((word) => typeof word.word === "string")
      .slice(0, 400)
      .map((word) => ({
        word: word.word!,
        confidence: typeof word.confidence === "number" ? word.confidence : 0,
        start: typeof word.start === "number" ? word.start : 0,
        end: typeof word.end === "number" ? word.end : 0,
      })),
    elapsedMs: Date.now() - started,
  };
}

/** Backwards-compatible helper: transcript only. */
export async function transcribeText(audio: Buffer, mime: string): Promise<string> {
  return (await transcribe(audio, mime)).transcript;
}

/** Voice preview audio for the picker: short, cached, and clearly labelled. */
export const PREVIEW_TEXT: Record<string, string> = {
  en: "Hello. This is how I sound when I explain something clearly.",
  te: "నమస్కారం. ఇది నేను తెలుగులో మాట్లాడే విధానం.",
  hi: "नमस्ते। मैं हिंदी में ऐसे बोलता हूँ।",
};

export function previewText(language: string): string {
  return PREVIEW_TEXT[language.split("-")[0]!] ?? PREVIEW_TEXT.en!;
}
