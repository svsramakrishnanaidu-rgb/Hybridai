import { executePlan, readHistory, requestCancel } from "@/core/actions";
import { LEVEL_NAMES, getLevel, logAudit } from "@/core/ai-home";
import { applyAliases, readAliases } from "@/core/personal";
import { dropPending, putPending, takePending } from "@/core/pending";
import { planInstruction, type Plan } from "@/core/planner";
import { listWorkflows, runWorkflow } from "@/core/workflows";
import { ownerDenied } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const [history, level] = await Promise.all([readHistory(30), getLevel()]);
  return Response.json(
    { history, level, levelName: LEVEL_NAMES[level] },
    { headers: { "cache-control": "no-store" } },
  );
}

interface Body {
  instruction?: string;
  planId?: string;
  approve?: boolean;
}

/** Pick the approved workflow whose title best matches the request. */
async function bestWorkflow(instruction: string) {
  const approved = (await listWorkflows()).filter((w) => w.status === "approved");
  if (!approved.length) return null;
  const words = instruction
    .toLowerCase()
    .split(/[^a-z0-9\u0C00-\u0C7F]+/u)
    .filter((w) => w.length > 3);
  let best: { id: string; score: number } | null = null;
  for (const wf of approved) {
    const haystack = `${wf.title} ${wf.transcript}`.toLowerCase();
    const score = words.reduce((sum, w) => sum + (haystack.includes(w) ? 1 : 0), 0);
    if (!best || score > best.score) best = { id: wf.id, score };
  }
  return best ? best.id : approved[0].id;
}

export async function POST(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const body = (await req.json().catch(() => ({}))) as Body;
  const level = await getLevel();

  // ── approval of a stored plan (the client only sends the id) ─────────────
  if (body.planId) {
    const pending = takePending(body.planId);
    if (!pending) {
      return Response.json(
        { error: "That plan expired or was already handled. Ask again." },
        { status: 410 },
      );
    }
    if (body.approve !== true) {
      dropPending(body.planId);
      return Response.json({ cancelled: true });
    }
    const record = await executePlan(pending.plan, pending.instruction);
    return Response.json({ kind: "executed", record, level, levelName: LEVEL_NAMES[level] });
  }

  const raw = (body.instruction ?? "").trim();
  if (!raw) return Response.json({ error: "An instruction is required" }, { status: 400 });

  const aliases = await readAliases();
  const expanded = applyAliases(raw, aliases);
  const plan: Plan = planInstruction(expanded);

  if (plan.intent === "workflow.run") {
    const id = await bestWorkflow(expanded);
    if (!id) {
      return Response.json(
        {
          handled: false,
          kind: "workflow.none",
          message: "No approved workflow yet. Teach one from the workspace panel first.",
        },
        { status: 200 },
      );
    }
    const outcome = await runWorkflow(id);
    if (!outcome) {
      return Response.json(
        { handled: false, kind: "workflow.not_approved", message: "That workflow is not approved." },
        { status: 200 },
      );
    }
    return Response.json({ kind: "workflow", ...outcome, level, levelName: LEVEL_NAMES[level] });
  }

  if (!plan.handled) {
    return Response.json(
      {
        handled: false,
        kind: plan.intent,
        plan,
        message:
          plan.needsClarification ??
          (plan.intent === "workflow.learn"
            ? "Open the workspace panel to teach a workflow."
            : "No executable step matched, so this was answered as conversation instead."),
      },
      { status: 200 },
    );
  }

  if (plan.needsClarification) {
    return Response.json({ handled: false, kind: plan.intent, plan, message: plan.needsClarification });
  }

  if (!plan.requiresApproval) {
    const record = await executePlan(plan, expanded);
    return Response.json({ kind: "executed", record, plan, level, levelName: LEVEL_NAMES[level] });
  }

  return Response.json({
    kind: "approval_required",
    planId: putPending(plan, expanded),
    plan,
    level,
    levelName: LEVEL_NAMES[level],
  });
}

/**
 * Emergency stop for device work.
 *
 * `?id=` cancels one plan that is waiting for approval. Without an id this is
 * the stop button: any plan currently executing declines to start its next
 * step, and the audit log records the stop.
 */
export async function DELETE(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const generation = requestCancel();
    await logAudit("emergency.stop", `Device execution cancelled (generation ${generation})`);
    return Response.json({ cancelled: true, stoppedRunningPlans: true });
  }
  return Response.json({ cancelled: dropPending(id) });
}
