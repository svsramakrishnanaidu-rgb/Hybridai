import { defaultVoiceId, listModels, synthesizeSegment } from "@/adapters/speech";
import { enterRequest, guardRequest, readBoundedText } from "@/core/guard";
import { mutate, readStore } from "@/core/memory";
import { planSpeech } from "@/core/speech/pipeline";
import { routeModels } from "@/core/speech/router";
import { normalizeSpeechSettings, outputFormat, synthesisParams } from "@/core/speech/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TtsBody {
  text?: string;
  language?: string;
  voiceId?: string;
  prosody?: { style?: number; stability?: number; speed?: number; pauseMs?: number };
  /** true when `text` is already a normalised plan segment */
  segment?: boolean;
  previousText?: string;
  nextText?: string;
}

/**
 * Synthesize one spoken unit.
 *
 * The language, model and voice are decided server-side from the saved settings
 * and the text itself, so the browser cannot pin the old English-only model back
 * in place. The response headers report what actually happened: model, language,
 * voice, fallback chain, and any notice worth showing.
 */
export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;
  const release = enterRequest(req);
  try {
    const bounded = await readBoundedText(req, 120_000);
    if ("error" in bounded) return bounded.error;

    let body: TtsBody;
    try {
      body = JSON.parse(bounded.text || "{}") as TtsBody;
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }

    const text = (body.text ?? "").trim();
    if (!text) return Response.json({ error: "text is required" }, { status: 400 });

    const store = await readStore();
    const settings = normalizeSpeechSettings({
      ...store.settings.speech,
      ...(typeof body.language === "string" ? { language: body.language } : {}),
      ...(body.voiceId ? { voiceId: body.voiceId } : {}),
    });

    const models = await listModels();
    const plan = planSpeech({
      text,
      settings,
      models,
      prosody: body.prosody,
      defaultVoiceId: defaultVoiceId(),
    });
    // A caller holding a plan sends the exact spoken segment; otherwise the first
    // planned unit is spoken.
    const spoken = body.segment ? text : (plan.segments[0]?.text ?? "");
    if (!spoken) return Response.json({ error: "Nothing speakable in that text" }, { status: 400 });

    const params =
      body.segment && !body.prosody
        ? synthesisParams(settings)
        : plan.params;
    // A plan segment carries its own language: a mixed answer must synthesise
    // the English sentence with an English language code and the Telugu one with
    // `te`, not force one language onto both.
    const language =
      body.segment && body.language && body.language !== "auto"
        ? body.language.split("-")[0]!
        : plan.language;
    const route = routeModels({
      language,
      quality: params.modelPreference,
      models,
    });

    let lastError: unknown = null;
    for (const modelId of route.chain) {
      try {
        const result = await synthesizeSegment({
          text: spoken,
          modelId,
          language,
          voiceId: body.voiceId || plan.voiceId,
          outputFormat: outputFormat(settings.quality),
          stability: params.stability,
          similarityBoost: params.similarityBoost,
          style: params.styleExaggeration,
          speed: params.speed,
          previousText: body.previousText ?? (body.segment ? undefined : plan.segments[0]?.previousText),
          nextText: body.nextText ?? (body.segment ? undefined : plan.segments[0]?.nextText),
          signal: req.signal,
        });
        if (!body.segment) {
          await mutate((s) => {
            s.settings.voiceEnabled = true;
          });
        }
        return audioResponse(result.audio, result.mime, {
          model: result.modelId,
          language,
          voice: result.voiceId,
          chain: route.chain.join(","),
          // A notice about the answer's language must not be attached to a
          // sentence that is in a different language.
          notice:
            route.notice ??
            (language === plan.language ? (plan.notice ?? plan.voiceNotice ?? "") : ""),
          dropped: result.dropped.join(","),
        });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("Synthesis failed");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Synthesis failed";
    const status = typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : 502;
    return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
  } finally {
    release();
  }
}

function audioResponse(audio: ArrayBuffer, mime: string, meta: Record<string, string>): Response {
  const headers: Record<string, string> = {
    "content-type": mime,
    "content-length": String(audio.byteLength),
    "cache-control": "no-store",
    "x-hydro-tts-model": meta.model ?? "",
    "x-hydro-language": meta.language ?? "",
    "x-hydro-voice": meta.voice ?? "",
  };
  if (meta.chain) headers["x-hydro-chain"] = meta.chain;
  if (meta.dropped) headers["x-hydro-dropped"] = meta.dropped;
  if (meta.notice) headers["x-hydro-notice"] = encodeURIComponent(meta.notice.slice(0, 220));
  return new Response(audio, { headers });
}
