import { NextResponse } from "next/server";
import { describeFrame, parseFrame, visionProviderStatus } from "@/core/vision-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One explicit visual question about one still frame.
 *
 * The image path itself lives in src/core/vision-bridge.ts, shared with the
 * chat pipeline so both send the frame the same way. This route adds the
 * endpoint-level rate limit and the JSON shape the vision panel expects.
 */

interface Body {
  image?: unknown;
  question?: unknown;
}

/**
 * Small in-memory guard: continuous sight is capped in the browser, but the
 * endpoint itself must not be spammable. Ten looks per minute per client is far
 * above the 1-per-12-s continuous-sight cadence.
 */
const RATE = { windowMs: 60_000, max: 10 };
const hits = new Map<string, number[]>();

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

function allowRequest(req: Request, now = Date.now()): boolean {
  const key = clientKey(req);
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE.windowMs);
  if (recent.length >= RATE.max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  // keep the map from growing without bound in a long-lived process
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > RATE.windowMs) hits.delete(k);
  }
  return true;
}

export async function POST(req: Request) {
  if (!allowRequest(req)) {
    return NextResponse.json(
      { error: "Too many visual requests. Wait a moment and try again." },
      { status: 429 },
    );
  }

  const status = visionProviderStatus();
  if (!status.available) {
    return NextResponse.json({ error: status.reason }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const image = parseFrame(body.image);
  if (!image) {
    return NextResponse.json(
      { error: "A JPEG/PNG/WebP frame under ~1.6 MB is required." },
      { status: 400 },
    );
  }

  const question =
    typeof body.question === "string" && body.question.trim()
      ? body.question
      : "What can you see in this frame? Describe only what is clearly visible.";

  try {
    const result = await describeFrame(image, question);
    if (result.failures.length) {
      console.error("[vision] observation failover:", result.failures.join(" · "));
    }
    return NextResponse.json({
      answer: result.text,
      model: result.model,
      latencyMs: result.latencyMs,
      frames: 1,
    });
  } catch (err) {
    const failures = (err as Error & { failures?: string[] }).failures ?? [];
    if (failures.length) console.error("[vision] observation failed:", failures.join(" · "));
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "The vision model could not answer that frame. Nothing was stored.",
      },
      { status: 502 },
    );
  }
}
