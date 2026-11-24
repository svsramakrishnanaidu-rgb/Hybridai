import { LEVEL_NAMES, getLevel } from "@/core/ai-home";
import { decideWorkflow, learnWorkflow, listWorkflows, runWorkflow } from "@/core/workflows";
import { ownerDenied } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const [workflows, level] = await Promise.all([listWorkflows(), getLevel()]);
  return Response.json(
    { workflows, level, levelName: LEVEL_NAMES[level] },
    { headers: { "cache-control": "no-store" } },
  );
}

interface Body {
  action?: "learn" | "approve" | "reject" | "delete" | "run";
  id?: string;
  transcript?: string;
  title?: string;
  markers?: Array<{ at: number; name: string; confidence: number }>;
}

export async function POST(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action ?? "learn";

  try {
    if (action === "learn") {
      const workflow = await learnWorkflow({
        transcript: body.transcript ?? "",
        title: body.title,
        markers: Array.isArray(body.markers) ? body.markers.slice(0, 60) : undefined,
      });
      return Response.json({ workflow, workflows: await listWorkflows() });
    }

    if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });

    if (action === "run") {
      const outcome = await runWorkflow(body.id);
      if (!outcome) {
        return Response.json(
          { error: "Workflow not found or not approved. Approve it before running." },
          { status: 409 },
        );
      }
      return Response.json({ ...outcome, workflows: await listWorkflows() });
    }

    const workflow = await decideWorkflow(body.id, action);
    if (!workflow) return Response.json({ error: "Workflow not found" }, { status: 404 });
    return Response.json({ workflow, workflows: await listWorkflows() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Workflow operation failed" },
      { status: 400 },
    );
  }
}
