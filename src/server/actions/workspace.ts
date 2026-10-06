"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { WorkspaceRole } from "@prisma/client";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { slugify } from "@/lib/domain";
import { appUrl, sendEmail } from "@/lib/email";
import { canAssignRole, ROLE_LABEL } from "@/lib/roles";
import { requireMembership, requireUser, WORKSPACE_COOKIE } from "@/server/session";
import type { FormState } from "./types";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

async function setCurrentWorkspace(userId: string, workspaceId: string) {
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, COOKIE_OPTS);
  await db.user.update({ where: { id: userId }, data: { lastWorkspaceId: workspaceId } });
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  for (let i = 0; ; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await db.workspace.findUnique({ where: { slug } }))) return slug;
  }
}

export async function createWorkspaceAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = z.string().trim().min(2, "Name must be at least 2 characters").max(60).safeParse(form.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  // Google sign-ups skip the signup form, so they accept the terms here.
  if (!user.termsAcceptedAt) {
    if (form.get("terms") !== "on") return { error: "Please accept the Terms of Service and Privacy Policy." };
    await db.user.update({ where: { id: user.id }, data: { termsAcceptedAt: new Date() } });
  }
  const workspace = await db.workspace.create({
    data: {
      name: name.data,
      slug: await uniqueSlug(name.data),
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "workspace.created" } });
  await setCurrentWorkspace(user.id, workspace.id);
  redirect("/app");
}

export async function switchWorkspaceAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("workspaceId") ?? "");
  const member = await db.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId: id } } });
  if (member) await setCurrentWorkspace(user.id, id);
  redirect("/app");
}

export async function renameWorkspaceAction(_: FormState, form: FormData): Promise<FormState> {
  const { workspace } = await requireMembership("ADMIN");
  const name = z.string().trim().min(2).max(60).safeParse(form.get("name"));
  if (!name.success) return { error: "Name must be 2-60 characters." };
  await db.workspace.update({ where: { id: workspace.id }, data: { name: name.data } });
  revalidatePath("/app", "layout");
  return { ok: "Saved." };
}

const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);

export async function inviteMemberAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, membership, workspace } = await requireMembership("ADMIN");
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), role: roleSchema })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, role } = parsed.data;
  if (!canAssignRole(membership.role, role)) return { error: `You can't invite someone as ${ROLE_LABEL[role]}.` };

  const already = await db.membership.findFirst({ where: { workspaceId: workspace.id, user: { email } } });
  if (already) return { error: "That person is already a member." };

  const token = randomToken();
  await db.invite.deleteMany({ where: { workspaceId: workspace.id, email, acceptedAt: null } });
  await db.invite.create({
    data: { workspaceId: workspace.id, email, role, invitedById: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
  });
  await sendEmail(email, `Join ${workspace.name} on Linkable`, `You're invited to ${workspace.name}`, `${user.name ?? user.email} invited you to join as ${ROLE_LABEL[role]}. The invite expires in 7 days.`, {
    label: "Accept invite",
    url: appUrl(`/invite/${token}`),
  });
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "member.invited", target: email, meta: { role } } });
  revalidatePath("/app/workspace");
  return { ok: `Invite sent to ${email}.` };
}

export async function revokeInviteAction(form: FormData) {
  const { workspace } = await requireMembership("ADMIN");
  await db.invite.deleteMany({ where: { id: String(form.get("inviteId")), workspaceId: workspace.id, acceptedAt: null } });
  revalidatePath("/app/workspace");
}

export async function acceptInviteAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const invite = await db.invite.findUnique({ where: { tokenHash: sha256(String(form.get("token") ?? "")) } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return { error: "This invite is invalid or has expired." };
  if (invite.email !== user.email.toLowerCase()) return { error: `This invite was sent to ${invite.email}. Sign in with that email to accept it.` };
  await db.$transaction([
    db.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
      update: {},
      create: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role },
    }),
    db.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
    db.auditLog.create({ data: { actorId: user.id, workspaceId: invite.workspaceId, action: "member.joined" } }),
  ]);
  await setCurrentWorkspace(user.id, invite.workspaceId);
  redirect("/app");
}

async function ownerCount(workspaceId: string) {
  return db.membership.count({ where: { workspaceId, role: "OWNER" } });
}

export async function changeRoleAction(form: FormData) {
  const { user, membership, workspace } = await requireMembership("ADMIN");
  const target = await db.membership.findFirst({ where: { id: String(form.get("membershipId")), workspaceId: workspace.id } });
  const role = roleSchema.parse(form.get("role")) as WorkspaceRole;
  if (!target || target.userId === user.id) return;
  if (!canAssignRole(membership.role, target.role) || !canAssignRole(membership.role, role)) return;
  if (target.role === "OWNER" && role !== "OWNER" && (await ownerCount(workspace.id)) <= 1) return;
  await db.membership.update({ where: { id: target.id }, data: { role } });
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "member.role_changed", target: target.userId, meta: { role } } });
  revalidatePath("/app/workspace");
}

export async function removeMemberAction(form: FormData) {
  const { user, membership, workspace } = await requireMembership("VIEWER");
  const target = await db.membership.findFirst({ where: { id: String(form.get("membershipId")), workspaceId: workspace.id } });
  if (!target) return;
  const leaving = target.userId === user.id;
  // Anyone may leave; removing others needs authority over their role.
  if (!leaving && !canAssignRole(membership.role, target.role)) return;
  if (target.role === "OWNER" && (await ownerCount(workspace.id)) <= 1) return; // never orphan a workspace
  await db.membership.delete({ where: { id: target.id } });
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: leaving ? "member.left" : "member.removed", target: target.userId } });
  if (leaving) {
    (await cookies()).delete(WORKSPACE_COOKIE);
    redirect("/app");
  }
  revalidatePath("/app/workspace");
}
