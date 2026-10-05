import type { WorkspaceRole } from "@prisma/client";

const RANK: Record<WorkspaceRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export const hasRole = (actual: WorkspaceRole, required: WorkspaceRole) => RANK[actual] >= RANK[required];

// Admins can manage members below them; only owners can grant ADMIN or OWNER.
export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return RANK[target] < RANK.ADMIN;
  return false;
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};
