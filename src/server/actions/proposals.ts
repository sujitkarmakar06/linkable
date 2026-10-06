"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Proposal } from "@prisma/client";
import { db } from "@/lib/db";
import { priceLink } from "@/lib/credits";
import { getSettings } from "@/lib/settings";
import { legSchema, validateTerms, type LegTerm, type Terms } from "@/lib/terms";
import { acceptProposal, DealError, loadTermsSites } from "@/server/deals";
import { checkTerms as checkFootprint } from "@/server/footprint";
import { notifyWorkspace } from "@/server/notify";
import { requireMembership } from "@/server/session";
import type { FormState } from "./types";

// Leg fields arrive as legs.<i>.<field>.
function parseLegs(form: FormData): { legs?: LegTerm[]; error?: string } {
  const count = Math.min(4, Number(form.get("legCount") ?? 0));
  const legs: LegTerm[] = [];
  for (let i = 0; i < count; i++) {
    const f = (k: string) => form.get(`legs.${i}.${k}`);
    const parsed = legSchema.safeParse({
      fromSiteId: f("fromSiteId"),
      toSiteId: f("toSiteId"),
      targetUrl: f("targetUrl"),
      anchor: f("anchor"),
      rel: f("rel") ?? "DOFOLLOW",
      placementType: f("placementType") ?? "INSERTION",
      credits: Number(f("credits") || 0),
    });
    if (!parsed.success) return { error: `${count > 1 ? `Link ${i + 1}: ` : ""}${parsed.error.issues[0].message}` };
    legs.push(parsed.data);
  }
  return { legs };
}

// Structural rules first, then the footprint guard (blocks only; warnings
// are shown on the proposal page).
async function checkTerms(kind: Proposal["kind"], terms: Terms, parties: [string, string]) {
  const sites = await loadTermsSites(terms);
  const errors = validateTerms(kind, terms, sites, parties);
  if (errors.length) return errors;
  return (await checkFootprint(terms, sites)).blocks;
}

const proposalPath = (id: string) => `/app/proposals/${id}`;

export async function createSwapAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("MEMBER");
  const partnerId = String(form.get("partnerWorkspaceId") ?? "");
  if (!partnerId || partnerId === workspace.id) return { error: "Pick a partner site from another workspace." };
  const { legs, error } = parseLegs(form);
  if (error || !legs) return { error };
  const terms = { legs };
  const errors = await checkTerms("SWAP", terms, [workspace.id, partnerId]);
  if (errors.length) return { error: errors[0] };

  const proposal = await db.proposal.create({
    data: { kind: "SWAP", fromWorkspaceId: workspace.id, toWorkspaceId: partnerId, awaitingWorkspaceId: partnerId, terms, createdById: user.id },
  });
  const note = String(form.get("message") ?? "").trim();
  if (note) await db.message.create({ data: { authorId: user.id, proposalId: proposal.id, body: note.slice(0, 4000) } });
  await notifyWorkspace(partnerId, { kind: "proposal.new", title: `New ABC swap proposal from ${workspace.name}`, body: `${workspace.name} proposed a link swap. Review the links and accept, counter or decline.`, path: proposalPath(proposal.id) }, { everyone: true });
  redirect(proposalPath(proposal.id));
}

export async function createOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("MEMBER");
  const request = await db.linkRequest.findUnique({ where: { id: String(form.get("requestId")) }, include: { site: true, workspace: true } });
  if (!request || request.status !== "OPEN") return { error: "This request is no longer open." };
  if (request.workspaceId === workspace.id) return { error: "You can't offer on your own request." };
  const from = await db.site.findFirst({ where: { id: String(form.get("fromSiteId")), workspaceId: workspace.id } });
  if (!from) return { error: "Choose one of your sites." };
  if ((from.domainRating ?? 0) < request.minDomainRating) return { error: `This request needs DR ${request.minDomainRating}+; ${from.domain} is DR ${from.domainRating ?? "-"}.` };
  const niches = request.niches.length ? request.niches : [request.site.niche];
  if (!niches.includes(from.niche)) return { error: `This request wants a site in: ${niches.join(", ")}.` };
  const anchor = String(form.get("anchor") ?? "");
  if (!request.anchors.includes(anchor)) return { error: "Pick one of the requested anchors." };

  const settings = await getSettings();
  const price = priceLink(
    { domainRating: from.domainRating ?? 0, monthlyTraffic: from.organicTraffic, rel: request.rel, placementType: request.placementType },
    { tiers: settings.creditTiers, nofollowMultiplier: settings.nofollowMultiplier, guestPostBonus: settings.guestPostBonus },
  );
  if (price == null) return { error: `${from.domain} is below the minimum DR for trading.` };
  if (price > request.maxCredits) return { error: `A link from ${from.domain} costs ${price} credits; this request pays up to ${request.maxCredits}.` };

  const existing = await db.proposal.findFirst({ where: { linkRequestId: request.id, fromWorkspaceId: workspace.id, status: "OPEN" } });
  if (existing) return { error: "You already have an open offer on this request." };

  const terms: Terms = {
    legs: [{ fromSiteId: from.id, toSiteId: request.siteId, targetUrl: request.targetUrl, anchor, rel: request.rel, placementType: request.placementType, credits: price }],
  };
  const errors = await checkTerms("REQUEST_OFFER", terms, [workspace.id, request.workspaceId]);
  if (errors.length) return { error: errors[0] };
  const proposal = await db.proposal.create({
    data: { kind: "REQUEST_OFFER", fromWorkspaceId: workspace.id, toWorkspaceId: request.workspaceId, awaitingWorkspaceId: request.workspaceId, linkRequestId: request.id, terms, createdById: user.id },
  });
  await notifyWorkspace(request.workspaceId, { kind: "offer.new", title: `Offer for your link to ${request.site.domain}`, body: `${workspace.name} offered a link from ${from.domain} (DR ${from.domainRating}) for ${price} credits.`, path: proposalPath(proposal.id) }, { everyone: true });
  redirect(proposalPath(proposal.id));
}

async function loadOwnProposal(id: string) {
  const ctx = await requireMembership("MEMBER");
  const proposal = await db.proposal.findFirst({ where: { id, OR: [{ fromWorkspaceId: ctx.workspace.id }, { toWorkspaceId: ctx.workspace.id }] } });
  if (!proposal) throw new Error("Proposal not found");
  const other = proposal.fromWorkspaceId === ctx.workspace.id ? proposal.toWorkspaceId : proposal.fromWorkspaceId;
  return { ...ctx, proposal, other };
}

export async function counterAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace, proposal, other } = await loadOwnProposal(String(form.get("proposalId")));
  if (proposal.status !== "OPEN" || proposal.awaitingWorkspaceId !== workspace.id) return { error: "It isn't your turn on this proposal." };
  if (proposal.kind !== "SWAP") return { error: "Offers can only be accepted or declined." };
  const { legs, error } = parseLegs(form);
  if (error || !legs) return { error };
  // Countering may change URLs, anchors, sites and credits, but each link keeps its direction.
  const before = (proposal.terms as Terms).legs;
  const sites = await loadTermsSites({ legs: [...before, ...legs] });
  if (legs.length !== before.length || legs.some((l, i) => sites.get(l.fromSiteId)?.workspaceId !== sites.get(before[i].fromSiteId)?.workspaceId))
    return { error: "A counter-offer keeps the same links in the same direction." };
  const terms = { legs };
  const errors = await checkTerms("SWAP", terms, [proposal.fromWorkspaceId, proposal.toWorkspaceId]);
  if (errors.length) return { error: errors[0] };

  const { count } = await db.proposal.updateMany({
    where: { id: proposal.id, revision: proposal.revision, status: "OPEN" },
    data: { terms, revision: { increment: 1 }, awaitingWorkspaceId: other },
  });
  if (!count) return { error: "The proposal changed while you were editing. Reload it." };
  const note = String(form.get("message") ?? "").trim();
  if (note) await db.message.create({ data: { authorId: user.id, proposalId: proposal.id, body: note.slice(0, 4000) } });
  await notifyWorkspace(other, { kind: "proposal.countered", title: `${workspace.name} countered your proposal`, body: "Review the updated links and accept, counter or decline.", path: proposalPath(proposal.id) }, { everyone: true });
  revalidatePath(proposalPath(proposal.id));
  redirect(`${proposalPath(proposal.id)}?done=countered`);
}

export async function acceptAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace, proposal, other } = await loadOwnProposal(String(form.get("proposalId")));
  if (proposal.status !== "OPEN" || proposal.awaitingWorkspaceId !== workspace.id) return { error: "It isn't your turn on this proposal." };
  if (Number(form.get("revision")) !== proposal.revision) return { error: "The terms changed since you loaded the page. Review them again." };
  let dealId: string;
  try {
    dealId = await acceptProposal(proposal, user.id);
  } catch (err) {
    if (err instanceof DealError) return { error: err.message };
    throw err;
  }
  await notifyWorkspace(other, { kind: "proposal.accepted", title: `${workspace.name} accepted - the deal is on`, body: `Place your link within 14 days and add the page URL on the deal page.`, path: `/app/deals/${dealId}` }, { everyone: true });
  redirect(`/app/deals/${dealId}`);
}

export async function closeProposalAction(form: FormData) {
  const { user, workspace, proposal, other } = await loadOwnProposal(String(form.get("proposalId")));
  if (proposal.status !== "OPEN") return;
  // The side whose turn it is declines; the side waiting can withdraw.
  const status = proposal.awaitingWorkspaceId === workspace.id ? "DECLINED" : "WITHDRAWN";
  // Conditional so a close racing an accept can't overwrite ACCEPTED.
  const { count } = await db.proposal.updateMany({ where: { id: proposal.id, status: "OPEN" }, data: { status } });
  if (!count) return;
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: `proposal.${status.toLowerCase()}`, target: proposal.id } });
  await notifyWorkspace(other, { kind: `proposal.${status.toLowerCase()}`, title: `${workspace.name} ${status === "DECLINED" ? "declined" : "withdrew"} a proposal`, body: "No deal was created.", path: proposalPath(proposal.id) }, { everyone: true });
  revalidatePath(proposalPath(proposal.id));
  redirect(`${proposalPath(proposal.id)}?done=${status.toLowerCase()}`);
}

export async function sendMessageAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("MEMBER");
  const body = z.string().trim().min(1, "Write a message").max(4000).safeParse(form.get("body"));
  if (!body.success) return { error: body.error.issues[0].message };
  const dealId = form.get("dealId") ? String(form.get("dealId")) : null;
  const proposalId = form.get("proposalId") ? String(form.get("proposalId")) : null;
  if (Boolean(dealId) === Boolean(proposalId)) return { error: "Nothing to reply to." }; // exactly one thread

  let other: string | undefined;
  let path: string;
  if (dealId) {
    const parts = await db.dealParticipant.findMany({ where: { dealId } });
    if (!parts.some((p) => p.workspaceId === workspace.id)) return { error: "Not your deal." };
    other = parts.find((p) => p.workspaceId !== workspace.id)?.workspaceId;
    path = `/app/deals/${dealId}`;
  } else if (proposalId) {
    const p = await db.proposal.findFirst({ where: { id: proposalId, OR: [{ fromWorkspaceId: workspace.id }, { toWorkspaceId: workspace.id }] } });
    if (!p) return { error: "Not your proposal." };
    other = p.fromWorkspaceId === workspace.id ? p.toWorkspaceId : p.fromWorkspaceId;
    path = proposalPath(p.id);
  } else return { error: "Nothing to reply to." };

  await db.message.create({ data: { authorId: user.id, dealId, proposalId, body: body.data } });
  if (other) await notifyWorkspace(other, { kind: "message.new", title: `New message from ${workspace.name}`, body: body.data.slice(0, 300), path }, { everyone: true });
  revalidatePath(path);
  return { ok: "Sent." };
}
