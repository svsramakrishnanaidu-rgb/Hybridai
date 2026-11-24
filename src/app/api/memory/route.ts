import { addMemory, audit, mutate, readStore } from "@/core/memory";
import { ownerDenied } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const store = await readStore();
  return Response.json(
    {
      settings: store.settings,
      memory: store.memory.filter((m) => m.status === "active"),
      usage: store.usage,
      proposals: store.proposals.length,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PATCH(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await mutate((store) => {
    // Editing a record is how a wrong memory is corrected, not deleted.
    if (typeof body.id === "string" && typeof body.content === "string") {
      const record = store.memory.find((m) => m.id === body.id);
      if (record) {
        const next = body.content.trim().slice(0, 600);
        if (next) {
          record.content = next;
          audit(store, "memory.edited", record.id);
        }
      }
    }
    if (typeof body.memoryEnabled === "boolean") {
      store.settings.memoryEnabled = body.memoryEnabled;
      audit(
        store,
        body.memoryEnabled ? "memory.enabled" : "memory.disabled",
        "consent changed by user",
      );
    }
    if (typeof body.learningPaused === "boolean") {
      store.settings.learningPaused = body.learningPaused;
      audit(store, body.learningPaused ? "learning.paused" : "learning.resumed", "user action");
    }
    if (typeof body.voiceEnabled === "boolean") {
      store.settings.voiceEnabled = body.voiceEnabled;
    }
    return store.settings;
  });
  return Response.json({ settings: result });
}

export async function POST(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const body = (await req.json().catch(() => ({}))) as { content?: string; project?: string };
  const content = (body.content ?? "").trim();
  if (!content) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }
  const record = await mutate((store) => {
    const rec = addMemory(store, {
      type: "preference",
      content,
      source: "manual entry",
      consentRef: "manual",
      project: typeof body.project === "string" ? body.project : undefined,
    });
    audit(store, "memory.created", `manual record ${rec.id}`);
    return rec;
  });
  return Response.json({ record });
}

export async function DELETE(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const all = url.searchParams.get("all") === "1";
  const rawQuery = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  // "forget this" / "forget that" means the newest record, not a search for
  // the literal word "this".
  const query = /^(this|that|it|the last one|the latest)$/.test(rawQuery) ? "" : rawQuery;
  const removed = await mutate((store) => {
    if (all) {
      const count = store.memory.length;
      store.memory = [];
      audit(store, "memory.cleared", `${count} record(s) deleted by user`);
      return count;
    }
    // "Forget this" — remove the newest matching record, or the newest one
    // when no query was given. It reports how many actually went.
    if (query || url.searchParams.has("q")) {
      const matches = store.memory
        .filter((m) => (query ? m.content.toLowerCase().includes(query) : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const target = matches[0];
      if (!target) return 0;
      store.memory = store.memory.filter((m) => m.id !== target.id);
      audit(store, "memory.forgotten", `${target.id} — ${target.content.slice(0, 80)}`);
      return 1;
    }
    if (!id) return 0;
    const before = store.memory.length;
    store.memory = store.memory.filter((m) => m.id !== id);
    audit(store, "memory.deleted", id);
    return before - store.memory.length;
  });
  return Response.json({ removed });
}
