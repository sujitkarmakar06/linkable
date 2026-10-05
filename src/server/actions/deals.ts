"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/db";
import { urlOnDomain } from "@/lib/terms";
import { cancelDeal, confirmLeg, DealError, placeLeg } from "@/server/deals";
import { checkLeg } from "@/server/linkcheck";
import { notifyWorkspace } from "@/server/notify";
import { requireMembership } from "@/server/session";
import type { FormState } from "./types";

async function loadLeg(legId: string) {
  const ctx = await requireMembership("MEMBER");
  const leg = await db.dealLeg.findUnique({ where: { id: legId }, include: { fromSite: true, toSite: true } });
  if (!leg || (leg.giverWorkspaceId !== ctx.workspace.id && leg.receiverWorkspaceId !== ctx.workspace.id)) throw new Error("Link not found");
  return { ...ctx, leg };
}

export async function placeLegAction(_: FormState, form: FormData): Promise<FormState> {
  const { workspace, leg } = await loadLeg(String(form.get("legId")));
  if (leg.giverWorkspaceId !== workspace.id) return { error: "Only the site giving the link can mark it placed." };
  if (!["PENDING", "PLACED"].includes(leg.status)) return { error: "This link can't be changed now." };
  const url = String(form.get("sourcePageUrl") ?? "").trim();
  if (!urlOnDomain(url, leg.fromSite.domain)) return { error: `The page must be on ${leg.fromSite.domain}.` };
  await placeLeg(leg, url);
  await notifyWorkspace(leg.receiverWorkspaceId, { kind: "leg.placed", title: `Your link from ${leg.fromSite.domain} is placed`, body: `It's on ${url}. Our crawler is checking it now.`, path: `/app/deals/${leg.dealId}` }, { everyone: true });
  // Check straight away; later checks run from the daily job.
  after(() => checkLeg(leg.id).catch((err) => console.error("[linkcheck]", err)));
  revalidatePath(`/app/deals/${leg.dealId}`);
  return { ok: "Marked as placed. We're checking the page now." };
}

export async function confirmLegAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace, leg } = await loadLeg(String(form.get("legId")));
  if (leg.receiverWorkspaceId !== workspace.id) return { error: "Only the side receiving the link can confirm it." };
  try {
    await confirmLeg(leg, user.id);
  } catch (err) {
    if (err instanceof DealError) return { error: err.message };
    throw err;
  }
  await notifyWorkspace(
    leg.giverWorkspaceId,
    { kind: "leg.verified", title: `Link on ${leg.fromSite.domain} confirmed`, body: leg.credits ? "Credits are released to you in stages over the guarantee period." : "Thanks - the link is confirmed live.", path: `/app/deals/${leg.dealId}` },
    { everyone: true },
  );
  revalidatePath(`/app/deals/${leg.dealId}`);
  redirect(`/app/deals/${leg.dealId}?done=confirmed`);
}

export async function cancelDealAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("MEMBER");
  const dealId = String(form.get("dealId"));
  const parts = await db.dealParticipant.findMany({ where: { dealId } });
  if (!parts.some((p) => p.workspaceId === workspace.id)) return { error: "Not your deal." };
  try {
    await cancelDeal(dealId, user.id);
  } catch (err) {
    if (err instanceof DealError) return { error: err.message };
    throw err;
  }
  for (const p of parts.filter((p) => p.workspaceId !== workspace.id))
    await notifyWorkspace(p.workspaceId, { kind: "deal.cancelled", title: `${workspace.name} cancelled a deal`, body: "Any credits held in escrow were returned.", path: `/app/deals/${dealId}` }, { everyone: true });
  revalidatePath(`/app/deals/${dealId}`);
  redirect(`/app/deals/${dealId}?done=cancelled`);
}
