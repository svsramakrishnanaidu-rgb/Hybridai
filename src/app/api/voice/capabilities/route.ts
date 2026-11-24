import { listModels, listVoices, speechCapabilities, defaultVoiceId } from "@/adapters/speech";
import { LANGUAGES, languageInfo } from "@/core/speech/languages";
import { SPEECH_MODES, DEFAULT_SPEECH_SETTINGS, normalizeSpeechSettings } from "@/core/speech/settings";
import { verifiedLanguages } from "@/core/speech/router";
import { readStore } from "@/core/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the voice system can actually do, measured rather than promised.
 *
 * `languages` is the union of what the provider's live model table lists, so the
 * picker cannot offer a language the engine would fail to read. `nativeVoices`
 * is honest about the more important limit: every voice on this account is a
 * native English speaker, so other languages are rendered by a multilingual
 * model with an accent.
 */
export async function GET() {
  const models = await listModels();
  const voices = await listVoices();
  const store = await readStore();
  const supported = new Set(verifiedLanguages(models));
  const catalogue = LANGUAGES.filter((language) => supported.has(language.id)).map((language) => ({
    id: language.id,
    label: language.label,
    native: language.native,
    supported: true,
  }));

  return Response.json(
    {
      capabilities: speechCapabilities(),
      settings: normalizeSpeechSettings(store.settings.speech ?? DEFAULT_SPEECH_SETTINGS),
      modes: SPEECH_MODES,
      models: models.map((model) => ({
        id: model.id,
        label: model.label,
        languages: model.languages.length,
        streaming: model.streaming,
        measuredLatencyMs: model.measuredLatencyMs,
        acceptsLanguageCode: model.acceptsLanguageCode,
      })),
      languages: catalogue,
      /** languages that exist in the catalogue but that no model lists */
      unsupported: LANGUAGES.filter((language) => !supported.has(language.id)).map((language) => language.id),
      voices: voices.voices,
      voicesLive: voices.live,
      voicesTakenAt: voices.takenAt,
      defaultVoiceId: defaultVoiceId(),
      nativeVoices: voices.voices.filter((voice) => voice.nativeLanguage.startsWith("en")).length,
      defaultLanguageName: languageInfo("te")?.label ?? "Telugu",
      limits: {
        maxCharsPerAnswer: 4000,
        maxSegmentChars: 600,
        speed: [0.5, 2],
        volume: [0, 1],
      },
      /** controls the configured engine cannot honour, with the reason */
      unsupportedControls: [
        {
          control: "pitch",
          reason:
            "The configured neural voice has no pitch parameter. Pitch applies only when the browser's own speech engine is used as a fallback.",
        },
        {
          control: "emotion-slider",
          reason:
            "Expressiveness maps to the provider's stability and style values; there is no emotion label the provider can be told to perform.",
        },
      ],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
