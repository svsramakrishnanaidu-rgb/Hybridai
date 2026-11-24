import { readText, getLevel, LEVEL_NAMES } from "@/core/ai-home";
import { executeStep } from "@/core/actions";
import { guardRequest } from "@/core/guard";
import type { PlanStep } from "@/core/planner";
import { ownerDenied } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read one file. Reading is a level 1 operation; the sandbox still applies. */
export async function GET(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  try {
    const [level, file] = await Promise.all([getLevel(), readText(path)]);
    return Response.json(
      { ...file, level, levelName: LEVEL_NAMES[level] },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not read the file" },
      { status: 400 },
    );
  }
}

interface Body {
  op?: "mkdir" | "write" | "move" | "trash";
  path?: string;
  to?: string;
  content?: string;
}

/**
 * Mutations go through the same permission gate and verification path as any
 * other tool step — there is no second, weaker route into the home.
 */
export async function POST(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const blocked = guardRequest(req);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as Body;
  let step: PlanStep | null = null;

  switch (body.op) {
    case "mkdir":
      if (body.path) step = { tool: "home.mkdir", args: { path: body.path }, note: `Create ${body.path}` };
      break;
    case "write":
      if (body.path)
        step = {
          tool: "home.write",
          args: { path: body.path, content: body.content ?? "" },
          note: `Write ${body.path}`,
        };
      break;
    case "move":
      if (body.path && body.to)
        step = {
          tool: "home.move",
          args: { from: body.path, to: body.to },
          note: `Move ${body.path} → ${body.to}`,
        };
      break;
    case "trash":
      if (body.path) step = { tool: "home.trash", args: { path: body.path }, note: `Trash ${body.path}` };
      break;
    default:
      break;
  }

  if (!step) {
    return Response.json({ error: "Unknown or incomplete operation" }, { status: 400 });
  }

  const level = await getLevel();
  const result = await executeStep(step, level);
  return Response.json(
    { result, level, levelName: LEVEL_NAMES[level] },
    { status: result.ok ? 200 : 403, headers: { "cache-control": "no-store" } },
  );
}
