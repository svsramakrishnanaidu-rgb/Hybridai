/**
 * HYDRO AI — owner gate for private surfaces.
 *
 * On a public URL these routes expose the owner's workspace, notes, memory,
 * task history and tool execution. Chat stays public (it is the product), but
 * the owner surfaces must not be readable or writable by whoever holds the link.
 *
 * This is opt-in and fail-safe:
 *   · If HYDRO_ACCESS_TOKEN is not set, nothing changes — the app behaves
 *     exactly as before, so a local or private deployment is unaffected.
 *   · If it is set, these routes require the token as an `x-hydro-token`
 *     header or the `hydro_access` cookie. The cookie is issued only by
 *     /api/access after a correct token, and is HttpOnly so page scripts
 *     cannot read it.
 *
 * The comparison is constant-time, so a wrong token cannot be discovered by
 * timing the response.
 */

import { timingSafeEqual } from "node:crypto";

const TOKEN = (process.env.HYDRO_ACCESS_TOKEN ?? "").trim();
export const OWNER_COOKIE = "hydro_access";

export function ownerGateEnabled(): boolean {
  return Boolean(TOKEN);
}

function matches(candidate: string | undefined | null): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isOwner(req: Request): boolean {
  if (!TOKEN) return true;
  if (matches(req.headers.get("x-hydro-token"))) return true;
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === OWNER_COOKIE) {
      return matches(decodeURIComponent(rest.join("=")));
    }
  }
  return false;
}

/** Returns the response to send when the caller is not the owner, else null. */
export function ownerDenied(req: Request): Response | null {
  if (isOwner(req)) return null;
  return new Response(
    JSON.stringify({
      error:
        "This surface belongs to the HYDRO owner. Open /api/access?token=… once to set an owner cookie.",
    }),
    {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

export function tokenConfigured(): boolean {
  return Boolean(TOKEN);
}

export function checkToken(candidate: string | null): boolean {
  return matches(candidate ?? undefined);
}
