import type { Metadata } from "next";
import type { WorkspaceRole } from "@prisma/client";
import { db } from "@/lib/db";
import { canAssignRole, hasRole, ROLE_LABEL } from "@/lib/roles";
import { changeRoleAction, inviteMemberAction, removeMemberAction, renameWorkspaceAction, revokeInviteAction } from "@/server/actions/workspace";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Workspace" };

const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

export default async function WorkspacePage() {
  const { user, membership, workspace } = await requireMembership();
  const isAdmin = hasRole(membership.role, "ADMIN");
  const [members, invites] = await Promise.all([
    db.membership.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    isAdmin ? db.invite.findMany({ where: { workspaceId: workspace.id, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }) : [],
  ]);
  const assignable = ROLES.filter((r) => canAssignRole(membership.role, r));

  return (
    <>
      <PageHeader title="Workspace" description="Your team, roles and invites." />
      <div className="flex max-w-3xl flex-col gap-4">
        {isAdmin && (
          <Card title="Name">
            <ActionForm action={renameWorkspaceAction} submit="Save" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Input name="name" defaultValue={workspace.name} aria-label="Workspace name" required />
              </div>
            </ActionForm>
          </Card>
        )}

        <Card title="Members" description="Owners manage everything. Admins manage members and sites. Members run deals. Viewers can only look.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Person</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const self = m.userId === user.id;
                  const manageable = !self && canAssignRole(membership.role, m.role);
                  return (
                    <tr key={m.id} className="border-t border-border">
                      <td className="py-2 pr-4">
                        <div>{m.user.name ?? m.user.email}</div>
                        <div className="text-xs text-muted">{m.user.email}</div>
                      </td>
                      <td className="py-2 pr-4">
                        {manageable ? (
                          <form action={changeRoleAction} className="flex gap-2">
                            <input type="hidden" name="membershipId" value={m.id} />
                            <Select name="role" defaultValue={m.role} aria-label={`Role for ${m.user.email}`}>
                              {assignable.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABEL[r]}
                                </option>
                              ))}
                            </Select>
                            <Button variant="secondary">Update</Button>
                          </form>
                        ) : (
                          ROLE_LABEL[m.role]
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {(self || manageable) && (
                          <form action={removeMemberAction}>
                            <input type="hidden" name="membershipId" value={m.id} />
                            <Button variant="ghost">{self ? "Leave" : "Remove"}</Button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {isAdmin && (
          <Card title="Invite someone" description="They'll get an email link that's valid for 7 days.">
            <ActionForm action={inviteMemberAction} submit="Send invite" className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Email">
                  <Input name="email" type="email" required />
                </Field>
                <Field label="Role">
                  <Select name="role" defaultValue="MEMBER">
                    {assignable.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </ActionForm>
            {invites.length > 0 && (
              <ul className="mt-5 flex flex-col gap-2 border-t border-border pt-4 text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span>
                      {i.email} <span className="text-muted">· {ROLE_LABEL[i.role]} · pending</span>
                    </span>
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="inviteId" value={i.id} />
                      <Button variant="ghost">Revoke</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
