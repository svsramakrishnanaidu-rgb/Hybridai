import { transcribe } from "@/adapters/speech";
import { enterRequest, guardRequest } from "@/core/guard";
import { readStore } from "@/core/memory";
import { normalizeSpeechSettings } from "@/core/speech/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transcribe one recording.
 *
 * Language is not guessed at random: the saved preference, a per-request
 * override, and the user's pronunciation words (which are usually the proper
 * nouns the recognizer mangles) are passed through to the recognizer. The
 * response reports the detected language and a confidence so the UI can warn
 * on a weak transcript instead of silently sending nonsense.
 */
export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;
  const release = enterRequest(req);
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ error: "audio file is required" }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) {
      return Response.json({ error: "Recording too large (max 12 MB)" }, { status: 413 });
    }

    const store = await readStore();
    const settings = normalizeSpeechSettings(store.settings.speech);
    const override = form.get("language");
    const language =
      typeof override === "string" && override.trim()
        ? override.trim()
        : settings.language === "auto"
          ? "multi"
          : settings.language;

    const keyterms = Array.from(
      new Set([
        "HYDRO", "Telugu", ...settings.pronunciation.map((rule) => rule.word).slice(0, 12),
      ]),
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await transcribe(buffer, file.type || "audio/webm", { language, keyterms });
    return Response.json(
      {
        transcript: result.transcript,
        confidence: result.confidence,
        language: result.language,
        words: result.words.slice(0, 120),
        elapsedMs: result.elapsedMs,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Transcription failed" },
      { status: 502 },
    );
  } finally {
    release();
  }
}
