import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { logoutAction } from "@/server/actions/auth";
import { switchWorkspaceAction } from "@/server/actions/workspace";
import { getCurrentMembership, requireUser } from "@/server/session";
import { Logo } from "./logo";
import { NavLink } from "./nav-link";
import { Badge } from "./ui";

// Planned sections are listed (greyed) so the roadmap is visible, but they
// aren't links until their phase ships.
const UPCOMING = ["Sites", "Link requests", "Deals", "Credits"];

export async function AppShell({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const current = await getCurrentMembership();
  const memberships = await db.membership.findMany({ where: { userId: user.id }, include: { workspace: true }, orderBy: { createdAt: "asc" } });

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-border bg-surface p-4 md:w-60 md:border-r md:border-b-0">
        <Logo href="/app" />
        {current && memberships.length > 0 && (
          <form action={switchWorkspaceAction} className="flex gap-2">
            <select
              name="workspaceId"
              defaultValue={current.workspaceId}
              aria-label="Workspace"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            >
              {memberships.map((m) => (
                <option key={m.id} value={m.workspaceId}>
                  {m.workspace.name}
                </option>
              ))}
            </select>
            <button className="rounded-md border border-border px-2 text-xs">Go</button>
          </form>
        )}
        <nav className="flex flex-row flex-wrap gap-1 md:flex-col">
          <NavLink href="/app" exact>
            Dashboard
          </NavLink>
          {UPCOMING.map((label) => (
            <span key={label} className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-muted/60">
              {label} <Badge>soon</Badge>
            </span>
          ))}
          <NavLink href="/app/workspace">Workspace</NavLink>
          <NavLink href="/app/account">Account</NavLink>
          {user.platformRole === "ADMIN" && <NavLink href="/admin">Admin</NavLink>}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4 text-sm">
          <span className="truncate text-muted" title={user.email}>
            {user.name ?? user.email}
          </span>
          <form action={logoutAction}>
            <button className="text-muted hover:text-text">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 md:px-10">{children}</main>
    </div>
  );
}
