import { enterRequest, guardRequest, readBoundedText } from "@/core/guard";
import { audit, mutate, readStore } from "@/core/memory";
import { sanitizeRule } from "@/core/speech/pronounce";
import { SPEECH_MODES, normalizeSpeechSettings } from "@/core/speech/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read the saved voice preferences. */
export async function GET() {
  const store = await readStore();
  return Response.json(
    { settings: normalizeSpeechSettings(store.settings.speech), modes: SPEECH_MODES },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Save a change to the voice preferences.
 *
 * The body is validated, not trusted: unknown modes fall back, speed is clamped
 * to the provider's supported band, and pronunciation rules are sanitised
 * individually so one bad rule cannot take the whole list down.
 */
export async function PATCH(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;
  const release = enterRequest(req);
  try {
    const bounded = await readBoundedText(req, 40_000);
    if ("error" in bounded) return bounded.error;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bounded.text || "{}") as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }

    const result = await mutate(async (store) => {
      const current = normalizeSpeechSettings(store.settings.speech);
      const next = normalizeSpeechSettings({ ...current, ...body });
      if (Array.isArray(body.pronunciation)) {
        const rules = body.pronunciation
          .map(sanitizeRule)
          .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule))
          .slice(0, 60);
        next.pronunciation = rules;
      }
      store.settings.speech = next;
      audit(store, "speech.settings", `mode=${next.mode} language=${next.language} speed=${next.speed}`);
      return next;
    });

    return Response.json({ settings: result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not save voice settings" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  } finally {
    release();
  }
}
