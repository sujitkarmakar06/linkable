// Footprint guard: rules that keep a link from looking like part of a link
// scheme. Pure; server/footprint.ts loads the history it needs.
import { classifyAnchor } from "./anchors";
import { isVelocitySpike, KEYWORD_SHARE_LIMIT, MIN_SAMPLE } from "./profile";
//
// Blocks stop the deal. Warnings are shown to both sides and kept on the deal.

export type FootprintSite = {
  id: string;
  workspaceId: string;
  domain: string;
  ipAddress: string | null;
  ipCClass: string | null;
  ownerFingerprint: string | null;
  maxOutboundPerMonth: number;
  brandTerms?: string[];
};

export type FootprintHistory = {
  reverseLinksRecent: number; // receiver site -> giver site, within the cooldown
  sameLinkActive: number; // giver site -> receiver site already exists (not cancelled/removed)
  pairDealsRecent: number; // deals between the two workspaces within the cooldown
  giverLinksThisMonth: number; // links placed or promised from the giver site this calendar month
  anchorUsesForTarget: number; // active links to the receiver domain using this anchor
  linksToTarget: number; // active links to the receiver domain
  keywordAnchorsToTarget?: number; // of those, how many use keyword anchors (see lib/anchors)
  receiverLinksThisMonth?: number; // links to the receiver agreed or live this calendar month
  receiverPreviousMonths?: number[]; // the same for each of the previous five months
};

export type FootprintResult = { blocks: string[]; warnings: string[] };

export const ANCHOR_SHARE_LIMIT = 0.3;
export const ANCHOR_MIN_SAMPLE = 3;

// Shared CDN/edge ranges: many unrelated sites share these IPs, so an IP
// match there says nothing about common ownership.
const CDN_CIDRS = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22", // Cloudflare
  "151.101.0.0/16", "199.232.0.0/16", // Fastly
  "76.76.21.0/24", "66.33.60.0/24", // Vercel
  "75.2.60.0/24", "99.83.231.0/24", // Netlify
];

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isCdnIp(ip: string): boolean {
  const n = ipToInt(ip);
  if (n == null) return false;
  return CDN_CIDRS.some((cidr) => {
    const [base, bits] = cidr.split("/");
    const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return ((ipToInt(base)! & mask) >>> 0) === ((n & mask) >>> 0);
  });
}

export function evaluateFootprint(
  giver: FootprintSite,
  receiver: FootprintSite,
  anchor: string,
  history: FootprintHistory,
  { pairCooldownMonths }: { pairCooldownMonths: number },
): FootprintResult {
  const blocks: string[] = [];
  const warnings: string[] = [];

  if (giver.ownerFingerprint && giver.ownerFingerprint === receiver.ownerFingerprint)
    blocks.push(`${giver.domain} and ${receiver.domain} appear to have the same owner.`);

  if (giver.ipAddress && receiver.ipAddress && !isCdnIp(giver.ipAddress) && !isCdnIp(receiver.ipAddress)) {
    if (giver.ipAddress === receiver.ipAddress) blocks.push(`${giver.domain} and ${receiver.domain} are hosted on the same IP address.`);
    else if (giver.ipCClass && giver.ipCClass === receiver.ipCClass) blocks.push(`${giver.domain} and ${receiver.domain} are hosted in the same IP range (${giver.ipCClass}.x).`);
  }

  if (history.reverseLinksRecent > 0)
    blocks.push(`${receiver.domain} already links to ${giver.domain} through Linkable${pairCooldownMonths ? ` in the last ${pairCooldownMonths} months` : ""} - linking back would be reciprocal.`);

  if (history.sameLinkActive > 0) blocks.push(`${giver.domain} already links to ${receiver.domain} through Linkable.`);

  if (history.giverLinksThisMonth >= giver.maxOutboundPerMonth)
    blocks.push(`${giver.domain} has reached its limit of ${giver.maxOutboundPerMonth} links this month.`);

  if (history.pairDealsRecent > 0)
    warnings.push(`These two workspaces already traded ${history.pairDealsRecent} time${history.pairDealsRecent === 1 ? "" : "s"} in the last ${pairCooldownMonths} months. Spreading links across partners looks more natural.`);

  const total = history.linksToTarget + 1;
  const uses = history.anchorUsesForTarget + 1;
  if (total >= ANCHOR_MIN_SAMPLE && uses / total > ANCHOR_SHARE_LIMIT)
    warnings.push(`"${anchor}" would be ${Math.round((uses / total) * 100)}% of the anchors pointing to ${receiver.domain}. Vary the anchor text.`);

  // Link profile planner rules (warnings only).
  if (classifyAnchor(anchor, receiver.domain, receiver.brandTerms) === "keyword") {
    const keyword = (history.keywordAnchorsToTarget ?? 0) + 1;
    if (total >= MIN_SAMPLE && keyword / total > KEYWORD_SHARE_LIMIT)
      warnings.push(`Keyword anchors would be ${Math.round((keyword / total) * 100)}% of the links to ${receiver.domain}. A branded or URL anchor looks more natural.`);
  }
  const thisMonth = (history.receiverLinksThisMonth ?? 0) + 1;
  if (history.receiverPreviousMonths && isVelocitySpike(thisMonth, history.receiverPreviousMonths))
    warnings.push(`This would be link ${thisMonth} to ${receiver.domain} this month, well above its usual pace. Consider spreading links over the coming months.`);

  return { blocks, warnings };
}

export function mergeResults(results: FootprintResult[]): FootprintResult {
  return { blocks: [...new Set(results.flatMap((r) => r.blocks))], warnings: [...new Set(results.flatMap((r) => r.warnings))] };
}
