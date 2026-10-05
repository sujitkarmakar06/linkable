import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { gscAuthUrl, gscEnabled } from "@/lib/gsc";
import { getCurrentMembership, getSessionUser } from "@/server/session";
import { hasRole } from "@/lib/roles";

const GSC_STATE_COOKIE = "lk_gsc";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  const membership = await getCurrentMembership();
  if (!user || !membership || !hasRole(membership.role, "ADMIN")) return NextResponse.redirect(new URL("/login", req.url));
  const siteId = req.nextUrl.searchParams.get("siteId") ?? "";
  const site = await db.site.findFirst({ where: { id: siteId, workspaceId: membership.workspaceId } });
  if (!site || !gscEnabled()) return NextResponse.redirect(new URL("/app/sites", req.url));

  const state = randomToken(16);
  const res = NextResponse.redirect(gscAuthUrl(state));
  res.cookies.set(GSC_STATE_COOKIE, `${state}.${site.id}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/api/gsc" });
  return res;
}
