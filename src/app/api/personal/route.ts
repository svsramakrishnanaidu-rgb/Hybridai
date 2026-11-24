import {
  addAlias,
  addGestureTemplate,
  deleteAlias,
  deleteGestureTemplate,
  readAliases,
  readGestureTemplates,
} from "@/core/personal";
import { ownerDenied } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const [aliases, gestures] = await Promise.all([readAliases(), readGestureTemplates()]);
  return Response.json({ aliases, gestures }, { headers: { "cache-control": "no-store" } });
}

interface Body {
  kind?: "alias" | "gesture";
  alias?: string;
  canonical?: string;
  name?: string;
  command?: string;
  signature?: unknown;
}

export async function POST(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const body = (await req.json().catch(() => ({}))) as Body;
  try {
    if (body.kind === "alias") {
      const record = await addAlias(body.alias ?? "", body.canonical ?? "");
      return Response.json({ record, aliases: await readAliases() });
    }
    if (body.kind === "gesture") {
      const record = await addGestureTemplate({
        name: body.name ?? "",
        command: body.command ?? "",
        signature: body.signature,
      });
      return Response.json({ record, gestures: await readGestureTemplates() });
    }
    return Response.json({ error: "kind must be alias or gesture" }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not save" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  if (!id || (kind !== "alias" && kind !== "gesture")) {
    return Response.json({ error: "kind and id are required" }, { status: 400 });
  }
  const removed = kind === "alias" ? await deleteAlias(id) : await deleteGestureTemplate(id);
  return Response.json({ removed });
}
