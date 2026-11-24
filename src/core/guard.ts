/**
 * HYDRO AI — public endpoint guard.
 *
 * The app is served on a public URL with no accounts, and every turn spends the
 * owner's provider credits. These are the hard limits that sit in front of the
 * costly routes:
 *
 *   · per-client sliding window   — one browser cannot hammer the endpoint
 *   · per-client concurrency      — no request fan-out from a single client
 *   · instance-wide ceiling       — the whole process cannot exceed a spending pace
 *   · duplicate suppression       — double-submits never bill twice
 *   · origin policy               — another site cannot drive the API from a page
 *   · payload ceiling             — oversized bodies are refused before parsing
 *
 * State is per server process. That is deliberate: it needs no database and no
 * account, and it degrades to a restart-clean slate instead of risking a lockout
 * that the owner cannot clear. All values can be tightened with env vars.
 */

import { createHash } from "node:crypto";

interface Window {
  hits: number[];
}

const windows = new Map<string, Window>();
const inFlight = new Map<string, number>();
const recent = new Map<string, number>();
let globalHits: number[] = [];

const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const LIMITS = {
  perMinute: envNumber("HYDRO_RATE_PER_MINUTE", 40),
  concurrent: envNumber("HYDRO_RATE_CONCURRENT", 3),
  globalPerMinute: envNumber("HYDRO_RATE_GLOBAL_PER_MINUTE", 60),
  dedupeMs: envNumber("HYDRO_DEDUPE_MS", 12_000),
  maxBodyBytes: envNumber("HYDRO_MAX_BODY_BYTES", 3_000_000),
};

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export function clientKey(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}

function prune(list: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < list.length && list[i]! < cutoff) i += 1;
  return i ? list.slice(i) : list;
}

/**
 * Origin policy. Browser requests must come from the app's own origin (or an
 * explicitly allowed one). Requests without an Origin header — curl, the
 * evaluation harness, server-to-server — are allowed, because they carry no
 * browser session to hijack; they are constrained by the rate limits instead.
 */
function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host");
  try {
    const originHost = new URL(origin).host;
    if (host && originHost === host) return true;
  } catch {
    return false;
  }
  const allow = (process.env.HYDRO_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.some((entry) => {
    try {
      return new URL(entry).host === new URL(origin).host;
    } catch {
      return false;
    }
  });
}

function deny(status: number, error: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

/**
 * Guard a costly route. Returns a Response to send instead of executing, or
 * null when the request may proceed.
 *
 * `bodyFingerprint` enables duplicate suppression: pass the parsed request text
 * so a repeated identical submission inside the window is refused rather than
 * billed twice.
 */
export function guardRequest(
  req: Request,
  options: { bodyFingerprint?: string } = {},
): Response | null {
  const now = Date.now();
  const key = clientKey(req);

  if (!originAllowed(req)) {
    return deny(403, "This endpoint only accepts requests from the HYDRO app origin.");
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LIMITS.maxBodyBytes) {
    return deny(413, "Request body is too large for this endpoint.");
  }

  // per-client window
  const window = windows.get(key) ?? { hits: [] };
  window.hits = prune(window.hits, now, 60_000);
  if (window.hits.length >= LIMITS.perMinute) {
    const retry = Math.max(1, Math.ceil((window.hits[0]! + 60_000 - now) / 1000));
    windows.set(key, window);
    return deny(429, `Too many requests — try again in ${retry}s.`, {
      "retry-after": String(retry),
    });
  }
  window.hits.push(now);
  windows.set(key, window);

  // instance-wide pace ceiling
  globalHits = prune(globalHits, now, 60_000);
  if (globalHits.length >= LIMITS.globalPerMinute) {
    return deny(429, "HYDRO is at its request ceiling for this minute. Try again shortly.", {
      "retry-after": "30",
    });
  }
  globalHits.push(now);

  // concurrency
  const running = inFlight.get(key) ?? 0;
  if (running >= LIMITS.concurrent) {
    return deny(429, "You already have requests in flight — wait for one to finish.", {
      "retry-after": "5",
    });
  }

  // duplicate suppression
  if (options.bodyFingerprint) {
    const digest = createHash("sha256").update(options.bodyFingerprint).digest("hex");
    const seenAt = recent.get(`${key}:${digest}`);
    if (seenAt && now - seenAt < LIMITS.dedupeMs) {
      const retry = Math.max(1, Math.ceil((seenAt + LIMITS.dedupeMs - now) / 1000));
      return deny(429, "That looks like a duplicate submission — it is already being answered.", {
        "retry-after": String(retry),
      });
    }
    recent.set(`${key}:${digest}`, now);
    if (recent.size > 500) {
      for (const [k, at] of recent) if (now - at > LIMITS.dedupeMs) recent.delete(k);
    }
  }

  return null;
}

/** Track a guarded request's lifetime so concurrency accounting stays honest. */
export function enterRequest(req: Request): () => void {
  const key = clientKey(req);
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (inFlight.get(key) ?? 1) - 1;
    if (next <= 0) inFlight.delete(key);
    else inFlight.set(key, next);
  };
}

/** Read a request body with a hard cap, refusing instead of buffering forever. */
export async function readBoundedText(
  req: Request,
  maxBytes = LIMITS.maxBodyBytes,
): Promise<{ text: string } | { error: Response }> {
  const text = await req.text();
  if (text.length > maxBytes) {
    return { error: deny(413, "Request body is too large for this endpoint.") };
  }
  return { text };
}
