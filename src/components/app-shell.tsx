import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { logoutAction } from "@/server/actions/auth";
import { switchWorkspaceAction } from "@/server/actions/workspace";
import { getCurrentMembership, requireUser } from "@/server/session";
import { Logo } from "./logo";
import { NavLink } from "./nav-link";

export async function AppShell({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const current = await getCurrentMembership();
  const memberships = await db.membership.findMany({ where: { userId: user.id }, include: { workspace: true }, orderBy: { createdAt: "asc" } });
  const pending = current ? await db.proposal.count({ where: { awaitingWorkspaceId: current.workspaceId, status: "OPEN" } }) : 0;
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  const matches = current
    ? await db.match.count({ where: { workspaceId: current.workspaceId, status: "OFFERED", expiresAt: { gt: new Date() }, linkRequest: { status: "OPEN" } } })
    : 0;

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
          <NavLink href="/app/notifications">
            Notifications {unread > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-accent-fg">{unread}</span>}
          </NavLink>
          <NavLink href="/app/marketplace">Marketplace</NavLink>
          <NavLink href="/app/sites">My sites</NavLink>
          <NavLink href="/app/matches">
            Matches {matches > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-accent-fg">{matches}</span>}
          </NavLink>
          <NavLink href="/app/requests">Link requests</NavLink>
          <NavLink href="/app/proposals">
            Proposals {pending > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-accent-fg">{pending}</span>}
          </NavLink>
          <NavLink href="/app/deals">Deals</NavLink>
          <NavLink href="/app/credits">Credits</NavLink>
          <NavLink href="/app/workspace">Workspace</NavLink>
          <NavLink href="/app/account">Account</NavLink>
          {user.platformRole === "ADMIN" && (
            <>
              <NavLink href="/admin" exact>
                Admin
              </NavLink>
              <NavLink href="/admin/analytics">Analytics</NavLink>
              <NavLink href="/admin/sites">Site reviews</NavLink>
              <NavLink href="/admin/disputes">Disputes</NavLink>
            </>
          )}
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
