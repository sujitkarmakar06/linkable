import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { gscApi } from "@/lib/gsc";
import { hasRole } from "@/lib/roles";
import { saveConnection } from "@/server/gsc";
import { markVerified, recordVerifyFailure } from "@/server/sites";
import { getCurrentMembership } from "@/server/session";

const GSC_STATE_COOKIE = "lk_gsc";

// One Google sign-in proves ownership (if the site isn't verified yet) and
// stores read-only Search Console access for indexing checks and impact.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const [expected, siteId] = (req.cookies.get(GSC_STATE_COOKIE)?.value ?? "").split(".");
  const back = (id: string, result: string) => {
    const res = NextResponse.redirect(new URL(`/app/sites/${id}?gsc=${result}`, req.url));
    res.cookies.delete({ name: GSC_STATE_COOKIE, path: "/api/gsc" });
    return res;
  };

  if (!expected || params.get("state") !== expected) return NextResponse.redirect(new URL("/app/sites", req.url));
  const membership = await getCurrentMembership();
  const site = membership && hasRole(membership.role, "ADMIN") ? await db.site.findFirst({ where: { id: siteId, workspaceId: membership.workspaceId } }) : null;
  if (!site || !membership) return NextResponse.redirect(new URL("/app/sites", req.url));
  const code = params.get("code");
  if (!code) return back(site.id, "cancelled");

  const api = gscApi();
  let grant;
  let properties: string[];
  try {
    grant = await api.exchangeCode(code);
    properties = await api.ownedProperties(grant.accessToken, site.domain);
  } catch (err) {
    if (!site.verifiedAt) await recordVerifyFailure(site.id, `Search Console check failed: ${(err as Error).message}`);
    return back(site.id, "error");
  }
  const g = grant;

  // On failure the token is simply not stored. It isn't revoked: revoking ends the
  // Google account's whole grant, which other sites' connections may share.
  if (!properties.length) {
    if (!site.verifiedAt) await recordVerifyFailure(site.id, `That Google account isn't an owner or full user of ${site.domain} in Search Console.`);
    return back(site.id, "not_owner");
  }
  const wasVerified = Boolean(site.verifiedAt);
  if (!wasVerified) {
    const marked = await markVerified(site, "GSC");
    if (!marked.ok) {
      await recordVerifyFailure(site.id, marked.reason);
      return back(site.id, "taken");
    }
  }
  if (!g.refreshToken) {
    // Google only omits it when the consent screen was skipped; ownership still counts.
    return back(site.id, wasVerified ? "no_token" : "ok_no_token");
  }
  await saveConnection({ siteId: site.id, properties, refreshToken: g.refreshToken, email: g.email, userId: membership.userId });
  await db.auditLog.create({ data: { workspaceId: site.workspaceId, actorId: membership.userId, action: "site.gsc_connected", target: site.id, meta: { properties } } });
  return back(site.id, wasVerified ? "connected" : "ok");
}
