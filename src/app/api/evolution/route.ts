import { approve, deriveProposals, reject, rollback } from "@/core/evolution";
import { audit, mutate, readStore } from "@/core/memory";
import { ownerDenied } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const store = await mutate((s) => {
    const fresh = deriveProposals(s);
    if (fresh.length) s.proposals = [...fresh, ...s.proposals].slice(0, 60);
    return s;
  });
  return Response.json(
    {
      proposals: store.proposals,
      bias: store.bias,
      stats: store.stats,
      usage: store.usage,
      audit: store.audit.slice(0, 20),
      version: "1.0.0",
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!body.id || !body.action) {
    return Response.json({ error: "id and action are required" }, { status: 400 });
  }
  const outcome = await mutate((store) => {
    switch (body.action) {
      case "approve":
        return approve(store, body.id!);
      case "reject":
        return reject(store, body.id!);
      case "rollback":
        return rollback(store, body.id!);
      default:
        audit(store, "proposal.invalid_action", String(body.action));
        return null;
    }
  });
  if (!outcome) {
    return Response.json({ error: "Proposal not found or action not allowed" }, { status: 404 });
  }
  const store = await readStore();
  return Response.json({ proposal: outcome, bias: store.bias });
}
