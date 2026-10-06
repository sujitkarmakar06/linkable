import { z } from "zod";
import { priceLink, type PriceRules } from "./credits";

// Terms of a proposal: the links each side will place. Pure validation so
// the same rules run on create, counter and accept (sites may have changed).

export const legSchema = z.object({
  fromSiteId: z.string().min(1),
  toSiteId: z.string().min(1),
  targetUrl: z.string().trim().min(1, "Enter the page URL that should receive the link"),
  anchor: z.string().trim().min(1, "Enter the anchor text").max(100, "Anchor text is at most 100 characters"),
  rel: z.enum(["DOFOLLOW", "NOFOLLOW"]),
  placementType: z.enum(["INSERTION", "GUEST_POST"]),
  credits: z.number().int().min(0).max(1000),
});

export type LegTerm = z.infer<typeof legSchema>;
export type Terms = { legs: LegTerm[] };

export type TermsSite = {
  id: string;
  workspaceId: string;
  domain: string;
  status: string;
  canGive: boolean;
  canReceive: boolean;
  domainRating: number | null;
  organicTraffic: number | null;
  ipAddress: string | null;
  ipCClass: string | null;
  ownerFingerprint: string | null;
  maxOutboundPerMonth: number;
};

export function urlOnDomain(url: string, domain: string): boolean {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

export function validateTerms(
  kind: "SWAP" | "REQUEST_OFFER",
  terms: Terms,
  sites: Map<string, TermsSite>,
  parties: [string, string],
): string[] {
  const errors: string[] = [];
  const legs = terms.legs;
  if (kind === "REQUEST_OFFER" && legs.length !== 1) errors.push("An offer is exactly one link.");
  if (kind === "SWAP" && (legs.length < 2 || legs.length > 4)) errors.push("A swap has 2 to 4 links.");

  const seen = new Set<string>();
  legs.forEach((leg, i) => {
    const n = legs.length > 1 ? `Link ${i + 1}: ` : "";
    const from = sites.get(leg.fromSiteId);
    const to = sites.get(leg.toSiteId);
    if (!from || !to) return errors.push(`${n}choose both sites.`);
    if (from.status !== "APPROVED" || !from.canGive) errors.push(`${n}${from.domain} isn't an approved site that gives links.`);
    if (to.status !== "APPROVED" || !to.canReceive) errors.push(`${n}${to.domain} isn't an approved site that receives links.`);
    if (from.workspaceId === to.workspaceId) errors.push(`${n}a workspace can't link to its own site.`);
    if (!parties.includes(from.workspaceId) || !parties.includes(to.workspaceId)) errors.push(`${n}both sites must belong to the two workspaces in this deal.`);
    if (!urlOnDomain(leg.targetUrl, to.domain)) errors.push(`${n}the target URL must be a page on ${to.domain}.`);
    const key = `${leg.fromSiteId}>${leg.toSiteId}`;
    if (seen.has(key)) errors.push(`${n}the same site pair appears twice.`);
    seen.add(key);
  });

  if (kind === "SWAP" && errors.length === 0) {
    const directions = new Set(legs.map((l) => sites.get(l.fromSiteId)!.workspaceId));
    if (directions.size < 2) errors.push("In a swap both sides must give at least one link.");
    // The whole point of ABC: never A -> B and B -> A between the same two sites.
    for (const leg of legs) {
      if (seen.has(`${leg.toSiteId}>${leg.fromSiteId}`)) {
        errors.push(`${sites.get(leg.fromSiteId)!.domain} and ${sites.get(leg.toSiteId)!.domain} would link to each other. That's a reciprocal swap - give from a different site.`);
        break;
      }
    }
  }
  return errors;
}

// Credit value of each leg (what the link would cost on the marketplace).
export function legValue(leg: LegTerm, from: TermsSite, rules: PriceRules): number {
  return priceLink({ domainRating: from.domainRating ?? 0, monthlyTraffic: from.organicTraffic, rel: leg.rel, placementType: leg.placementType }, rules) ?? 0;
}

// Per workspace: value of links it receives and gives, and credits it pays.
export function summarise(terms: Terms, sites: Map<string, TermsSite>, rules: PriceRules) {
  const out = new Map<string, { receives: number; gives: number; pays: number }>();
  const get = (id: string) => out.get(id) ?? out.set(id, { receives: 0, gives: 0, pays: 0 }).get(id)!;
  for (const leg of terms.legs) {
    const from = sites.get(leg.fromSiteId);
    const to = sites.get(leg.toSiteId);
    if (!from || !to) continue;
    const value = legValue(leg, from, rules);
    get(to.workspaceId).receives += value;
    get(to.workspaceId).pays += leg.credits;
    get(from.workspaceId).gives += value;
  }
  return out;
}
