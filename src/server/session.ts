import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { WorkspaceRole } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hasRole } from "@/lib/roles";

export const WORKSPACE_COOKIE = "lk_ws";

export const getSessionUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findUnique({ where: { id: session.user.id } });
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user || user.suspendedAt) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.platformRole !== "ADMIN") redirect("/app");
  return user;
}

// Current workspace = cookie, else last used, else first membership.
export const getCurrentMembership = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const jar = await cookies();
  const preferred = jar.get(WORKSPACE_COOKIE)?.value ?? user.lastWorkspaceId ?? undefined;
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.find((m) => m.workspaceId === preferred) ?? memberships[0] ?? null;
});

export async function requireMembership(minRole: WorkspaceRole = "VIEWER") {
  const user = await requireUser();
  const membership = await getCurrentMembership();
  if (!membership) redirect("/onboarding");
  if (!hasRole(membership.role, minRole)) throw new Error("You don't have permission to do that in this workspace.");
  // A suspended workspace can still be viewed (and left), but not used to trade.
  if (membership.workspace.suspendedAt && minRole !== "VIEWER") throw new Error("This workspace is suspended. Contact support.");
  return { user, membership, workspace: membership.workspace };
}
