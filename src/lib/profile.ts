import { ANCHOR_KINDS, brandTokens, classifyAnchor, type AnchorKind } from "./anchors";

// Link profile of one receiving site, from its Linkable links. Pure.

export type ProfileLink = { anchor: string; rel: "DOFOLLOW" | "NOFOLLOW" | "SPONSORED" | "UGC"; status: string; createdAt: Date; verifiedAt: Date | null };

// A natural-looking mix to steer toward.
export const TARGET_MIX: Record<AnchorKind, number> = { branded: 0.35, url: 0.15, generic: 0.15, keyword: 0.35 };
export const KEYWORD_SHARE_LIMIT = 0.5;
export const SINGLE_ANCHOR_LIMIT = 0.3;
export const MIN_SAMPLE = 5;
export const VELOCITY_FLOOR = 4; // up to this many links in a month never counts as a spike

const LIVE = ["PLACED", "VERIFIED", "FAILING"];
const PLANNED = ["PENDING", "CONTENT_SUBMITTED", "CONTENT_APPROVED"];
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

// A month is a spike when it exceeds the floor and twice the average of the previous months.
export function isVelocitySpike(thisMonth: number, previousMonths: number[]): boolean {
  const avg = previousMonths.length ? previousMonths.reduce((s, n) => s + n, 0) / previousMonths.length : 0;
  return thisMonth > Math.max(VELOCITY_FLOOR, 2 * avg);
}

export function buildProfile(allLinks: ProfileLink[], site: { domain: string; brandTerms: string[] }, now = new Date()) {
  const links = allLinks.filter((l) => LIVE.includes(l.status) || PLANNED.includes(l.status));
  const total = links.length;
  const byKind: Record<AnchorKind, number> = { branded: 0, url: 0, generic: 0, keyword: 0 };
  const anchors = new Map<string, { anchor: string; n: number; kind: AnchorKind }>();
  for (const l of links) {
    const kind = classifyAnchor(l.anchor, site.domain, site.brandTerms);
    byKind[kind]++;
    const key = l.anchor.trim().toLowerCase();
    const cur = anchors.get(key) ?? { anchor: l.anchor.trim(), n: 0, kind };
    cur.n++;
    anchors.set(key, cur);
  }
  const share = (n: number) => (total ? n / total : 0);
  const topAnchors = [...anchors.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((a) => ({ ...a, share: share(a.n) }));

  // Last 6 calendar months, oldest first; a link counts in the month it went live (or was agreed).
  const months: { key: string; n: number }[] = [];
  for (let i = 5; i >= 0; i--) months.push({ key: monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))), n: 0 });
  for (const l of links) {
    const m = months.find((x) => x.key === monthKey(l.verifiedAt ?? l.createdAt));
    if (m) m.n++;
  }
  const dofollow = links.filter((l) => l.rel === "DOFOLLOW").length;

  const warnings: string[] = [];
  if (total >= MIN_SAMPLE && share(byKind.keyword) > KEYWORD_SHARE_LIMIT)
    warnings.push(`${Math.round(share(byKind.keyword) * 100)}% of anchors are keyword anchors. Natural profiles lean on branded, URL and generic anchors.`);
  const top = topAnchors[0];
  if (top && total >= 3 && top.share > SINGLE_ANCHOR_LIMIT && top.kind !== "branded" && top.kind !== "url")
    warnings.push(`"${top.anchor}" is ${Math.round(top.share * 100)}% of anchors. Use different wording for the next links.`);
  const current = months[months.length - 1];
  const previous = months.slice(0, -1).map((m) => m.n);
  if (isVelocitySpike(current.n, previous))
    warnings.push(`${current.n} links this month is well above the usual pace (about ${Math.round(previous.reduce((s, n) => s + n, 0) / previous.length)} a month). Spread new links over the coming months.`);
  if (total >= 8 && dofollow === total) warnings.push("Every link is dofollow. A few nofollow links make a profile look more natural.");

  // Next anchor: the type furthest below its target share.
  const nextKind = ANCHOR_KINDS.map((k) => ({ k, gap: TARGET_MIX[k] - share(byKind[k]) })).sort((a, b) => b.gap - a.gap)[0].k;
  const brand = brandTokens(site.domain, site.brandTerms);
  const example: Record<AnchorKind, string> = {
    branded: `a branded anchor, such as "${site.brandTerms[0] ?? brand[1] ?? brand[0] ?? site.domain}"`,
    url: `the address itself, such as "${site.domain}"`,
    generic: `a generic phrase, such as "this guide" or "read more"`,
    keyword: "a descriptive phrase about the page's topic",
  };
  const suggestion = total === 0 ? `Start with ${example.branded}.` : `Next, use ${example[nextKind]}.`;

  return { total, live: links.filter((l) => LIVE.includes(l.status)).length, planned: links.filter((l) => PLANNED.includes(l.status)).length, byKind, share, topAnchors, months, dofollowShare: share(dofollow), warnings, nextKind, suggestion };
}
