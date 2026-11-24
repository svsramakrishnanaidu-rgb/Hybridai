/**
 * HYDRO AI — voice catalogue.
 *
 * The library is built from the provider's own `/v1/voices` response, not from a
 * written list: a voice shown in the picker is a voice this account can actually
 * synthesize with. If that call fails the picker says so instead of showing a
 * catalogue that may not exist.
 *
 * Style groups are derived from the provider's labels and the voice's own
 * description ("Warm", "Deep", "Storyteller"), so a filter is a claim that can
 * be checked against the voice's metadata. There is no anime or character voice
 * category here because this account has none — an empty filter would be a lie.
 */

export type VoiceStyle =
  | "warm"
  | "professional"
  | "narration"
  | "deep"
  | "gentle"
  | "youthful"
  | "energetic"
  | "conversational"
  | "neutral";

export interface VoiceOption {
  id: string;
  name: string;
  /** short human description from the provider */
  description: string;
  gender: "male" | "female" | "neutral" | "unknown";
  accent: string;
  age: string;
  category: string;
  /** provider-declared native language of the voice */
  nativeLanguage: string;
  styles: VoiceStyle[];
  /** every language the multilingual models can render with this voice */
  multilingual: boolean;
  provider: "elevenlabs";
}

export interface RawVoice {
  voice_id?: string;
  name?: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string | undefined> | null;
  fine_tuning?: unknown;
  verified_languages?: Array<{ language?: string; model_id?: string }>;
}

const STYLE_HINTS: Array<[RegExp, VoiceStyle]> = [
  [/warm|comfort|reassur|tender|gentle|soft/i, "warm"],
  [/professional|broadcaster|informative|educator|news/i, "professional"],
  [/story|narrat|captivat/i, "narration"],
  [/deep|resonant|husky|firm/i, "deep"],
  [/calm|gentle|soothing|relaxed/i, "gentle"],
  [/bright|playful|youth|enthusias|energetic|quirky/i, "youthful"],
  [/energetic|excit|social media|lively/i, "energetic"],
  [/casual|laid-back|conversational|down-to-earth|smooth/i, "conversational"],
  [/neutral|steady|balanced/i, "neutral"],
];

function stylesFor(raw: RawVoice): VoiceStyle[] {
  const haystack = [
    raw.name ?? "",
    raw.description ?? "",
    raw.labels?.description ?? "",
    raw.labels?.use_case ?? "",
    raw.labels?.descriptive ?? "",
  ].join(" ");
  const found = new Set<VoiceStyle>();
  for (const [pattern, style] of STYLE_HINTS) {
    if (pattern.test(haystack)) found.add(style);
  }
  if (!found.size) found.add("neutral");
  return [...found].slice(0, 4);
}

function genderOf(raw: RawVoice): VoiceOption["gender"] {
  const value = (raw.labels?.gender ?? "").toLowerCase();
  if (value.includes("female")) return "female";
  if (value.includes("male")) return "male";
  if (value.includes("neutral")) return "neutral";
  return "unknown";
}

export function toVoiceOption(raw: RawVoice): VoiceOption | null {
  const id = raw.voice_id?.trim();
  if (!id) return null;
  return {
    id,
    name: raw.name?.trim() || id,
    description: (raw.description ?? raw.labels?.description ?? "").toString().trim().slice(0, 160),
    gender: genderOf(raw),
    accent: (raw.labels?.accent ?? "unspecified").toString(),
    age: (raw.labels?.age ?? "unspecified").toString(),
    category: raw.category ?? "unknown",
    nativeLanguage: (raw.labels?.language ?? "en").toString(),
    styles: stylesFor(raw),
    // A premade voice is rendered in other languages by a multilingual model.
    // It is not a native speaker of them, and the UI says so.
    multilingual: true,
    provider: "elevenlabs",
  };
}

export function searchVoices(voices: VoiceOption[], query: string, style?: VoiceStyle | "all"): VoiceOption[] {
  const needle = query.trim().toLowerCase();
  return voices.filter((voice) => {
    if (style && style !== "all" && !voice.styles.includes(style)) return false;
    if (!needle) return true;
    const haystack = `${voice.name} ${voice.description} ${voice.accent} ${voice.gender} ${voice.styles.join(" ")}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Voices measured in this workspace on 2026-11-22 from `GET /v1/voices`.
 * Kept only as a labelled offline snapshot so the picker can show something
 * when the provider is unreachable — never as proof that a voice still exists.
 */
export const VOICE_SNAPSHOT: VoiceOption[] = [
  ["CwhRBWXzGAHq8TQ4Fs17", "Roger", "Laid-Back, Casual, Resonant", "male", "american"],
  ["EXAVITQu4vr4xnSDxMaL", "Sarah", "Mature, Reassuring, Confident", "female", "american"],
  ["FGY2WhTYpPnrIDTdsKH5", "Laura", "Enthusiast, Quirky Attitude", "female", "american"],
  ["IKne3meq5aSn9XLyUdCD", "Charlie", "Deep, Confident, Energetic", "male", "australian"],
  ["JBFqnCBsd6RMkjVDRZzb", "George", "Warm, Captivating Storyteller", "male", "british"],
  ["N2lVS1w4EtoT3dr4eOWO", "Callum", "Husky Trickster", "male", "american"],
  ["SAz9YHcvj6GT2YYXdXww", "River", "Relaxed, Neutral, Informative", "neutral", "american"],
  ["SOYHLrjzK2X1ezoPC6cr", "Harry", "Fierce Warrior", "male", "american"],
  ["TX3LPaxmHKxFdv7VOQHJ", "Liam", "Energetic, Social Media Creator", "male", "american"],
  ["Xb7hH8MSUJpSbSDYk0k2", "Alice", "Clear, Engaging Educator", "female", "british"],
  ["XrExE9yKIg1WjnnlVkGX", "Matilda", "Knowledgable, Professional", "female", "american"],
  ["bIHbv24MWmeRgasZH58o", "Will", "Relaxed Optimist", "male", "american"],
  ["cgSgspJ2msm6clMCkdW9", "Jessica", "Playful, Bright, Warm", "female", "american"],
  ["cjVigY5qzO86Huf0OWal", "Eric", "Smooth, Trustworthy", "male", "american"],
  ["hpp4J3VqNfWAUOO0d1Us", "Bella", "Professional, Bright, Warm", "female", "american"],
  ["iP95p4xoKVk53GoZ742B", "Chris", "Charming, Down-to-Earth", "male", "american"],
  ["nPczCjzI2devNBz1zQrb", "Brian", "Deep, Resonant and Comforting", "male", "american"],
  ["onwK4e9ZLuTAKqWW03F9", "Daniel", "Steady Broadcaster", "male", "british"],
  ["pFZP5JQG7iQjIQuC4Bku", "Lily", "Velvety Actress", "female", "british"],
  ["pNInz6obpgDQGcFmaJgB", "Adam", "Dominant, Firm", "male", "american"],
  ["pqHfZKP75CvOlQylNhV4", "Bill", "Wise, Mature, Balanced", "male", "american"],
].map(([id, name, description, gender, accent]) =>
  toVoiceOption({
    voice_id: id,
    name,
    description,
    category: "premade",
    labels: { gender, accent, language: "en", description },
  }),
).filter((voice): voice is VoiceOption => Boolean(voice));

export const VOICE_SNAPSHOT_TAKEN = "2026-11-22";
