/**
 * Owner access bootstrap.
 *
 *   GET /api/access?token=<HYDRO_ACCESS_TOKEN>&next=/
 *
 * Verifies the token once and sets an HttpOnly cookie, so the owner's browser
 * can reach the private surfaces without putting the token in the page or in a
 * URL that ends up in history twice. Disabled entirely when no token is set.
 */

import { checkToken, OWNER_COOKIE, tokenConfigured } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!tokenConfigured()) {
    return Response.json(
      {
        error:
          "Owner access is not enabled. Set HYDRO_ACCESS_TOKEN on the server to require a token for private surfaces.",
      },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  if (!checkToken(url.searchParams.get("token"))) {
    return Response.json({ error: "That access token is not valid." }, { status: 401 });
  }

  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const secure = url.protocol === "https:" ? "; Secure" : "";

  return new Response(null, {
    status: 307,
    headers: {
      location: next,
      "set-cookie": `${OWNER_COOKIE}=${encodeURIComponent(url.searchParams.get("token")!)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
      "cache-control": "no-store",
    },
  });
}
