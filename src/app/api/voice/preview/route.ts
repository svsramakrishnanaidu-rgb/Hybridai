import { listModels, previewText, synthesizeSegment } from "@/adapters/speech";
import { enterRequest, guardRequest, readBoundedText } from "@/core/guard";
import { readStore } from "@/core/memory";
import { applyPronunciation } from "@/core/speech/pronounce";
import { routeModels } from "@/core/speech/router";
import { normalizeSpeechSettings, outputFormat, synthesisParams } from "@/core/speech/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audition a voice before selecting it.
 *
 * The preview is a real synthesis request for a fixed sentence in the requested
 * language, so the user hears the voice reading that language rather than a
 * marketing clip. It is short to keep the cost of browsing the library small.
 */
export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;
  const release = enterRequest(req);
  try {
    const bounded = await readBoundedText(req, 8_000);
    if ("error" in bounded) return bounded.error;
    const body = (await Promise.resolve(JSON.parse(bounded.text || "{}")).catch(() => ({}))) as {
      voiceId?: string;
      language?: string;
    };
    const voiceId = (body.voiceId ?? "").trim();
    if (!voiceId) return Response.json({ error: "voiceId is required" }, { status: 400 });

    const store = await readStore();
    const settings = normalizeSpeechSettings(store.settings.speech);
    const requested = body.language ?? settings.language;
    const language = requested === "auto" ? "en" : requested;
    const params = synthesisParams({ ...settings, voiceId });

    const sentence = previewText(language);
    const spoken = applyPronunciation(sentence, language, settings.pronunciation).text;
    const models = await listModels();
    const route = routeModels({ language, quality: "high", models });

    let lastError: unknown = null;
    for (const modelId of route.chain) {
      try {
        const result = await synthesizeSegment({
          text: spoken,
          modelId,
          language: language.split("-")[0]!,
          voiceId,
          outputFormat: outputFormat("standard"),
          stability: params.stability,
          similarityBoost: params.similarityBoost,
          style: params.styleExaggeration,
          speed: 1,
          signal: req.signal,
        });
        return new Response(result.audio, {
          headers: {
            "content-type": result.mime,
            "cache-control": "no-store",
            "x-hydro-tts-model": result.modelId,
            "x-hydro-language": language,
            "x-hydro-voice": voiceId,
          },
        });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("Preview failed");
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Preview failed" },
      { status: 502 },
    );
  } finally {
    release();
  }
}
