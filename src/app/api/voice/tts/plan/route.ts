import { defaultVoiceId, listModels, listVoices } from "@/adapters/speech";
import { enterRequest, guardRequest, readBoundedText } from "@/core/guard";
import { readStore } from "@/core/memory";
import { planSpeech, publicPlan } from "@/core/speech/pipeline";
import { normalizeSpeechSettings } from "@/core/speech/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan an answer for speech without synthesising anything.
 *
 * The browser needs the units before the first audio arrives: it can then fetch
 * segment 0 immediately, keep segment 1 in flight while 0 plays, and show
 * subtitles that match what is actually being said. Planning here also means the
 * text is normalised once, not once per segment.
 */
export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;
  const release = enterRequest(req);
  try {
    const bounded = await readBoundedText(req, 120_000);
    if ("error" in bounded) return bounded.error;
    const body = (await Promise.resolve(JSON.parse(bounded.text || "{}")).catch(() => ({}))) as {
      text?: string;
      language?: string;
      voiceId?: string;
      prosody?: { style?: number; stability?: number; speed?: number; pauseMs?: number };
    };
    const text = (body.text ?? "").trim();
    if (!text) return Response.json({ error: "text is required" }, { status: 400 });

    const store = await readStore();
    const settings = normalizeSpeechSettings({
      ...store.settings.speech,
      // An explicit "auto" must override a saved language; otherwise a per-request
      // detection test would silently use the stored preference.
      ...(typeof body.language === "string" ? { language: body.language } : {}),
      ...(body.voiceId ? { voiceId: body.voiceId } : {}),
    });
    const models = await listModels();
    const voices = await listVoices();
    const native = voices.voices.find((voice) => voice.id === (body.voiceId || settings.voiceId))?.nativeLanguage ?? "en";

    const plan = planSpeech(
      { text, settings, models, prosody: body.prosody, defaultVoiceId: defaultVoiceId() },
      native,
    );
    return Response.json(publicPlan(plan), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not plan speech" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  } finally {
    release();
  }
}
