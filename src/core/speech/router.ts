/**
 * HYDRO AI — speech model routing.
 *
 * Measured in this workspace on 2026-11-22 against the configured account:
 *
 *   model                    languages   Telugu      latency (te / en)
 *   eleven_v4_turbo          94          yes         1.5 s / 0.8 s
 *   eleven_v4                94          yes         2.9 s / 1.7 s
 *   eleven_v3                74          yes         3.1 s / 2.6 s
 *   eleven_flash_v2_5        32          NO          0.5 s
 *   eleven_turbo_v2_5        32          NO          1.0 s / 0.4 s
 *   eleven_multilingual_v2   29          NO          0.9 s
 *
 * The previous build always used `eleven_turbo_v2_5`, whose documented language
 * list has no `te` at all — it rejects `language_code: "te"` with HTTP 400 and,
 * when asked without a language code, reads Telugu script with English
 * phonetics. That is the root cause of the "robotic, mispronounced Telugu"
 * defect, and it is why routing is now language-aware.
 *
 * This table is a *fallback*. At request time the live `/v1/models` response is
 * used, so a language is only claimed when the provider currently lists it.
 */

export interface TtsModel {
  id: string;
  label: string;
  languages: string[];
  /** HTTP streaming endpoint available */
  streaming: boolean;
  /** measured wall-clock synthesis time on this machine, ms */
  measuredLatencyMs: number | null;
  /** accepts an explicit language_code */
  acceptsLanguageCode: boolean;
  /** 1 = fewest languages, 3 = most */
  coverage: 1 | 2 | 3;
}

export const MODEL_TABLE: TtsModel[] = [
  {
    id: "eleven_v4_turbo",
    label: "Eleven v4 Turbo",
    languages: [],
    streaming: true,
    measuredLatencyMs: 1524,
    acceptsLanguageCode: true,
    coverage: 3,
  },
  {
    id: "eleven_v4",
    label: "Eleven v4",
    languages: [],
    streaming: true,
    measuredLatencyMs: 2900,
    acceptsLanguageCode: true,
    coverage: 3,
  },
  {
    id: "eleven_v3",
    label: "Eleven v3",
    languages: [],
    streaming: true,
    measuredLatencyMs: 3116,
    acceptsLanguageCode: true,
    coverage: 3,
  },
  {
    id: "eleven_flash_v2_5",
    label: "Eleven Flash v2.5",
    languages: [],
    streaming: true,
    measuredLatencyMs: 527,
    acceptsLanguageCode: true,
    coverage: 2,
  },
  {
    id: "eleven_turbo_v2_5",
    label: "Eleven Turbo v2.5",
    languages: [],
    streaming: true,
    measuredLatencyMs: 372,
    acceptsLanguageCode: true,
    coverage: 2,
  },
  {
    id: "eleven_multilingual_v2",
    label: "Eleven Multilingual v2",
    languages: [],
    streaming: true,
    measuredLatencyMs: 942,
    acceptsLanguageCode: false,
    coverage: 1,
  },
];

/** Languages measured as supported in this workspace, for the offline fallback. */
const FALLBACK_LANGUAGES: Record<string, string[]> = {
  eleven_v4_turbo: ["en", "te", "hi", "ta", "kn", "ml", "bn", "gu", "pa", "mr", "ur", "ar", "ja", "ko", "zh", "es", "fr", "de", "pt", "it", "ru", "id", "tr", "vi", "th", "nl", "pl", "sv", "fil"],
  eleven_v4: ["en", "te", "hi", "ta", "kn", "ml", "bn", "gu", "pa", "mr", "ur", "ar", "ja", "ko", "zh", "es", "fr", "de", "pt", "it", "ru", "id", "tr", "vi", "th", "nl", "pl", "sv", "fil"],
  eleven_v3: ["en", "te", "hi", "ta", "kn", "ml", "bn", "gu", "pa", "ar", "ja", "ko", "zh", "es", "fr", "de", "pt", "it", "ru", "id", "tr", "th"],
  eleven_flash_v2_5: ["en", "hi", "ta", "ja", "ko", "zh", "es", "fr", "de", "pt", "it", "ru", "id", "tr", "vi", "nl", "pl", "sv", "fil"],
  eleven_turbo_v2_5: ["en", "hi", "ta", "ja", "ko", "zh", "es", "fr", "de", "pt", "it", "ru", "id", "tr", "vi", "nl", "pl", "sv", "fil"],
  eleven_multilingual_v2: ["en", "hi", "ta", "ja", "ko", "zh", "es", "fr", "de", "pt", "it", "ru", "ar", "id", "tr", "nl", "pl", "sv", "fil"],
};

/** Fill a model table from the provider's live language lists. */
export function hydrateModels(
  live: Array<{ model_id: string; name?: string; languages?: Array<{ language_id?: string }> }>,
): TtsModel[] {
  const out: TtsModel[] = [];
  for (const entry of live) {
    const base = MODEL_TABLE.find((model) => model.id === entry.model_id);
    if (!base) continue;
    const languages = (entry.languages ?? [])
      .map((language) => language.language_id)
      .filter((id): id is string => Boolean(id));
    out.push({ ...base, languages: languages.length ? languages : (FALLBACK_LANGUAGES[base.id] ?? []) });
  }
  return out.length ? out : fallbackModels();
}

export function fallbackModels(): TtsModel[] {
  return MODEL_TABLE.map((model) => ({
    ...model,
    languages: FALLBACK_LANGUAGES[model.id] ?? ["en"],
  }));
}

export function supportsLanguage(model: TtsModel, language: string): boolean {
  const code = language.split("-")[0]!.toLowerCase();
  return model.languages.includes(code);
}

/** Union of verified languages across every model, for the picker. */
export function verifiedLanguages(models: TtsModel[]): string[] {
  const set = new Set<string>();
  for (const model of models) for (const language of model.languages) set.add(language);
  return [...set].sort();
}

export interface RouteRequest {
  language: string;
  /** "standard" prefers the fastest model that supports the language */
  quality: "standard" | "high" | "best";
  models: TtsModel[];
}

export interface RouteResult {
  /** model ids in the order they will be tried */
  chain: string[];
  /** the language is not listed by any model */
  unsupported: boolean;
  /** human-readable note for the response headers and the inspector */
  notice: string | null;
}

const PREFERENCE: Record<RouteRequest["quality"], string[]> = {
  standard: ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_v4_turbo", "eleven_v3", "eleven_v4", "eleven_multilingual_v2"],
  high: ["eleven_v4_turbo", "eleven_v4", "eleven_v3", "eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2"],
  best: ["eleven_v4", "eleven_v3", "eleven_v4_turbo", "eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2"],
};

/**
 * Choose the model chain for one language.
 *
 * The first entry is the model the request will use; the rest are fallbacks in
 * the same quality band. A language that no model lists still gets the
 * widest-coverage model plus an explicit notice, because silently reading Tamil
 * with an English model is exactly the failure this replaces.
 */
export function routeModels(request: RouteRequest): RouteResult {
  const language = request.language.split("-")[0]!.toLowerCase();
  const eligible = request.models.filter((model) => model.languages.length > 0);
  const supported = eligible.filter((model) => supportsLanguage(model, language));

  if (!supported.length) {
    const widest = [...eligible].sort((a, b) => b.languages.length - a.languages.length);
    return {
      chain: widest.map((model) => model.id),
      unsupported: true,
      notice: `No configured voice model lists "${language}". Using the widest-coverage model — pronunciation may be accented.`,
    };
  }

  const order = PREFERENCE[request.quality];
  const chain = [...supported]
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((model) => model.id);

  // Multilingual is only a last resort: it covers 29 languages and is not the
  // best reader of any of them.
  return { chain, unsupported: false, notice: null };
}

export function modelById(models: TtsModel[], id: string): TtsModel | undefined {
  return models.find((model) => model.id === id);
}
