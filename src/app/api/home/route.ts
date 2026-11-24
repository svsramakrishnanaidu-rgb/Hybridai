import {
  LEVEL_NAMES,
  SandboxError,
  ensureHome,
  getLevel,
  listDir,
  readAudit,
  setLevel,
  systemInfo,
  usage,
  type Level,
} from "@/core/ai-home";
import { ownerDenied } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  const wantAudit = url.searchParams.get("audit") === "1";

  try {
    await ensureHome();
    const [stats, level, listing] = await Promise.all([usage(), getLevel(), listDir(path)]);
    return Response.json(
      {
        root: stats.root,
        usage: stats,
        level,
        levelName: LEVEL_NAMES[level],
        path: listing.path,
        entries: listing.entries,
        audit: wantAudit ? await readAudit(40) : undefined,
        system: systemInfo(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const status = err instanceof SandboxError ? err.status : 500;
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not read the AI home" },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}

/** Changing the permission level is logged and capped: level 4 is not available. */
export async function PATCH(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const body = (await req.json().catch(() => ({}))) as { level?: unknown };
  const requested = Number(body.level);
  if (requested === 4) {
    return Response.json(
      {
        error:
          "Level 4 (sensitive system operations) needs a native agent with administrator consent. It is not installed, so it cannot be granted here.",
      },
      { status: 400 },
    );
  }
  if (requested !== 1 && requested !== 2 && requested !== 3) {
    return Response.json({ error: "Level must be 1, 2 or 3" }, { status: 400 });
  }
  const level = await setLevel(requested as Level);
  return Response.json({ level, levelName: LEVEL_NAMES[level] });
}
