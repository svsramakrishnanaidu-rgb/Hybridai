import { enterRequest, guardRequest, readBoundedText } from "@/core/guard";
import { audit, mutate, readStore } from "@/core/memory";
import { sanitizeRule } from "@/core/speech/pronounce";
import { normalizeSpeechSettings } from "@/core/speech/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The user's own pronunciation dictionary. */
export async function GET() {
  const store = await readStore();
  const settings = normalizeSpeechSettings(store.settings.speech);
  return Response.json(
    { rules: settings.pronunciation },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Add a rule: "word → say" for one language, or every language. */
export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;
  const release = enterRequest(req);
  try {
    const bounded = await readBoundedText(req, 20_000);
    if ("error" in bounded) return bounded.error;
    const body = (await Promise.resolve(JSON.parse(bounded.text || "{}")).catch(() => ({}))) as Record<string, unknown>;
    const rule = sanitizeRule(body);
    if (!rule) {
      return Response.json(
        { error: "A rule needs a word and a pronunciation, without markup characters." },
        { status: 400 },
      );
    }

    const rules = await mutate((store) => {
      const settings = normalizeSpeechSettings(store.settings.speech);
      // Same word in the same language replaces the old rule.
      const next = settings.pronunciation.filter(
        (existing) => !(existing.word.toLowerCase() === rule.word.toLowerCase() && existing.language === rule.language),
      );
      next.unshift(rule);
      settings.pronunciation = next.slice(0, 60);
      store.settings.speech = settings;
      audit(store, "speech.pronunciation", `added ${rule.word} → ${rule.say} (${rule.language})`);
      return settings.pronunciation;
    });

    return Response.json({ rules }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not save the rule" },
      { status: 500 },
    );
  } finally {
    release();
  }
}

/** Delete one rule by id, or all of them with ?all=1. */
export async function DELETE(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;
  const release = enterRequest(req);
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const all = url.searchParams.get("all") === "1";
    if (!id && !all) return Response.json({ error: "id or all=1 is required" }, { status: 400 });

    const rules = await mutate((store) => {
      const settings = normalizeSpeechSettings(store.settings.speech);
      settings.pronunciation = all
        ? []
        : settings.pronunciation.filter((rule) => rule.id !== id);
      store.settings.speech = settings;
      audit(store, "speech.pronunciation", all ? "cleared all rules" : `deleted ${id}`);
      return settings.pronunciation;
    });

    return Response.json({ rules }, { headers: { "cache-control": "no-store" } });
  } finally {
    release();
  }
}
