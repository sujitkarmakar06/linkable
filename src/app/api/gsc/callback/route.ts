import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { gscOwnsDomain } from "@/lib/gsc";
import { hasRole } from "@/lib/roles";
import { markVerified, recordVerifyFailure } from "@/server/sites";
import { getCurrentMembership } from "@/server/session";

const GSC_STATE_COOKIE = "lk_gsc";

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
  if (!site) return NextResponse.redirect(new URL("/app/sites", req.url));
  const code = params.get("code");
  if (!code) return back(site.id, "cancelled");

  try {
    if (!(await gscOwnsDomain(code, site.domain))) {
      await recordVerifyFailure(site.id, `That Google account isn't an owner or full user of ${site.domain} in Search Console.`);
      return back(site.id, "not_owner");
    }
  } catch (err) {
    await recordVerifyFailure(site.id, `Search Console check failed: ${(err as Error).message}`);
    return back(site.id, "error");
  }
  const marked = await markVerified(site, "GSC");
  if (!marked.ok) await recordVerifyFailure(site.id, marked.reason);
  return back(site.id, marked.ok ? "ok" : "taken");
}
