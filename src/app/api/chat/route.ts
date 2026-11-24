import { runFlow } from "@/core/hydra-flow";
import { normalizeAffect } from "@/core/affect";
import { normalizeDevice } from "@/core/environment";
import { enterRequest, guardRequest } from "@/core/guard";
import { parseFrame } from "@/core/vision-context";
import type { Mode, StreamEvent } from "@/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

const VALID_MODES: Mode[] = ["flash", "hybrid", "deep", "council"];

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

function sanitize(raw: unknown): IncomingMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is IncomingMessage =>
        !!m &&
        typeof m === "object" &&
        (m as IncomingMessage).role !== undefined &&
        ((m as IncomingMessage).role === "user" || (m as IncomingMessage).role === "assistant") &&
        typeof (m as IncomingMessage).content === "string",
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12_000) }));
}

export async function POST(req: Request) {
  let body: {
    messages?: unknown;
    mode?: unknown;
    visualContext?: unknown;
    affect?: unknown;
    device?: unknown;
    image?: unknown;
    camera?: unknown;
    language?: unknown;
    project?: unknown;
  };
  // Read once so the same bytes can be fingerprinted for duplicate suppression.
  const raw = await req.text();
  const blocked = guardRequest(req, { bodyFingerprint: raw });
  if (blocked) return blocked;
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const messages = sanitize(body.messages);
  if (!messages.length) {
    return new Response(JSON.stringify({ error: "At least one message is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const mode = VALID_MODES.includes(body.mode as Mode) ? (body.mode as Mode) : "hybrid";

  // A frame is either valid or the request is refused. Silently dropping it is
  // exactly how a visual question ends up answered as if no camera existed.
  const image =
    body.image === undefined || body.image === null ? undefined : (parseFrame(body.image) ?? undefined);
  if (body.image !== undefined && body.image !== null && !image) {
    return new Response(
      JSON.stringify({
        error:
          "The camera frame was not a valid JPEG/PNG/WebP image under ~1.6 MB, so it was not sent. Nothing was analysed.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const visualContext =
    typeof body.visualContext === "string"
      ? body.visualContext.trim().slice(0, 1200)
      : undefined;
  const encoder = new TextEncoder();
  const release = enterRequest(req);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of runFlow({
          messages,
          mode,
          signal: req.signal,
          vision: visualContext,
          affect: normalizeAffect(body.affect),
          device: normalizeDevice(body.device),
          image,
          camera: body.camera,
          replyLanguage:
            body.language === "en" || body.language === "te" || body.language === "mixed"
              ? body.language
              : undefined,
          project:
            typeof body.project === "string"
              ? body.project.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40) || undefined
              : undefined,
        })) {
          send(event);
        }
      } catch (err) {
        send({
          kind: "error",
          message:
            err instanceof Error
              ? `Orchestration error: ${err.message}`
              : "Orchestration failed unexpectedly.",
        });
      } finally {
        release();
        try {
          controller.close();
        } catch {
          // client already disconnected
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
